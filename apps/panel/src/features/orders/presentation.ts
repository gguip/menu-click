import type { Order, OrderItemOption, OrderStatus, OrderType } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import { elapsedMinutes } from "../../lib/time.ts";
import { isClosed } from "./orderRules.ts";

const TYPE_LABEL: Record<OrderType, string> = {
  delivery: "Entrega",
  takeaway: "Retirada",
  dine_in: "Salão",
};

export function typeLabel(type: OrderType): string {
  return TYPE_LABEL[type];
}

/** O estágio que o cartão mostra junto do tipo, na coluna Prontos. */
export function stageLabel(status: OrderStatus): string | null {
  if (status === "out_for_delivery") return "Saiu para entrega";
  if (status === "ready_for_pickup") return "Pronto para retirada";
  return null;
}

/** Sem "pago": a API não registra se o pagamento aconteceu (spec). */
export function paymentLabel(order: Pick<Order, "paymentMethod" | "changeForInCents">): string {
  switch (order.paymentMethod) {
    case "cash":
      return order.changeForInCents === undefined
        ? "Dinheiro · sem troco"
        : `Dinheiro · troco para ${formatCents(order.changeForInCents)}`;
    case "card_on_delivery":
      return "Cartão na entrega";
    case "pix":
      return "Pix";
    case "meal_voucher":
      return "Vale-refeição";
  }
}

export function whereLabel(order: Pick<Order, "type" | "deliveryAddress" | "table">): string {
  if (order.type === "delivery" && order.deliveryAddress) {
    const a = order.deliveryAddress;
    return `${a.street}, ${a.number} — ${a.neighborhood}, ${a.city}`;
  }
  if (order.type === "dine_in") return order.table ? order.table.label : "Salão · sem mesa";
  return "Retirada no balcão";
}

/**
 * Três formas distintas: um valor, grátis (R$ 0,00) e "a combinar". Confundir
 * 0 com null esconde uma promoção ou entrega de graça por acidente.
 */
export function freightLine(
  order: Pick<Order, "type" | "deliveryFeeInCents">,
): { label: string; value: string } | null {
  if (order.type !== "delivery") return null;
  if (order.deliveryFeeInCents === null) return { label: "Frete a combinar", value: "a combinar" };
  if (order.deliveryFeeInCents === 0) return { label: "Entrega grátis", value: formatCents(0) };
  return { label: "Frete", value: formatCents(order.deliveryFeeInCents) };
}

/** Em entrega, `totalInCents` já inclui o frete; a linha "Itens" é o resto. */
export function itemsSubtotal(order: Pick<Order, "totalInCents" | "deliveryFeeInCents">): number {
  return order.totalInCents - (order.deliveryFeeInCents ?? 0);
}

export function groupOptions(
  options: readonly OrderItemOption[],
): { groupName: string; text: string }[] {
  const groups: { groupName: string; names: string[] }[] = [];
  for (const option of options) {
    let group = groups.find((candidate) => candidate.groupName === option.groupName);
    if (group === undefined) {
      group = { groupName: option.groupName, names: [] };
      groups.push(group);
    }
    group.names.push(option.quantity > 1 ? `${option.quantity}× ${option.name}` : option.name);
  }
  return groups.map((group) => ({ groupName: group.groupName, text: group.names.join(", ") }));
}

/** Tempo em âmbar: pedido novo, ou aberto há mais de 25 min. */
export function isUrgent(order: Pick<Order, "status" | "createdAt">, nowMs: number): boolean {
  if (isClosed(order.status)) return false;
  return order.status === "pending" || elapsedMinutes(order.createdAt, nowMs) > 25;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return phone;
}
