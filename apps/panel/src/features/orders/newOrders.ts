import type { Order } from "../../api/types.ts";
import { orderNumber } from "../../lib/orderNumber.ts";

/**
 * Quais pendentes são novidade. `seen === null` é a primeira carga: nada
 * toca (senão o painel apitaria a cada F5), só se registra o que já existia.
 * O conjunto só cresce — pedido que sai e volta não toca duas vezes.
 */
export function detectNewPending(
  seen: ReadonlySet<string> | null,
  orders: readonly Order[],
): { fresh: string[]; seen: Set<string> } {
  const next = new Set(seen ?? []);
  const fresh: string[] = [];
  for (const order of orders) {
    if (next.has(order.id)) continue;
    next.add(order.id);
    if (seen !== null) fresh.push(order.id);
  }
  return { fresh, seen: next };
}

/** O texto do aviso: o número quando é um só, a quantidade quando chegam juntos. */
export function newOrderTitle(orders: readonly Order[]): string {
  return orders.length === 1 ? `Novo pedido ${orderNumber(orders[0])}` : `${orders.length} pedidos novos`;
}
