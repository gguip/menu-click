import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createOrder,
  createProduct,
  createRestaurant,
  validCustomerBody,
  validDeliveryAddress,
} from "./helpers.ts";

/**
 * Criação e leitura de pedidos.
 *
 * O que estes testes fixam, além do CRUD: o total é calculado no servidor, os
 * itens congelam nome e preço do produto, e criar pedido **não** mexe em
 * estoque (a baixa é na confirmação).
 */
describe("pedidos", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /restaurants/:restaurantId/orders", () => {
    it("cria pedido de mesa: pending, sem endereço, com os itens", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant, {
        name: "Ramen Shoyu",
        priceInCents: 4890,
      });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: {
          type: "dine_in",
          customer: validCustomerBody,
          items: [{ productId: product.id, quantity: 2 }],
          paymentMethod: "cash",
        },
      });

      expect(response.statusCode).toBe(201);
      const order = response.json();
      expect(order).toMatchObject({
        restaurantId: restaurant.id,
        status: "pending",
        totalInCents: 9780,
        deliveryAddress: null,
        customer: { name: "Ana Souza", phone: "11999990000" },
      });
      expect(order.items).toHaveLength(1);
      expect(order.items[0]).toMatchObject({
        productId: product.id,
        name: "Ramen Shoyu",
        priceInCents: 4890,
        quantity: 2,
      });
    });

    it("soma o total de vários itens, no servidor", async () => {
      const restaurant = await createRestaurant(app);
      const ramen = await createProduct(app, restaurant, {
        name: "Ramen",
        priceInCents: 4890,
      });
      const guioza = await createProduct(app, restaurant, {
        name: "Guioza",
        priceInCents: 2250,
      });

      const order = await createOrder(app, restaurant.id, [
        { productId: ramen.id, quantity: 2 },
        { productId: guioza.id, quantity: 3 },
      ]);

      // 4890*2 + 2250*3
      expect(order.totalInCents).toBe(16530);
    });

    it("ignora um `totalInCents` enviado pelo cliente", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant, {
        priceInCents: 4890,
      });

      const order = await createOrder(
        app,
        restaurant.id,
        [{ productId: product.id, quantity: 1 }],
        { totalInCents: 1 },
      );

      expect(order.totalInCents).toBe(4890);
    });

    it("congela nome e preço: reajustar o cardápio não mexe no pedido", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant, {
        name: "Ramen Shoyu",
        priceInCents: 4890,
      });
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 2 },
      ]);

      await app.inject({
        method: "PATCH",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/products/${product.id}`,
        payload: { name: "Ramen Shoyu Especial", priceInCents: 6000 },
      });

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/orders/${order.id}`,
      });

      const reloaded = response.json();
      expect(reloaded.items[0]).toMatchObject({
        name: "Ramen Shoyu",
        priceInCents: 4890,
      });
      expect(reloaded.totalInCents).toBe(9780);
    });

    it("duas linhas do mesmo produto viram uma, com a quantidade somada", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant, {
        priceInCents: 1000,
      });

      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 2 },
        { productId: product.id, quantity: 3 },
      ]);

      expect(order.items).toHaveLength(1);
      expect(order.items[0].quantity).toBe(5);
      expect(order.totalInCents).toBe(5000);
    });

    it("criar pedido não dá baixa em estoque", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant, { stock: 10 });

      await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 4 },
      ]);

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/products/${product.id}`,
      });
      expect(response.json().stock).toBe(10);
    });

    it("pedido de entrega leva o endereço", async () => {
      const restaurant = await createRestaurant(app, { isDelivery: true });
      const product = await createProduct(app, restaurant);

      const order = await createOrder(
        app,
        restaurant.id,
        [{ productId: product.id, quantity: 1 }],
        { type: "delivery", deliveryAddress: validDeliveryAddress },
      );

      expect(order.type).toBe("delivery");
      expect(order.deliveryAddress).toMatchObject({
        street: "Rua Augusta",
        city: "São Paulo",
      });
    });

    it("pedido de retirada não leva endereço e nasce takeaway", async () => {
      const restaurant = await createRestaurant(app, { isTakeaway: true });
      const product = await createProduct(app, restaurant);

      const order = await createOrder(
        app,
        restaurant.id,
        [{ productId: product.id, quantity: 1 }],
        { type: "takeaway" },
      );

      expect(order.type).toBe("takeaway");
      expect(order.deliveryAddress).toBeNull();
    });

    /**
     * As três flags do restaurante são simétricas: sem `isTakeaway`, um
     * restaurante que só entrega aceitaria retirada por omissão.
     */
    const modalidadesRecusadas: [string, string, Record<string, unknown>][] = [
      ["entrega", "delivery", { isDelivery: false }],
      ["retirada", "takeaway", { isTakeaway: false }],
      ["salão", "dine_in", { isQrcode: false }],
    ];

    it.each(modalidadesRecusadas)(
      "409 ao pedir %s em restaurante que não aceita",
      async (_nome, type, flags) => {
        const restaurant = await createRestaurant(app, flags);
        const product = await createProduct(app, restaurant);

        const response = await app.inject({
          method: "POST",
          url: `/restaurants/${restaurant.id}/orders`,
          payload: {
            type,
            customer: validCustomerBody,
            items: [{ productId: product.id, quantity: 1 }],
            paymentMethod: "cash",
            ...(type === "delivery"
              ? { deliveryAddress: validDeliveryAddress }
              : {}),
          },
        });

        expect(response.statusCode).toBe(409);
      },
    );

    it("400 em pedido de entrega sem endereço", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: {
          type: "delivery",
          customer: validCustomerBody,
          items: [{ productId: product.id, quantity: 1 }],
        },
      });

      // 400 e não 409: o corpo é que não faz sentido, não o estado do sistema
      expect(response.statusCode).toBe(400);
    });

    it.each(["dine_in", "takeaway"])(
      "400 ao mandar endereço num pedido de %s",
      async (type) => {
        const restaurant = await createRestaurant(app);
        const product = await createProduct(app, restaurant);

        const response = await app.inject({
          method: "POST",
          url: `/restaurants/${restaurant.id}/orders`,
          payload: {
            type,
            customer: validCustomerBody,
            items: [{ productId: product.id, quantity: 1 }],
            deliveryAddress: validDeliveryAddress,
          },
        });

        expect(response.statusCode).toBe(400);
      },
    );

    it("400 sem `type`", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: {
          customer: validCustomerBody,
          items: [{ productId: product.id, quantity: 1 }],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("404 com produto de outro restaurante", async () => {
      const restaurantA = await createRestaurant(app);
      const restaurantB = await createRestaurant(app);
      const product = await createProduct(app, restaurantB);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurantA.id}/orders`,
        payload: {
          type: "dine_in",
          customer: validCustomerBody,
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: "cash",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("404 com produto removido", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant);
      await app.inject({
        method: "DELETE",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/products/${product.id}`,
      });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: {
          type: "dine_in",
          customer: validCustomerBody,
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: "cash",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("404 com restaurante inexistente", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/restaurants/00000000-0000-0000-0000-000000000000/orders",
        payload: {
          type: "dine_in",
          customer: validCustomerBody,
          items: [
            {
              productId: "00000000-0000-0000-0000-000000000001",
              quantity: 1,
            },
          ],
          paymentMethod: "cash",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("mesmo telefone reaproveita o cliente e atualiza o nome", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant);
      const items = [{ productId: product.id, quantity: 1 }];

      const first = await createOrder(app, restaurant.id, items);
      const second = await createOrder(app, restaurant.id, items, {
        customer: { name: "Ana S. Souza", phone: "11999990000" },
      });

      expect(second.customer.id).toBe(first.customer.id);
      expect(second.customer.name).toBe("Ana S. Souza");
    });

    it("400 com lista de itens vazia", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: { type: "dine_in", customer: validCustomerBody, items: [] },
      });

      expect(response.statusCode).toBe(400);
    });

    it("400 com quantity string (o validador estrito não coage)", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: {
          type: "dine_in",
          customer: validCustomerBody,
          items: [{ productId: product.id, quantity: "2" }],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("400 com quantity zero", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: {
          type: "dine_in",
          customer: validCustomerBody,
          items: [{ productId: product.id, quantity: 0 }],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("400 sem cliente", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: {
          type: "dine_in",
          items: [{ productId: product.id, quantity: 1 }],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /restaurants/:restaurantId/orders", () => {
    it("envelope paginado, sem os itens", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant);
      const items = [{ productId: product.id, quantity: 1 }];
      await createOrder(app, restaurant.id, items);
      await createOrder(app, restaurant.id, items, {
        customer: { name: "Bruno Lima", phone: "11988887777" },
      });

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/orders`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ limit: 20, offset: 0, total: 2 });
      expect(body.data).toHaveLength(2);
      expect(body.data[0].items).toBeUndefined();
      // o default é do mais novo para o mais antigo, então o de Bruno vem
      // primeiro (ver orders-sort.test.ts)
      expect(body.data[0].customer.phone).toBe("11988887777");
      expect(body.data[1].customer.phone).toBe("11999990000");
    });

    it("lista só os pedidos do restaurante da URL", async () => {
      const restaurantA = await createRestaurant(app);
      const restaurantB = await createRestaurant(app);
      const productA = await createProduct(app, restaurantA);
      const productB = await createProduct(app, restaurantB);

      await createOrder(app, restaurantA.id, [
        { productId: productA.id, quantity: 1 },
      ]);
      await createOrder(app, restaurantB.id, [
        { productId: productB.id, quantity: 1 },
      ]);

      const response = await app.inject({
        method: "GET",
        headers: restaurantA.headers,
        url: `/restaurants/${restaurantA.id}/orders`,
      });

      expect(response.json().total).toBe(1);
    });

    it("filtra por status", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant);
      await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 1 },
      ]);

      const pending = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/orders?status=pending`,
      });
      const confirmed = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/orders?status=confirmed`,
      });

      expect(pending.json().total).toBe(1);
      expect(confirmed.json().total).toBe(0);
      expect(confirmed.json().data).toEqual([]);
    });

    it("400 com status fora do enum", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/orders?status=entregue`,
      });

      expect(response.statusCode).toBe(400);
    });

    it("404 ao listar pedidos de restaurante que não é o da sessão", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: "/restaurants/00000000-0000-0000-0000-000000000000/orders",
        headers: restaurant.headers,
      });

      // 404 e não 403: responder "proibido" confirmaria a existência
      expect(response.statusCode).toBe(404);
    });

    it("401 sem sessão: a lista de pedidos tem nome e telefone de cliente", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/orders`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /restaurants/:restaurantId/orders/:orderId", () => {
    it("devolve o pedido com os itens", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant);
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 2 },
      ]);

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/orders/${order.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().items).toHaveLength(1);
    });

    it("404 com id inexistente", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/orders/00000000-0000-0000-0000-000000000000`,
      });

      expect(response.statusCode).toBe(404);
    });

    it("404 com id fora do formato uuid (não 500)", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/orders/nao-e-uuid`,
      });

      expect(response.statusCode).toBe(404);
    });

    it("404 ao buscar pedido de outro restaurante", async () => {
      const restaurantA = await createRestaurant(app);
      const restaurantB = await createRestaurant(app);
      const product = await createProduct(app, restaurantA);
      const order = await createOrder(app, restaurantA.id, [
        { productId: product.id, quantity: 1 },
      ]);

      const response = await app.inject({
        method: "GET",
        headers: restaurantB.headers,
        url: `/restaurants/${restaurantB.id}/orders/${order.id}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
