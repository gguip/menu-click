import type { Order } from "../api/types.ts";

/** O número que se fala no balcão: contínuo por loja, vindo da API. */
export function orderNumber(order: Pick<Order, "number">): string {
  return `#${order.number}`;
}
