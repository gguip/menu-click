import { describe, expect, it } from "vitest";
import { listAllOrders, transitionOrder } from "../src/api/orders.ts";
import { mockApi } from "./api-mock.ts";
import { makeOrder, makeOrderDetail, RESTAURANT_ID } from "./fixtures.ts";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;

describe("API de pedidos", () => {
  it("pagina de 100 em 100 até trazer tudo — pedido aberto antigo não some", async () => {
    const api = mockApi([
      {
        method: "GET",
        path: LIST,
        query: { offset: "0" },
        body: { data: Array.from({ length: 100 }, () => makeOrder()), limit: 100, offset: 0, total: 101 },
      },
      {
        method: "GET",
        path: LIST,
        query: { offset: "100" },
        body: { data: [makeOrder()], limit: 100, offset: 100, total: 101 },
      },
    ]);
    const result = await listAllOrders(RESTAURANT_ID, { period: "today", sort: "createdAt", order: "desc" });
    expect(result.items).toHaveLength(101);
    expect(result.truncated).toBe(false);
    expect(api.calls[0].query).toEqual({
      period: "today",
      sort: "createdAt",
      order: "desc",
      limit: "100",
      offset: "0",
    });
  });

  it("estoura o teto de 10 páginas e devolve truncated: true, sem sumir calado", async () => {
    mockApi([
      {
        method: "GET",
        path: LIST,
        body: { data: Array.from({ length: 100 }, () => makeOrder()), limit: 100, offset: 0, total: 5000 },
      },
    ]);
    const result = await listAllOrders(RESTAURANT_ID, { period: "thisMonth", sort: "createdAt", order: "desc" });
    expect(result.items).toHaveLength(1000);
    expect(result.truncated).toBe(true);
  });

  it("intervalo manda from/to e nunca period", async () => {
    const api = mockApi([{ method: "GET", path: LIST, body: { data: [], limit: 100, offset: 0, total: 0 } }]);
    await listAllOrders(RESTAURANT_ID, { from: "2026-09-12", to: "2026-09-17", sort: "createdAt", order: "desc" });
    expect(api.calls[0].query.period).toBeUndefined();
    expect(api.calls[0].query).toMatchObject({ from: "2026-09-12", to: "2026-09-17" });
  });

  it("aceitar é o /confirm da API, sem corpo", async () => {
    const order = makeOrderDetail();
    const api = mockApi([{ method: "POST", path: `${LIST}/${order.id}/confirm`, body: order }]);
    await transitionOrder(RESTAURANT_ID, order.id, "accept");
    expect(api.calls[0].path).toBe(`${LIST}/${order.id}/confirm`);
    expect(api.calls[0].body).toBeUndefined();
  });
});
