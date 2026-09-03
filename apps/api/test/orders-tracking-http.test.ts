import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createOption,
  createOptionGroup,
  createOrder,
  createProduct,
  createRestaurant,
  linkOptionGroups,
  validDeliveryAddress,
} from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * A leitura HTTP do pedido pelo token de acompanhamento.
 *
 * É o gêmeo do canal WebSocket e existe por duas razões que ele não cobre: o
 * canal não transmite os **itens** (é mensagem de mudança, não de consulta), e
 * upgrade de WebSocket morre atrás de proxy corporativo.
 */
describe("ler o pedido pelo token", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Um pedido de retirada, que é modalidade que recebe token. */
  async function pedidoComToken() {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant, {
      name: "Ramen Shoyu",
      priceInCents: 4890,
      stock: 10,
    });
    const outro = await createProduct(app, restaurant, {
      name: "Guioza",
      priceInCents: 2490,
      stock: 10,
    });
    const order = await createOrder(
      app,
      restaurant.id,
      [
        { productId: produto.id, quantity: 2 },
        { productId: outro.id, quantity: 1 },
      ],
      { type: "takeaway" },
    );
    return { restaurant, order };
  }

  function ler(orderId: string, token: string) {
    return app.inject({
      method: "GET",
      url: `/orders/${orderId}?token=${encodeURIComponent(token)}`,
    });
  }

  it("200 sem sessão, com os itens que o WebSocket não manda", async () => {
    const { order } = await pedidoComToken();

    const response = await ler(order.id, order.trackingToken);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      id: order.id,
      type: "takeaway",
      status: "pending",
      totalInCents: 4890 * 2 + 2490,
    });
    // Busca por nome, e não por posição: os itens de um pedido nascem na
    // mesma transação, então `created_at` empata e o desempate acaba sendo o
    // uuid. A ordem é estável entre leituras, mas NÃO é a ordem em que o
    // cliente montou o carrinho — para isso faltaria uma coluna de posição.
    expect(body.items).toHaveLength(2);
    expect(
      body.items.find((i: { name: string }) => i.name === "Ramen Shoyu"),
    ).toMatchObject({ priceInCents: 4890, quantity: 2 });
    expect(
      body.items.find((i: { name: string }) => i.name === "Guioza"),
    ).toMatchObject({ priceInCents: 2490, quantity: 1 });
  });

  it("acompanha a mudança de status", async () => {
    const { restaurant, order } = await pedidoComToken();

    await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders/${order.id}/confirm`,
      headers: restaurant.headers,
    });

    expect((await ler(order.id, order.trackingToken)).json().status).toBe(
      "confirmed",
    );
  });

  it("entrega devolve o endereço congelado", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant, { stock: 5 });
    const order = await createOrder(
      app,
      restaurant.id,
      [{ productId: produto.id, quantity: 1 }],
      { type: "delivery", deliveryAddress: validDeliveryAddress },
    );

    const body = (await ler(order.id, order.trackingToken)).json();

    expect(body.deliveryAddress).toMatchObject({ street: "Rua Augusta" });
  });

  /**
   * S10: o que sai na superfície aberta é decidido campo a campo. O cliente
   * sabe o próprio nome; devolvê-lo numa rota autorizada por credencial de URL
   * seria reexpor dado pessoal sem ninguém ganhar nada.
   */
  it("não devolve o cliente, o restaurante nem o próprio token", async () => {
    const { order } = await pedidoComToken();

    const body = (await ler(order.id, order.trackingToken)).json();

    expect(body.customer).toBeUndefined();
    expect(body.restaurantId).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(order.trackingToken);
  });

  /**
   * O defeito reproduzido: o recibo do cliente tinha `priceInCents` e
   * `quantity` do item, mas não `unitPriceInCents` nem `options` — a conta não
   * fechava (produto × quantidade ≠ total) e o sabor escolhido sumia.
   */
  describe("itens com opções escolhidas", () => {
    /** Uma pizza com "Sabores" obrigatório, para exercitar o recibo. */
    async function pedidoComSabores() {
      const restaurant = await createRestaurant(app);
      const produto = await createProduct(app, restaurant, {
        name: "Pizza Grande",
        priceInCents: 3000,
        stock: 50,
      });
      const grupo = await createOptionGroup(app, restaurant, {
        name: "Sabores",
        minOptions: 1,
        maxOptions: 2,
        priceRule: "sum",
      });
      const calabresa = await createOption(app, restaurant, grupo.id, {
        name: "Calabresa",
        priceInCents: 2500,
      });
      const portuguesa = await createOption(app, restaurant, grupo.id, {
        name: "Portuguesa",
        priceInCents: 2500,
      });
      await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);

      const order = await createOrder(
        app,
        restaurant.id,
        [
          {
            productId: produto.id,
            quantity: 2,
            options: [
              { optionId: calabresa.id, quantity: 1 },
              { optionId: portuguesa.id, quantity: 1 },
            ],
          },
        ],
        { type: "takeaway" },
      );
      return { restaurant, order, grupo, calabresa, portuguesa };
    }

    it("mostra as opções com groupName e o recibo fecha a conta", async () => {
      const { order } = await pedidoComSabores();

      const body = (await ler(order.id, order.trackingToken)).json();

      expect(body.items).toHaveLength(1);
      const item = body.items[0];

      // 3000 (produto) + 2500 (calabresa) + 2500 (portuguesa)
      expect(item.priceInCents).toBe(3000);
      expect(item.unitPriceInCents).toBe(8000);
      expect(item.quantity).toBe(2);

      // é a dupla que fecha a conta do recibo — a mesma que o pedido do
      // restaurante já reportava, e que o cliente não via.
      expect(item.unitPriceInCents * item.quantity).toBe(body.totalInCents);
      expect(body.totalInCents).toBe(16000);

      expect(item.options).toHaveLength(2);
      const nomes = item.options.map(
        (o: { groupName: string; name: string }) => `${o.groupName}:${o.name}`,
      );
      expect(nomes).toContain("Sabores:Calabresa");
      expect(nomes).toContain("Sabores:Portuguesa");
      for (const opcao of item.options) {
        expect(opcao.priceInCents).toBe(2500);
        expect(opcao.quantity).toBe(1);
      }
    });

    /** S10: o identificador interno da opção não tem uso no recibo do cliente. */
    it("não devolve optionId", async () => {
      const { order } = await pedidoComSabores();

      const body = (await ler(order.id, order.trackingToken)).json();

      for (const opcao of body.items[0].options) {
        expect(opcao.optionId).toBeUndefined();
      }
      expect(JSON.stringify(body)).not.toContain('"optionId"');
    });

    /**
     * O pedido congela preço no momento da criação. Reprecificar a opção
     * depois não pode mudar o que o cliente já leu — nem pelo canal do
     * restaurante, nem por este.
     */
    it("reprecificar a opção depois não muda o que já foi congelado", async () => {
      const { restaurant, order, grupo, calabresa } = await pedidoComSabores();

      const antes = (await ler(order.id, order.trackingToken)).json();

      await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options/${calabresa.id}`,
        headers: restaurant.headers,
        payload: { priceInCents: 999999 },
      });

      const depois = (await ler(order.id, order.trackingToken)).json();

      expect(depois).toEqual(antes);
      expect(depois.totalInCents).toBe(16000);
    });
  });

  describe("autorização", () => {
    it("404 sem token válido", async () => {
      const { order } = await pedidoComToken();

      expect((await ler(order.id, "token-inventado")).statusCode).toBe(404);
    });

    /**
     * Sem conferir o id contra o pedido que o token resolve, um token legítimo
     * leria qualquer pedido — e a credencial deixaria de valer para um só.
     */
    it("404 com token de OUTRO pedido", async () => {
      const primeiro = await pedidoComToken();
      const segundo = await pedidoComToken();

      const response = await ler(
        primeiro.order.id,
        segundo.order.trackingToken,
      );

      expect(response.statusCode).toBe(404);
    });

    it("404 com pedido inexistente, mesmo com token válido", async () => {
      const { order } = await pedidoComToken();

      expect(
        (await ler(NONEXISTENT_ID, order.trackingToken)).statusCode,
      ).toBe(404);
    });

    /** Pedido de salão não recebe token, então não é legível por aqui. */
    it("pedido de salão não tem token para ler", async () => {
      const restaurant = await createRestaurant(app);
      const produto = await createProduct(app, restaurant, { stock: 5 });
      const order = await createOrder(app, restaurant.id, [
        { productId: produto.id, quantity: 1 },
      ]);

      expect(order.trackingToken).toBeUndefined();
      expect((await ler(order.id, "qualquer-coisa")).statusCode).toBe(404);
    });

    /**
     * S28: o token vem da querystring, que passa por schema — sem a validação
     * antes do uso, o hash de `undefined` viraria 500 em vez de 400.
     */
    it("400 sem o parâmetro token, não 500", async () => {
      const { order } = await pedidoComToken();

      const response = await app.inject({
        method: "GET",
        url: `/orders/${order.id}`,
      });

      expect(response.statusCode).toBe(400);
    });

    it("a sessão do restaurante não abre esta rota sem token", async () => {
      const { restaurant, order } = await pedidoComToken();

      const response = await app.inject({
        method: "GET",
        url: `/orders/${order.id}`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
