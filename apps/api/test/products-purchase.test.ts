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

  /** Estoque real da linha, lido fora da API. */
  async function stockOf(productId: string): Promise<number> {
    const { rows } = await pool.query<{ stock: number }>(
      "select stock from products where id = $1",
      [productId],
    );
    return rows[0].stock;
  }

  it("stock = 1: primeira compra 200, segunda 409", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant.id, { stock: 1 });

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

  /**
   * O teste que dá sentido ao `select ... for update` do repositório.
   *
   * Sem o lock, duas transações concorrentes leem o MESMO `stock`, as duas
   * passam pela checagem `stock <= 0` e as duas gravam o mesmo valor absoluto
   * — vendendo a mais e deixando o estoque inconsistente. Com o lock, a
   * segunda transação fica bloqueada na própria leitura até a primeira
   * commitar, então as compras se serializam.
   *
   * Verificado: comentando o `for update` em `selectStockForUpdate`, este
   * teste falha (mais de 5 respostas 200 para 5 unidades em estoque).
   */
  it("10 compras concorrentes com stock 5: exatamente 5 vendem, estoque nunca fica negativo", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant.id, { stock: 5 });

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: "POST",
          url: `/products/${product.id}/purchase`,
        }),
      ),
    );

    const sold = responses.filter((r) => r.statusCode === 200);
    const rejected = responses.filter((r) => r.statusCode === 409);

    expect(sold).toHaveLength(5);
    expect(rejected).toHaveLength(10 - 5);
    expect(await stockOf(product.id)).toBe(0);

    // Cada venda devolve um `stockRemaining` distinto (4, 3, 2, 1, 0): duas
    // compras que enxergassem o mesmo estoque repetiriam o número.
    const remaining = sold.map((r) => r.json().stockRemaining).sort();
    expect(remaining).toEqual([0, 1, 2, 3, 4]);
  });
});
