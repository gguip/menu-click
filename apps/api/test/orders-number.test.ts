import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp, createOrder, createProduct, createRestaurant } from "./helpers.ts";

/**
 * O número do pedido: contínuo por loja, sem buraco, e sem colidir sob
 * concorrência. É o `#1042` que o painel fala no balcão.
 */
describe("número do pedido", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("começa em 1 e sobe de um em um, por loja", async () => {
    const a = await createRestaurant(app);
    const b = await createRestaurant(app);
    const pa = await createProduct(app, a, { stock: 100 });
    const pb = await createProduct(app, b, { stock: 100 });

    const a1 = await createOrder(app, a.id, [{ productId: pa.id, quantity: 1 }]);
    const a2 = await createOrder(app, a.id, [{ productId: pa.id, quantity: 1 }]);
    const b1 = await createOrder(app, b.id, [{ productId: pb.id, quantity: 1 }]);

    expect([a1.number, a2.number, b1.number]).toEqual([1, 2, 1]);
  });

  it("sai na listagem, no detalhe e no acompanhamento público", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 100 });
    const created = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { type: "takeaway" });

    const list = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders`, headers: r.headers });
    const detail = await app.inject({
      method: "GET",
      url: `/restaurants/${r.id}/orders/${created.id}`,
      headers: r.headers,
    });
    const tracked = await app.inject({
      method: "GET",
      url: `/orders/${created.id}?token=${created.trackingToken}`,
    });

    expect(list.json().data[0].number).toBe(1);
    expect(detail.json().number).toBe(1);
    expect(tracked.json().number).toBe(1);
  });

  it("criação que falha depois do número não queima o número", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 100, priceInCents: 5000 });
    await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }]);
    // troco menor que o total: 400 no serviço, DEPOIS do incremento
    const falha = await app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders`,
      payload: {
        type: "dine_in",
        customer: { name: "Ana", phone: "11999990000" },
        items: [{ productId: p.id, quantity: 1 }],
        paymentMethod: "cash",
        changeForInCents: 100,
      },
    });
    expect(falha.statusCode).toBe(400);

    const next = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }]);
    expect(next.number).toBe(2);
  });

  it("criações simultâneas na mesma loja recebem números distintos e contíguos", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 1000 });
    // 🚨 pool aquecido: com conexões frias, cada criação espera o handshake e
    // elas nunca se sobrepõem — o teste passaria mesmo sem o lock do contador
    await Promise.all(Array.from({ length: 10 }, () => pool.query("select pg_sleep(0.01)")));

    const orders = await Promise.all(
      Array.from({ length: 10 }, () => createOrder(app, r.id, [{ productId: p.id, quantity: 1 }])),
    );

    const numbers = orders.map((order) => order.number).sort((x, y) => x - y);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("o contador da loja não sai na resposta do restaurante", async () => {
    const r = await createRestaurant(app);
    const response = await app.inject({ method: "GET", url: `/restaurants/${r.id}`, headers: r.headers });
    expect(response.json().lastOrderNumber).toBeUndefined();
  });
});
