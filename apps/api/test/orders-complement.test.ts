// apps/api/test/orders-complement.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOrder, createProduct, createRestaurant, validDeliveryAddress } from "./helpers.ts";

/** "Apto 42, bloco B": o complemento, congelado com o resto do endereço. */
describe("complemento do endereço", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function delivery(complement?: string) {
    const r = await createRestaurant(app, { isDelivery: true });
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], {
      type: "delivery",
      deliveryAddress: { ...validDeliveryAddress, ...(complement === undefined ? {} : { complement }) },
    });
    return { r, order };
  }

  it("congela o complemento e devolve na criação, no detalhe, na listagem e no acompanhamento", async () => {
    const { r, order } = await delivery("  apto 42, bloco B  ");
    expect(order.deliveryAddress.complement).toBe("apto 42, bloco B");

    const detail = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders/${order.id}`, headers: r.headers });
    const list = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders`, headers: r.headers });
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });
    expect(detail.json().deliveryAddress.complement).toBe("apto 42, bloco B");
    expect(list.json().data[0].deliveryAddress.complement).toBe("apto 42, bloco B");
    expect(tracked.json().deliveryAddress.complement).toBe("apto 42, bloco B");
  });

  it("sem complemento, ou só com espaços, sai null", async () => {
    expect((await delivery()).order.deliveryAddress.complement).toBeNull();
    expect((await delivery("   ")).order.deliveryAddress.complement).toBeNull();
  });

  it("mais de 120 caracteres é 400", async () => {
    const r = await createRestaurant(app, { isDelivery: true });
    const p = await createProduct(app, r, { stock: 10 });
    const res = await app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders`,
      payload: {
        type: "delivery",
        customer: { name: "Ana", phone: "11999990000" },
        items: [{ productId: p.id, quantity: 1 }],
        paymentMethod: "pix",
        deliveryAddress: { ...validDeliveryAddress, complement: "x".repeat(121) },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // o value object compartilhado não ganhou o campo: no cadastro e na cotação o
  // complemento é descartado pelo validador (`removeAdditional`), nunca gravado
  it("o complemento não entra no endereço do restaurante nem na cotação", async () => {
    const r = await createRestaurant(app, { isDelivery: true });
    const patch = await app.inject({
      method: "PATCH",
      url: `/restaurants/${r.id}`,
      headers: r.headers,
      payload: { address: { ...validDeliveryAddress, complement: "sala 3" } },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().address).not.toHaveProperty("complement");
    const quote = await app.inject({
      method: "POST",
      url: `/menu/${r.slug}/delivery-quote`,
      payload: { address: { ...validDeliveryAddress, complement: "sala 3" }, subtotalInCents: 1000 },
    });
    expect(quote.statusCode).toBe(200);
  });
});
