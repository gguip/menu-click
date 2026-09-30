// apps/api/test/orders-cancel-reason.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOrder, createProduct, createRestaurant } from "./helpers.ts";

describe("motivo do cancelamento", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function takeaway() {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { type: "takeaway" });
    return { r, order };
  }

  function cancel(r: { id: string; headers: Record<string, string> }, orderId: string, payload?: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders/${orderId}/cancel`,
      headers: r.headers,
      ...(payload === undefined ? {} : { payload }),
    });
  }

  it("grava o motivo e mostra no detalhe e no acompanhamento, não na listagem", async () => {
    const { r, order } = await takeaway();
    expect((await cancel(r, order.id, { reason: "  Acabou o salmão  " })).statusCode).toBe(200);

    const detail = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders/${order.id}`, headers: r.headers });
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });
    const list = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders`, headers: r.headers });
    expect(detail.json().cancellationReason).toBe("Acabou o salmão");
    expect(tracked.json().cancellationReason).toBe("Acabou o salmão");
    expect(list.json().data[0]).not.toHaveProperty("cancellationReason");
  });

  it("sem corpo continua cancelando, e o motivo sai null", async () => {
    const { r, order } = await takeaway();
    expect((await cancel(r, order.id)).statusCode).toBe(200);
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });
    expect(tracked.json().cancellationReason).toBeNull();
  });

  it("motivo só com espaços é nenhum motivo; mais de 200 caracteres é 400", async () => {
    const a = await takeaway();
    await cancel(a.r, a.order.id, { reason: "   " });
    const tracked = await app.inject({ method: "GET", url: `/orders/${a.order.id}?token=${a.order.trackingToken}` });
    expect(tracked.json().cancellationReason).toBeNull();

    const b = await takeaway();
    expect((await cancel(b.r, b.order.id, { reason: "x".repeat(201) })).statusCode).toBe(400);
  });

  it("pedido em andamento tem motivo null", async () => {
    const { order } = await takeaway();
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });
    expect(tracked.json().cancellationReason).toBeNull();
  });
});
