import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createProduct, createRestaurant, validProductBody } from "./helpers.ts";

/**
 * `stock` no contrato da API.
 *
 * A coluna existe desde a migration `add-stock-to-products`, mas por um tempo
 * ficou invisível: não voltava na resposta e não dava para definir, então todo
 * produto nascia com 0 e `POST /products/:id/purchase` respondia 409 sempre.
 * Estes testes fixam as três pontas: leitura, criação e reposição.
 */
describe("stock do produto", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("produto criado sem stock nasce com stock 0", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/products`,
      payload: validProductBody,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ stock: 0 });
  });

  it("stock enviado no POST é o estoque inicial", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/products`,
      payload: { ...validProductBody, stock: 20 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ stock: 20 });
  });

  it("GET devolve o stock atual", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant.id, { stock: 7 });

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/products/${product.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ stock: 7 });
  });

  it("PATCH stock repõe o estoque", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant.id, { stock: 2 });

    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}/products/${product.id}`,
      payload: { stock: 50 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ stock: 50 });
  });

  it("400 com stock negativo", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/products`,
      payload: { ...validProductBody, stock: -1 },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com stock string (o validador estrito não coage)", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/products`,
      payload: { ...validProductBody, stock: "20" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("a compra reflete o estoque definido na criação", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant.id, { stock: 3 });

    const response = await app.inject({
      method: "POST",
      url: `/products/${product.id}/purchase`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      productId: product.id,
      stockRemaining: 2,
    });
  });
});
