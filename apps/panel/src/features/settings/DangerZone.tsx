import { Button, Modal, TextInput } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { describeError } from "../../api/client.ts";
import { deleteRestaurant } from "../../api/restaurant.ts";
import { clearSession } from "../../api/session.ts";
import type { Restaurant } from "../../api/types.ts";
import buttons from "../../ui/buttons.module.css";
import classes from "./DangerZone.module.css";

/**
 * Só o `owner` chega aqui (a API responde 403 para `staff`, e botão morto é
 * pior que botão nenhum). A confirmação pede o NOME da loja digitado: é a
 * única ação do painel sem volta.
 */
export function DangerZone({ restaurant }: { restaurant: Restaurant }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => deleteRestaurant(restaurant.id),
    onSuccess: () => {
      // A remoção marca o restaurante e as filhas, mas NÃO toca no usuário nem
      // na sessão: ficar no painel deixaria a pessoa numa casca pedindo um
      // restaurante que já não existe.
      clearSession();
      queryClient.clear();
      navigate("/login?motivo=loja-removida", { replace: true });
    },
  });

  const confirmed = typed.trim() === restaurant.name;

  return (
    <section className={classes.zone}>
      <h2 className={classes.title}>Remover o restaurante</h2>
      <p className={classes.body}>
        Apaga cardápio, mesas, usuários e o histórico de pedidos. Não há como desfazer, e o cardápio
        público sai do ar na hora.
      </p>
      <Button
        className={buttons.danger}
        onClick={() => {
          setTyped("");
          remove.reset();
          setOpen(true);
        }}
      >
        Remover restaurante
      </Button>

      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={`Remover a ${restaurant.name}?`}
        centered
        size={460}
        radius="md"
      >
        <div className={classes.dialog}>
          <p className={classes.body}>
            Apaga cardápio, mesas, usuários e o histórico de pedidos. Não há como desfazer, e o
            cardápio público sai do ar na hora.
          </p>
          <TextInput
            label="Digite o nome da loja para confirmar"
            aria-label="Digite o nome da loja para confirmar"
            value={typed}
            onChange={(event) => setTyped(event.currentTarget.value)}
          />
          {remove.isError && (
            <p role="alert" className={classes.error}>
              {describeError(remove.error)}
            </p>
          )}
          <div className={classes.actions}>
            <Button variant="default" h={40} onClick={() => setOpen(false)} disabled={remove.isPending}>
              Voltar
            </Button>
            <Button
              h={40}
              className={buttons.danger}
              disabled={!confirmed}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remover para sempre
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
