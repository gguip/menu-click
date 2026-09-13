import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createProduct,
  createRestaurant,
  validCustomerBody,
  validDeliveryAddress,
} from "./helpers.ts";
import type { TestRestaurant } from "./helpers.ts";

/**
 * Pedido mínimo.
 *
 * Vale **só em entrega**: o mínimo existe porque entrega tem custo de piso —
 * sai entregador, sai veículo. Retirada e salão não custam nada a mais à loja,
 * e recusar um café de R$ 5 no balcão só perderia venda.
 */
describe("pedido mínimo", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Loja com mínimo configurado e um produto de `priceInCents`. */
  async function loja(
    slug: string,
    minimumOrderInCents: number,
    priceInCents: number,
    extras: Record<string, unknown> = {},
  ) {
    const restaurant = await createRestaurant(app, { slug });
    const patch = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { minimumOrderInCents, ...extras },
    });
    if (patch.statusCode !== 200) {
      throw new Error(`configurar a loja falhou: ${patch.body}`);
    }
    const produto = await createProduct(app, restaurant, {
      priceInCents,
      stock: 100,
    });
    return { restaurant, produto };
  }

  function pede(
    restaurant: TestRestaurant,
    produtoId: string,
    quantity: number,
    overrides: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "delivery",
        customer: validCustomerBody,
        deliveryAddress: validDeliveryAddress,
        items: [{ productId: produtoId, quantity }],
        paymentMethod: "cash",
        ...overrides,
      },
    });
  }

  it("configura o mínimo por PATCH e devolve na leitura", async () => {
    const restaurant = await createRestaurant(app, { slug: "min-config" });

    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      // valor diferente do default (0) de propósito: com o default, a leitura
      // bateria mesmo que o PATCH nunca escrevesse a coluna
      payload: { minimumOrderInCents: 5000 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().minimumOrderInCents).toBe(5000);
  });

  it("restaurante nasce sem mínimo", async () => {
    const restaurant = await createRestaurant(app, { slug: "min-zero" });

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
    });

    // zero É "sem mínimo": desligar não precisa de tratamento especial
    expect(response.json().minimumOrderInCents).toBe(0);
  });

  it("recusa entrega abaixo do mínimo com 409", async () => {
    const { restaurant, produto } = await loja("min-abaixo", 5000, 3000);

    const response = await pede(restaurant, produto.id, 1);

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("50");
  });

  it("aceita entrega exatamente no mínimo — o limite é inclusivo", async () => {
    // exclusivo faria o pedido de R$ 50,00 ser recusado e o de R$ 50,01
    // passar, o que ninguém consegue explicar ao cliente
    const { restaurant, produto } = await loja("min-exato", 5000, 5000);

    expect((await pede(restaurant, produto.id, 1)).statusCode).toBe(201);
  });

  it("aceita entrega acima do mínimo", async () => {
    const { restaurant, produto } = await loja("min-acima", 5000, 3000);

    expect((await pede(restaurant, produto.id, 2)).statusCode).toBe(201);
  });

  /**
   * 🚨 O mínimo compara com o SUBTOTAL dos itens, nunca com o total.
   *
   * Aqui a mercadoria é R$ 40,00 e o frete R$ 15,00 — o total passa dos R$
   * 50,00 do mínimo, e mesmo assim o pedido é recusado. É o ponto inteiro da
   * regra: a loja não quer sair para entregar R$ 40 de comida, e somar o
   * frete para atingir o mínimo faria o cliente pagar mais para contornar
   * exatamente o que a loja quis evitar.
   */
  it("compara com o subtotal, não com o total com frete", async () => {
    const { restaurant, produto } = await loja("min-subtotal", 5000, 4000, {
      deliveryFixedFeeInCents: 1500,
    });

    const response = await pede(restaurant, produto.id, 1);

    expect(response.statusCode).toBe(409);
  });

  it("não se aplica a retirada", async () => {
    const { restaurant, produto } = await loja("min-retirada", 5000, 3000);

    const response = await pede(restaurant, produto.id, 1, {
      type: "takeaway",
      deliveryAddress: undefined,
    });

    expect(response.statusCode).toBe(201);
  });

  it("não se aplica a pedido de salão", async () => {
    const { restaurant, produto } = await loja("min-salao", 5000, 3000);

    const response = await pede(restaurant, produto.id, 1, {
      type: "dine_in",
      deliveryAddress: undefined,
    });

    expect(response.statusCode).toBe(201);
  });

  /**
   * Expor um campo no cardápio exige TRÊS lugares — o `Pick` de
   * `MenuRestaurant`, a cópia em `toMenuRestaurant` e o `schema.response` da
   * rota —, e cada um tem uma guarda diferente.
   *
   * Os dois primeiros são pegos pelo **type-check**: tirar o campo do `Pick`
   * faz o `tsc` reclamar da cópia. Este teste pega o terceiro, que é o que de
   * fato filtra a saída — sem ele no schema, o `fast-json-stringify` descarta
   * o campo e a tela nunca vê o mínimo, sem erro nenhum.
   *
   * Verificado nas três mutações: só a do schema chega aqui.
   */
  it("o cardápio anuncia o mínimo, para a tela avisar antes do carrinho", async () => {
    await loja("min-cardapio", 5000, 3000);

    const response = await app.inject({
      method: "GET",
      url: "/menu/min-cardapio",
    });

    expect(response.json().minimumOrderInCents).toBe(5000);
  });
});
