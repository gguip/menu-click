import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listNeighborhoods } from "../../api/delivery.ts";
import { getOrder, listAllOrders } from "../../api/orders.ts";
import { listAllTables } from "../../api/tables.ts";
import type { Restaurant } from "../../api/types.ts";
import { type OrderFilters, toListQuery } from "./orderFilters.ts";
import { ORDERS_POLL_MS } from "./polling.ts";

/**
 * Polling também com a aba em segundo plano: o painel passa o dia atrás de
 * outras janelas, e ninguém vai apertar F5.
 */
export function useOrders(restaurantId: string, filters: OrderFilters) {
  const query = toListQuery(filters);
  return useQuery({
    queryKey: ["orders", "list", restaurantId, query],
    queryFn: () => listAllOrders(restaurantId, query),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
  });
}

export function useOrder(restaurantId: string, orderId: string) {
  return useQuery({
    queryKey: ["orders", "detail", restaurantId, orderId],
    queryFn: () => getOrder(restaurantId, orderId),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

export function useTables(restaurantId: string) {
  return useQuery({
    queryKey: ["tables", restaurantId],
    queryFn: () => listAllTables(restaurantId),
    staleTime: 5 * 60_000,
  });
}

/**
 * "Entrega por bairro sem nenhum bairro cadastrado": não é frete grátis — a
 * loja recusa pedidos de entrega sem ninguém perceber. Por isso vira alerta
 * persistente em Pedidos, e não erro de formulário (correção do handoff).
 */
export function useDeliveryAlert(restaurantId: string, restaurant: Restaurant | undefined): boolean {
  const byNeighborhood = restaurant?.isDelivery === true && restaurant.deliveryFeeMode === "neighborhood";
  const neighborhoods = useQuery({
    queryKey: ["delivery-neighborhoods", restaurantId],
    queryFn: () => listNeighborhoods(restaurantId),
    enabled: byNeighborhood,
    staleTime: 60_000,
  });
  return byNeighborhood && neighborhoods.data !== undefined && neighborhoods.data.length === 0;
}
