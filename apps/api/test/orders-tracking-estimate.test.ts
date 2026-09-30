// apps/api/test/orders-tracking-estimate.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOrder, createProduct, createRestaurant } from "./helpers.ts";

describe("acompanhamento: horários e previsão", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("devolve o histórico de status e a previsão depois de confirmado", async () => {
    const r = await createRestaurant(app);
    await app.inject({ method: "PATCH", url: `/restaurants/${r.id}`, headers: r.headers, payload: { prepTimeMinutes: 25 } });
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { type: "takeaway" });
    const track = () => app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });

    const antes = (await track()).json();
    expect(antes.statusHistory.map((e: { status: string }) => e.status)).toEqual(["pending"]);
    expect(antes.estimate).toBeNull();

    await app.inject({ method: "POST", url: `/restaurants/${r.id}/orders/${order.id}/confirm`, headers: r.headers });
    const depois = (await track()).json();
    const confirmedAt = depois.statusHistory.find((e: { status: string }) => e.status === "confirmed").at;
    expect(depois.estimate).toEqual({
      readyAt: new Date(Date.parse(confirmedAt) + 25 * 60_000).toISOString(),
    });
  });

  it("sem tempo configurado, a previsão é null (e a chave existe)", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { type: "takeaway" });
    await app.inject({ method: "POST", url: `/restaurants/${r.id}/orders/${order.id}/confirm`, headers: r.headers });
    const body = (await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` })).json();
    expect(body).toHaveProperty("estimate", null);
  });
});
