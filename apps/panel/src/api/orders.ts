import { apiRequest } from "./client.ts";
import { fetchAllPages } from "./pagination.ts";
import type {
  Order,
  OrderDetail,
  OrdersSummary,
  OrderTransition,
  Page,
  Period,
} from "./types.ts";

/** Período OU intervalo — a API responde 400 se receber os dois. */
export type OrderRange = { period: Period } | { from: string; to: string };

export type OrderListQuery = OrderRange & {
  tableId?: string;
  sort: "createdAt" | "totalInCents";
  order: "asc" | "desc";
};

export function rangeQuery(range: OrderRange): Record<string, string> {
  return "period" in range ? { period: range.period } : { from: range.from, to: range.to };
}

// "accept" é vocabulário do painel; na API a rota é /confirm.
const ENDPOINT: Record<OrderTransition, string> = {
  accept: "confirm",
  "start-preparing": "start-preparing",
  dispatch: "dispatch",
  ready: "ready",
  complete: "complete",
  cancel: "cancel",
};

/**
 * Todas as páginas, não só a primeira: com "mais recentes" num dia cheio, um
 * pedido aberto antigo cairia da página 1 e SUMIRIA do kanban.
 */
export function listAllOrders(restaurantId: string, query: OrderListQuery): Promise<Order[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<Order>>(`/restaurants/${restaurantId}/orders`, {
      query: {
        ...rangeQuery(query),
        tableId: query.tableId,
        sort: query.sort,
        order: query.order,
        limit: 100,
        offset,
      },
    }),
  );
}

export function getOrder(restaurantId: string, orderId: string): Promise<OrderDetail> {
  return apiRequest<OrderDetail>(`/restaurants/${restaurantId}/orders/${orderId}`);
}

export function transitionOrder(
  restaurantId: string,
  orderId: string,
  transition: OrderTransition,
): Promise<OrderDetail> {
  return apiRequest<OrderDetail>(
    `/restaurants/${restaurantId}/orders/${orderId}/${ENDPOINT[transition]}`,
    { method: "POST" },
  );
}

export function getOrdersSummary(restaurantId: string, range: OrderRange): Promise<OrdersSummary> {
  return apiRequest<OrdersSummary>(`/restaurants/${restaurantId}/orders/summary`, {
    query: rangeQuery(range),
  });
}

/**
 * Todos os `pending`, de qualquer data (sem período, a API não filtra por
 * data). É o que o aviso de pedido novo vigia — independente do filtro que o
 * kanban estiver mostrando, e de qual tela do painel estiver aberta.
 */
export function listPendingOrders(restaurantId: string): Promise<Order[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<Order>>(`/restaurants/${restaurantId}/orders`, {
      query: { status: "pending", sort: "createdAt", order: "asc", limit: 100, offset },
    }),
  );
}
