import { useQuery } from "@tanstack/react-query";
import { getOrdersSummary } from "../../api/orders.ts";
import type { Period } from "../../api/types.ts";
import { ORDERS_POLL_MS } from "./polling.ts";

/** Sob o prefixo `"orders"`: qualquer ação num pedido atualiza o resumo junto. */
export function summaryQueryKey(restaurantId: string, period: Period) {
  return ["orders", "summary", restaurantId, period] as const;
}

export function usePeriodSummary(restaurantId: string, period: Period) {
  return useQuery({
    queryKey: summaryQueryKey(restaurantId, period),
    queryFn: () => getOrdersSummary(restaurantId, { period }),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

/**
 * Os números do header ("Aceitos hoje · Faturamento · Ticket médio"). O
 * Resumo do dia, com o período Hoje, usa ESTA query: duas fontes fariam os
 * números divergirem, e o operador deixaria de confiar nos dois (handoff).
 */
export function useTodaySummary(restaurantId: string) {
  return usePeriodSummary(restaurantId, "today");
}
