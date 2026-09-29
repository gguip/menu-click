import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOrder, createProduct, createRestaurant } from "./helpers.ts";

/** "Sem cebola": a observação do item, congelada e separando linhas. */
describe("observação no item", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("congela a observação e separa linhas com observações diferentes", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [
      { productId: p.id, quantity: 1, note: "sem cebola" },
      { productId: p.id, quantity: 2, note: "sem cebola" },
      { productId: p.id, quantity: 1 },
    ]);
    const notes = order.items.map((item: { note: string | null; quantity: number }) => [item.note, item.quantity]);
    expect(notes).toEqual(expect.arrayContaining([["sem cebola", 3], [null, 1]]));
    expect(order.items).toHaveLength(2);
  });

  it("observação só com espaços é nenhuma observação", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [
      { productId: p.id, quantity: 1, note: "   " },
      { productId: p.id, quantity: 1 },
    ]);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ note: null, quantity: 2 });
  });

  it("mais de 140 caracteres é 400", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const res = await app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders`,
      payload: {
        type: "dine_in",
        customer: { name: "Ana", phone: "11999990000" },
        items: [{ productId: p.id, quantity: 1, note: "x".repeat(141) }],
        paymentMethod: "cash",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("sai no detalhe do painel e no acompanhamento", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1, note: "bem passado" }], {
      type: "takeaway",
    });
    const detail = await app.inject({
      method: "GET",
      url: `/restaurants/${r.id}/orders/${order.id}`,
      headers: r.headers,
    });
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });
    expect(detail.json().items[0].note).toBe("bem passado");
    expect(tracked.json().items[0].note).toBe("bem passado");
  });
});
