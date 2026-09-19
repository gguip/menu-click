import { useQuery } from "@tanstack/react-query";
import { getOrdersSummary } from "../../api/orders.ts";
import { ORDERS_POLL_MS } from "./polling.ts";

/**
 * Os números do header ("Aceitos hoje · Faturamento · Ticket médio"). O
 * Resumo do dia (parte 3) usa ESTA query: duas fontes fariam os números
 * divergirem, e o operador deixaria de confiar nos dois (handoff).
 */
export function useTodaySummary(restaurantId: string) {
  return useQuery({
    queryKey: ["orders", "summary", restaurantId, "today"],
    queryFn: () => getOrdersSummary(restaurantId, { period: "today" }),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
  });
}
