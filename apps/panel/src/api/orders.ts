import { apiRequest } from "./client.ts";
import { type FetchAllResult, fetchAllPages } from "./pagination.ts";
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
 * pedido aberto antigo cairia da página 1 e SUMIRIA do kanban. `truncated`
 * sai `true` quando o teto de 10 páginas (1000 pedidos) é atingido com
 * pedido ainda restando — quem chama mostra isso, em vez de exibir uma lista
 * curta como se fosse o total.
 */
export function listAllOrders(restaurantId: string, query: OrderListQuery): Promise<FetchAllResult<Order>> {
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
 * Todos os `pending` DE HOJE. É o que o aviso de pedido novo vigia —
 * independente do filtro que o kanban estiver mostrando, e de qual tela do
 * painel estiver aberta. Escopado a `period: "today"` de propósito (FIX 5 da
 * revisão): sem isso, um pedido nunca recusado de dias atrás mantinha o rail
 * âmbar e o título da aba incrementado para sempre, e o conjunto vigiado
 * deixava de ser o mesmo que o operador vê no kanban ("Novos" já é filtrado
 * por hoje). O custo aceito: um `pending` das 23:55 para de ser vigiado à
 * meia-noite — ele sai do "hoje" mesmo continuando pendente.
 */
export function listPendingOrders(restaurantId: string): Promise<Order[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<Order>>(`/restaurants/${restaurantId}/orders`, {
      query: { status: "pending", period: "today", sort: "createdAt", order: "asc", limit: 100, offset },
    }),
  ).then((result) => result.items);
}
