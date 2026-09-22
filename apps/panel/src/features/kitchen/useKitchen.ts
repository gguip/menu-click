import { useQuery } from "@tanstack/react-query";
import { getOrder, listOrdersByStatus } from "../../api/orders.ts";
import type { OrderStatus } from "../../api/types.ts";
import { ORDERS_POLL_MS } from "../orders/polling.ts";
import { byArrival } from "./kitchen.ts";

/** Sob o prefixo `"orders"`: toda ação num pedido invalida estas listas junto. */
function useOrdersByStatus(restaurantId: string, status: OrderStatus) {
  return useQuery({
    queryKey: ["orders", "by-status", restaurantId, status],
    queryFn: () => listOrdersByStatus(restaurantId, status),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

/**
 * "Fazendo" = aceitos + em preparo. Duas listas a 10 s (12 req/min); os
 * pendentes vêm da query do aviso de pedido novo, sem custo a mais.
 */
export function useDoingOrders(restaurantId: string) {
  const confirmed = useOrdersByStatus(restaurantId, "confirmed");
  const preparing = useOrdersByStatus(restaurantId, "preparing");
  const loaded = confirmed.data !== undefined && preparing.data !== undefined;
  return {
    orders: loaded ? byArrival([...(confirmed.data ?? []), ...(preparing.data ?? [])]) : undefined,
    error: confirmed.error ?? preparing.error,
  };
}

/**
 * Os itens de UM pedido, buscados uma vez só. A listagem da API não traz
 * itens, mas eles são congelados na criação (`order_items` guarda cópia) e
 * nunca mudam. A chave fica FORA do prefixo `"orders"` de propósito: toda
 * ação invalida `["orders"]`, e o detalhe seria refeito para cada cartão da
 * bancada a cada clique — o estado do pedido vem das listas.
 */
export function useOrderItems(restaurantId: string, orderId: string) {
  return useQuery({
    queryKey: ["order-items", restaurantId, orderId],
    queryFn: async () => (await getOrder(restaurantId, orderId)).items,
    staleTime: Infinity,
  });
}
