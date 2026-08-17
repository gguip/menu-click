import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { pool } from "../src/db/pool.ts";
import { createProduct, createRestaurant } from "./helpers.ts";

describe("POST /products/:id/purchase", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("stock = 1: primeira compra 200, segunda 409", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant.id);

    // `stock` não é PATCHável pela API (de propósito — só a rota de compra
    // mexe nele), então o setup do teste escreve direto no banco.
    await pool.query("update products set stock = 1 where id = $1", [
      product.id,
    ]);

    const first = await app.inject({
      method: "POST",
      url: `/products/${product.id}/purchase`,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      productId: product.id,
      stockRemaining: 0,
    });

    const second = await app.inject({
      method: "POST",
      url: `/products/${product.id}/purchase`,
    });
    expect(second.statusCode).toBe(409);
  });
});
