import { apiRequest } from "./client.ts";
import type { OrdersSummary, Period } from "./types.ts";

/** Período OU intervalo — a API responde 400 se receber os dois. */
export type OrderRange = { period: Period } | { from: string; to: string };

export function rangeQuery(range: OrderRange): Record<string, string> {
  return "period" in range ? { period: range.period } : { from: range.from, to: range.to };
}

export function getOrdersSummary(restaurantId: string, range: OrderRange): Promise<OrdersSummary> {
  return apiRequest<OrdersSummary>(`/restaurants/${restaurantId}/orders/summary`, {
    query: rangeQuery(range),
  });
}
