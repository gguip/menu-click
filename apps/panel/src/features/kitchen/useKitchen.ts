import { useQuery } from "@tanstack/react-query";
import { getOrder, listOrdersByStatus } from "../../api/orders.ts";
import type { OrderStatus } from "../../api/types.ts";
import { ORDERS_POLL_MS } from "../orders/polling.ts";
import { byArrival, kitchenColumn } from "./kitchen.ts";

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
 *
 * As duas listas assentam de forma independente: uma tem dado, ou está em
 * erro. Se só uma falhar, a bancada mostra o que chegou da outra — o pedido
 * `confirmed` não pode sumir de "Fazendo" só porque `preparing` deu 500 —, e
 * `partialError` carrega o erro da que faltou para a tela avisar sem
 * esconder o que deu certo. Só quando NENHUMA tem dado (as duas falharam, ou
 * ainda estão carregando) `orders` fica `undefined`.
 */
export function useDoingOrders(restaurantId: string) {
  const confirmed = useOrdersByStatus(restaurantId, "confirmed");
  const preparing = useOrdersByStatus(restaurantId, "preparing");
  const confirmedSettled = confirmed.data !== undefined || confirmed.isError;
  const preparingSettled = preparing.data !== undefined || preparing.isError;
  const anyData = confirmed.data !== undefined || preparing.data !== undefined;

  // O menor `dataUpdatedAt` das duas, ignorando zero (busca que ainda não
  // assentou) — a atualização mais velha não mente sobre nenhuma das duas.
  const settledUpdatedAts = [confirmed.dataUpdatedAt, preparing.dataUpdatedAt].filter((value) => value > 0);
  const updatedAt = settledUpdatedAts.length > 0 ? Math.min(...settledUpdatedAts) : 0;
  const refetch = () => void Promise.all([confirmed.refetch(), preparing.refetch()]);

  if (confirmedSettled && preparingSettled && anyData) {
    // Defensivo: as duas buscas assentam em momentos diferentes, e um
    // pedido pode mudar de status entre uma e outra (uma ação em Pedidos, ou
    // a própria bancada avançando o pedido). O filtro protege a coluna de um
    // pedido que já não é mais "doing" na hora em que as duas listas juntam.
    const joined = [...(confirmed.data ?? []), ...(preparing.data ?? [])].filter(
      (order) => kitchenColumn(order.status) === "doing",
    );
    return {
      orders: byArrival(joined),
      error: null,
      partialError: confirmed.isError ? confirmed.error : preparing.isError ? preparing.error : null,
      confirmedError: confirmed.error,
      preparingError: preparing.error,
      updatedAt,
      refetch,
    };
  }

  return {
    orders: undefined,
    error: confirmed.error ?? preparing.error,
    partialError: null,
    confirmedError: confirmed.error,
    preparingError: preparing.error,
    updatedAt,
    refetch,
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
