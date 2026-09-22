import { Button, Modal } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError, describeError } from "../../api/client.ts";
import { transitionOrder } from "../../api/orders.ts";
import type { Order, OrderTransition } from "../../api/types.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import dialog from "../../ui/ConfirmDialog.module.css";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";
import { kitchenAcceptCopy } from "../kitchen/kitchen.ts";
import { acceptCopy, cancelCopy } from "./orderRules.ts";

type ActionRequest = { order: Order; transition: OrderTransition };
type Failure = { order: Order; message: string; stock: boolean };

type OrderActionValue = {
  request: (order: Order, transition: OrderTransition) => void;
  busyOrderId: string | null;
  disabled: boolean;
};

const OrderActionContext = createContext<OrderActionValue | null>(null);

export function useOrderAction(): OrderActionValue {
  const value = useContext(OrderActionContext);
  if (value === null) throw new Error("useOrderAction fora do OrderActionProvider");
  return value;
}

// A API não devolve código de erro, só mensagem (pt-BR, escrita pelo serviço
// de pedidos). O texto é o único jeito de separar "o estoque acabou" de "outro
// aparelho já mexeu neste pedido" — se a mensagem mudar na API, o diálogo de
// estoque vira o de erro genérico, sem quebrar nada.
const STOCK_MESSAGE = /^Estoque insuficiente/;

/**
 * Um lugar só para aceitar, avançar e cancelar — o cartão e o drawer pedem
 * por aqui. Aceitar e cancelar sempre confirmam; o resto é um clique.
 */
export function OrderActionProvider({
  restaurantId,
  disabled,
  mode = "panel",
  children,
}: {
  restaurantId: string;
  disabled: boolean;
  /**
   * `"kitchen"`: a confirmação de aceite não mostra nome nem total, e o
   * diálogo de estoque insuficiente só fecha — cancelar e repor estoque não
   * são ações da bancada.
   */
  mode?: "panel" | "kitchen";
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<ActionRequest | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ order, transition }: ActionRequest) => {
      if (transition !== "accept") {
        await transitionOrder(restaurantId, order.id, transition);
        return;
      }
      // O handoff tem UM clique entre Novo e Em preparo; a API tem duas etapas.
      await transitionOrder(restaurantId, order.id, "accept");
      try {
        await transitionOrder(restaurantId, order.id, "start-preparing");
      } catch {
        // Fica `confirmed`, na coluna Em preparo, com "Começar preparo" como rede.
      }
    },
    onSuccess: () => setConfirming(null),
    onError: (error, { order, transition }) => {
      setConfirming(null);
      const stock =
        transition === "accept" &&
        error instanceof ApiError &&
        error.status === 409 &&
        STOCK_MESSAGE.test(error.message);
      setFailure({ order, message: describeError(error), stock });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });

  const request = (order: Order, transition: OrderTransition) => {
    if (disabled || mutation.isPending) return;
    setFailure(null);
    if (transition === "accept" || transition === "cancel") setConfirming({ order, transition });
    else mutation.mutate({ order, transition });
  };

  const copy: ConfirmCopy | null =
    confirming === null
      ? null
      : confirming.transition === "accept"
        ? mode === "kitchen"
          ? kitchenAcceptCopy(confirming.order)
          : acceptCopy(confirming.order)
        : cancelCopy(confirming.order);

  const busyOrderId = mutation.isPending ? (mutation.variables?.order.id ?? null) : null;

  return (
    <OrderActionContext.Provider value={{ request, busyOrderId, disabled }}>
      {children}
      <ConfirmDialog
        copy={copy}
        busy={mutation.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming !== null) mutation.mutate(confirming);
        }}
      />
      <Modal
        opened={failure !== null}
        onClose={() => setFailure(null)}
        title={failure?.stock ? "Estoque acabou ao aceitar" : "Não foi possível concluir"}
        centered
        size={460}
        radius="md"
        classNames={{ title: dialog.title, overlay: dialog.overlay }}
      >
        {failure && (
          <div className={dialog.body}>
            <p className={dialog.text}>
              {failure.stock
                ? `${failure.message}. O pedido não foi aceito e o estoque não mudou. Reponha o estoque ou recuse explicando ao cliente.`
                : failure.message}
            </p>
            <div className={dialog.actions}>
              {failure.stock && mode === "panel" ? (
                <>
                  <Button
                    variant="default"
                    h={40}
                    onClick={() => {
                      setFailure(null);
                      navigate("/produtos");
                    }}
                  >
                    Repor estoque
                  </Button>
                  <Button
                    h={40}
                    className={buttons.danger}
                    onClick={() => {
                      const order = failure.order;
                      setFailure(null);
                      setConfirming({ order, transition: "cancel" });
                    }}
                  >
                    Recusar pedido
                  </Button>
                </>
              ) : (
                <Button variant="default" h={40} onClick={() => setFailure(null)}>
                  Fechar
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </OrderActionContext.Provider>
  );
}
