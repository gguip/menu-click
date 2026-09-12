import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createOrder,
  createProduct,
  createRestaurant,
  validCustomerBody,
} from "./helpers.ts";

/**
 * A forma de pagamento no pedido, e o troco.
 *
 * Três regras: forma que o restaurante não aceita é 409 (mesma pergunta de
 * `assertRestauranteAceita`); troco incoerente é 400, porque é o corpo que não
 * faz sentido, não o estado do sistema; e o troco é sempre comparado com o
 * total calculado no SERVIDOR — o corpo não tem `totalInCents`.
 */
describe("forma de pagamento", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Uma loja aberta agora, com um produto de R$ 48,90. */
  async function cenario() {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant, {
      priceInCents: 4890,
      stock: 10,
    });
    return { restaurant, produto };
  }

  it("201 com dinheiro e troco", async () => {
    const { restaurant, produto } = await cenario();

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "takeaway",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "cash",
        changeForInCents: 5000,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      paymentMethod: "cash",
      changeForInCents: 5000,
    });
  });

  /**
   * Ausência de `changeForInCents` significa "tenho o valor certo" — exigi-lo
   * obrigaria quem paga exato a inventar um número.
   */
  it("201 com dinheiro sem troco: changeForInCents ausente na resposta", async () => {
    const { restaurant, produto } = await cenario();

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "takeaway",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "cash",
      },
    });

    expect(response.statusCode).toBe(201);
    const order = response.json();
    expect(order.paymentMethod).toBe("cash");
    expect(order.changeForInCents).toBeUndefined();
  });

  it("201 no pix, sem troco", async () => {
    const { restaurant, produto } = await cenario();

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "takeaway",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "pix",
      },
    });

    expect(response.statusCode).toBe(201);
    const order = response.json();
    expect(order.paymentMethod).toBe("pix");
    expect(order.changeForInCents).toBeUndefined();
  });

  it("409 com forma que o restaurante não aceita", async () => {
    const { restaurant, produto } = await cenario();

    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { acceptsPix: false },
    });

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "takeaway",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "pix",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("pix");
  });

  it("400 com changeForInCents em forma que não é dinheiro", async () => {
    const { restaurant, produto } = await cenario();

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "takeaway",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "pix",
        changeForInCents: 5000,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("Troco");
  });

  /**
   * Pedir troco para R$ 10 numa conta de R$ 48,90 não é um pedido, é um
   * engano — e o entregador descobriria na porta. A comparação é com o total
   * calculado no SERVIDOR: o corpo não tem `totalInCents`, e aceitar um
   * número do cliente deixaria a validação inteira sem sentido.
   */
  it("400 quando o troco é menor que o total", async () => {
    const { restaurant, produto } = await cenario();

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "takeaway",
        customer: { name: "Ana", phone: "11999990000" },
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "cash",
        changeForInCents: 1000,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("troco");
  });

  /** Pagar com o valor exato em nota fechada é válido: igual não é menor. */
  it("changeForInCents igual ao total é válido", async () => {
    const { restaurant, produto } = await cenario();

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "takeaway",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "cash",
        changeForInCents: 4890,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().changeForInCents).toBe(4890);
  });

  it("400 sem paymentMethod: o campo é obrigatório no corpo", async () => {
    const { restaurant, produto } = await cenario();

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "takeaway",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com forma fora do enum", async () => {
    const { restaurant, produto } = await cenario();

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "takeaway",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "bitcoin",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("o detalhe do restaurante mostra os dois campos", async () => {
    const { restaurant, produto } = await cenario();
    const created = await createOrder(
      app,
      restaurant.id,
      [{ productId: produto.id, quantity: 1 }],
      { type: "takeaway", paymentMethod: "cash", changeForInCents: 5000 },
    );

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders/${created.id}`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      paymentMethod: "cash",
      changeForInCents: 5000,
    });
  });

  /** É onde a cozinha decide o troco antes de despachar. */
  it("a listagem do restaurante mostra os dois campos", async () => {
    const { restaurant, produto } = await cenario();
    await createOrder(
      app,
      restaurant.id,
      [{ productId: produto.id, quantity: 1 }],
      { type: "takeaway", paymentMethod: "cash", changeForInCents: 5000 },
    );

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({
      paymentMethod: "cash",
      changeForInCents: 5000,
    });
  });

  it("o recibo do cliente mostra os dois campos", async () => {
    const { restaurant, produto } = await cenario();
    const created = await createOrder(
      app,
      restaurant.id,
      [{ productId: produto.id, quantity: 1 }],
      { type: "takeaway", paymentMethod: "cash", changeForInCents: 5000 },
    );

    const response = await app.inject({
      method: "GET",
      url: `/orders/${created.id}?token=${encodeURIComponent(created.trackingToken)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      paymentMethod: "cash",
      changeForInCents: 5000,
    });
  });
});
