import type { Order, OrderStatus, OrderTransition } from "../../api/types.ts";
import { orderCode } from "../../lib/orderCode.ts";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";

export type KitchenColumnId = "new" | "doing";

/** Texto literal do protótipo do handoff. */
export const KITCHEN_COLUMNS: readonly { id: KitchenColumnId; title: string; empty: string }[] = [
  { id: "new", title: "Entraram agora", empty: "Nada novo." },
  { id: "doing", title: "Fazendo", empty: "Bancada limpa." },
];

/** Pedido pronto (despachado, aguardando retirada) já saiu da bancada. */
export function kitchenColumn(status: OrderStatus): KitchenColumnId | null {
  if (status === "pending") return "new";
  if (status === "confirmed" || status === "preparing") return "doing";
  return null;
}

/**
 * Um botão por estado, texto literal do protótipo. `confirmed` só aparece
 * quando o segundo passo do aceite falhou: "Começar preparo" é a rede.
 */
export function kitchenAction(
  order: Pick<Order, "type" | "status">,
): { transition: OrderTransition; label: string } | null {
  switch (order.status) {
    case "pending":
      return { transition: "accept", label: "Aceitar e começar" };
    case "confirmed":
      return { transition: "start-preparing", label: "Começar preparo" };
    case "preparing":
      if (order.type === "delivery") return { transition: "dispatch", label: "Pronto — despachar" };
      if (order.type === "takeaway") return { transition: "ready", label: "Pronto para retirada" };
      return { transition: "complete", label: "Pronto — servir" };
    default:
      return null;
  }
}

/**
 * A confirmação de aceite do painel diz o nome e o total; a da cozinha, não —
 * a cozinha não decide dinheiro (handoff). O resto do texto é o mesmo.
 */
export function kitchenAcceptCopy(order: Pick<Order, "id">): ConfirmCopy {
  return {
    title: `Aceitar o pedido ${orderCode(order.id)}?`,
    body: "Aceitar manda o pedido para a cozinha e baixa o estoque dos itens.",
    warn: "Não existe desconfirmar. Depois de aceito, só cabe cancelar.",
    cta: "Aceitar pedido",
    tone: "accent",
  };
}

/** A bancada trabalha na ordem de chegada: o mais antigo primeiro. */
export function byArrival<T extends Pick<Order, "createdAt" | "id">>(orders: readonly T[]): T[] {
  return [...orders].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
}
