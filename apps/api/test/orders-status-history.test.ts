import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp, createOrder, createProduct, createRestaurant, type TestRestaurant } from "./helpers.ts";

/** O Andamento do painel: quando o pedido entrou em cada status. */
describe("histórico de status do pedido", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function step(r: TestRestaurant, orderId: string, action: string) {
    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders/${orderId}/${action}`,
      headers: r.headers,
    });
    expect(response.statusCode).toBe(200);
  }

  async function detail(r: TestRestaurant, orderId: string) {
    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${r.id}/orders/${orderId}`,
      headers: r.headers,
    });
    return response.json();
  }

  it("grava a criação e cada transição, em ordem", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }]);
    await step(r, order.id, "confirm");
    await step(r, order.id, "start-preparing");
    await step(r, order.id, "complete");

    const { statusHistory } = await detail(r, order.id);

    expect(statusHistory.map((e: { status: string }) => e.status)).toEqual([
      "pending",
      "confirmed",
      "preparing",
      "completed",
    ]);
    for (const event of statusHistory) expect(Number.isNaN(Date.parse(event.at))).toBe(false);
  });

  it("cancelamento entra no histórico", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }]);
    await step(r, order.id, "cancel");

    const { statusHistory } = await detail(r, order.id);
    expect(statusHistory.map((e: { status: string }) => e.status)).toEqual(["pending", "cancelled"]);
  });

  it("transição recusada (409) não grava evento", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }]);
    const recusada = await app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders/${order.id}/complete`,
      headers: r.headers,
    });
    expect(recusada.statusCode).toBe(409);

    const { rows } = await pool.query("select status from order_status_events where order_id = $1", [order.id]);
    expect(rows.map((row) => row.status)).toEqual(["pending"]);
  });

  it("o histórico sai só no detalhe: nem na listagem, nem no acompanhamento", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { type: "takeaway" });

    const list = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders`, headers: r.headers });
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });

    expect(list.json().data[0].statusHistory).toBeUndefined();
    expect(tracked.json().statusHistory).toBeUndefined();
  });
});
