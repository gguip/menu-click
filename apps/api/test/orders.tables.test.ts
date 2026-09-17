import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import type { TestRestaurant } from "./helpers.ts";
import {
  buildTestApp,
  createOrder,
  createProduct,
  createRestaurant,
  validCustomerBody,
  validDeliveryAddress,
} from "./helpers.ts";

async function criaMesa(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  label: string,
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/tables`,
    headers: restaurant.headers,
    payload: { label },
  });
  return response.json();
}

/**
 * A mesa no pedido: o QR code passando a significar alguma coisa.
 *
 * Até esta feature, `dine_in` não sabia DE ONDE o pedido veio — o pedido
 * chegava com nome e telefone, e o garçom saía procurando pelo salão.
 */
describe("mesa no pedido", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("grava a mesa e devolve o rótulo no pedido", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");

    const pedido = await createOrder(
      app,
      restaurant.id as string,
      [{ productId: produto.id, quantity: 1 }],
      { tableHash: mesa.hash },
    );

    expect(pedido.table).toEqual({ id: mesa.id, label: "Mesa 7" });
  });

  /**
   * 🚨 O teste que mais importa desta feature, e o menos óbvio.
   *
   * Todo QR code já impresso aponta para `/slug` SEM hash nenhum, porque mesa
   * não existia quando ele foi colado. Se `tableHash` virasse obrigatório, no
   * deploy todo adesivo colado pararia de funcionar — o cliente escaneia,
   * monta o carrinho e leva erro no fim. É o mesmo dano que faz o `slug` não
   * ser editável por PATCH.
   *
   * Por isso a mesa é opcional, e é esta a garantia que some primeiro numa
   * refatoração que "limpa" a opcionalidade.
   */
  it("pedido de salão SEM mesa continua sendo aceito", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "dine_in",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "cash",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().table).toBeNull();
  });

  it("400 na mesa de OUTRO restaurante — o hash não etiqueta loja alheia", async () => {
    const dono = await createRestaurant(app);
    const outro = await createRestaurant(app);
    const produto = await createProduct(app, outro);
    const mesa = await criaMesa(app, dono, "Mesa 7");

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${outro.id}/orders`,
      payload: {
        type: "dine_in",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "cash",
        tableHash: mesa.hash,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 no hash inexistente", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "dine_in",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "cash",
        tableHash: "hashquenuncaexistiu12",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 no hash já rotacionado — o adesivo velho não pede mais", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");
    await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/tables/${mesa.id}/rotate-hash`,
      headers: restaurant.headers,
    });

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "dine_in",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "cash",
        tableHash: mesa.hash,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 na mesa em pedido de RETIRADA — mesa é coisa de salão", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "takeaway",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "cash",
        tableHash: mesa.hash,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 na mesa em pedido de ENTREGA", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "delivery",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "cash",
        deliveryAddress: validDeliveryAddress,
        tableHash: mesa.hash,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  /**
   * O rótulo é CÓPIA congelada, como `order_items` copia nome e preço do
   * produto. Sem isso, renomear a mesa reescreveria o histórico.
   */
  it("renomear a mesa NÃO muda o rótulo do pedido antigo", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");
    const pedido = await createOrder(
      app,
      restaurant.id as string,
      [{ productId: produto.id, quantity: 1 }],
      { tableHash: mesa.hash },
    );

    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}/tables/${mesa.id}`,
      headers: restaurant.headers,
      payload: { label: "Mesa 8" },
    });

    const lido = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders/${pedido.id}`,
      headers: restaurant.headers,
    });

    expect(lido.json().table.label).toBe("Mesa 7");
  });

  it("remover a mesa NÃO apaga o rótulo do histórico", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");
    const pedido = await createOrder(
      app,
      restaurant.id as string,
      [{ productId: produto.id, quantity: 1 }],
      { tableHash: mesa.hash },
    );

    await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}/tables/${mesa.id}`,
      headers: restaurant.headers,
    });

    const lido = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders/${pedido.id}`,
      headers: restaurant.headers,
    });

    expect(lido.json().table).toEqual({ id: mesa.id, label: "Mesa 7" });
  });

  it("a listagem do painel filtra por mesa", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant);
    const sete = await criaMesa(app, restaurant, "Mesa 7");
    const oito = await criaMesa(app, restaurant, "Mesa 8");
    await createOrder(
      app,
      restaurant.id as string,
      [{ productId: produto.id, quantity: 1 }],
      { tableHash: sete.hash },
    );
    await createOrder(
      app,
      restaurant.id as string,
      [{ productId: produto.id, quantity: 1 }],
      { tableHash: oito.hash },
    );

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders?tableId=${sete.id}`,
      headers: restaurant.headers,
    });

    expect(response.json().total).toBe(1);
    expect(response.json().data[0].table.label).toBe("Mesa 7");
  });

  /**
   * ⚠️ Rede de baixo, exercitada por SQL direto: o `check` do banco recusa
   * mesa fora de `dine_in` mesmo que o serviço tenha um bug. É o mesmo padrão
   * do `orders_address_check`.
   */
  it("o check do banco recusa mesa em pedido que não é de salão", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");
    const pedido = await createOrder(app, restaurant.id as string, [
      { productId: produto.id, quantity: 1 },
    ]);

    await expect(
      pool.query(
        `update orders set type = 'takeaway', table_id = $1, table_label = 'Mesa 7'
          where id = $2`,
        [mesa.id, pedido.id],
      ),
    ).rejects.toThrow(/orders_table_check/);
  });
});
