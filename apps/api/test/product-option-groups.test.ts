import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import {
  buildTestApp,
  createOptionGroup,
  createProduct,
  createRestaurant,
  linkOptionGroups,
} from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * O vínculo entre produto e grupo de opções.
 *
 * Uma rota só (`PUT`) define a lista ordenada completa, em vez de três para
 * vincular, desvincular e reordenar: é como uma tela faz — marca as caixas e
 * arrasta a ordem —, e a posição sai do índice do array sem campo extra.
 */
describe("vínculo produto ↔ grupo de opções", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function cenario() {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant, { name: "Pizza" });
    const tamanho = await createOptionGroup(app, restaurant, {
      name: "Tamanho",
    });
    const sabores = await createOptionGroup(app, restaurant, {
      name: "Sabores",
    });
    return { restaurant, produto, tamanho, sabores };
  }

  it("define a lista ordenada, e a ordem é a do array", async () => {
    const { restaurant, produto, tamanho, sabores } = await cenario();

    const response = await linkOptionGroups(app, restaurant, produto.id, [
      sabores.id,
      tamanho.id,
    ]);

    expect(response.statusCode).toBe(200);
    expect(
      response.json().optionGroups.map((g: { name: string }) => g.name),
    ).toEqual(["Sabores", "Tamanho"]);
  });

  it("é idempotente: mandar a mesma lista duas vezes não duplica", async () => {
    const { restaurant, produto, tamanho } = await cenario();

    await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);
    const segunda = await linkOptionGroups(app, restaurant, produto.id, [
      tamanho.id,
    ]);

    expect(segunda.json().optionGroups).toHaveLength(1);
  });

  it("lista vazia desvincula tudo", async () => {
    const { restaurant, produto, tamanho } = await cenario();
    await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);

    const response = await linkOptionGroups(app, restaurant, produto.id, []);

    expect(response.json().optionGroups).toEqual([]);
  });

  /** O índice único é parcial, então revincular insere linha nova. */
  it("dá para revincular um grupo que tinha sido tirado", async () => {
    const { restaurant, produto, tamanho } = await cenario();
    await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);
    await linkOptionGroups(app, restaurant, produto.id, []);

    const response = await linkOptionGroups(app, restaurant, produto.id, [
      tamanho.id,
    ]);

    expect(response.json().optionGroups).toHaveLength(1);
  });

  it("400 com id repetido na lista", async () => {
    const { restaurant, produto, tamanho } = await cenario();

    const response = await linkOptionGroups(app, restaurant, produto.id, [
      tamanho.id,
      tamanho.id,
    ]);

    expect(response.statusCode).toBe(400);
  });

  it("404 com grupo de outro restaurante na lista", async () => {
    const { restaurant, produto } = await cenario();
    const outro = await createRestaurant(app);
    const grupoAlheio = await createOptionGroup(app, outro, { name: "Extras" });

    const response = await linkOptionGroups(app, restaurant, produto.id, [
      grupoAlheio.id,
    ]);

    expect(response.statusCode).toBe(404);
  });

  it("404 com grupo inexistente na lista", async () => {
    const { restaurant, produto } = await cenario();

    const response = await linkOptionGroups(app, restaurant, produto.id, [
      NONEXISTENT_ID,
    ]);

    expect(response.statusCode).toBe(404);
  });

  it("404 com produto de outro restaurante", async () => {
    const { restaurant, tamanho } = await cenario();
    const outro = await createRestaurant(app);
    const produtoAlheio = await createProduct(app, outro);

    const response = await app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/products/${produtoAlheio.id}/option-groups`,
      headers: restaurant.headers,
      payload: { optionGroupIds: [tamanho.id] },
    });

    expect(response.statusCode).toBe(404);
  });

  describe("cascatas", () => {
    /** Marca `deleted_at` nos vínculos vivos daquele produto. */
    async function vinculosVivos(productId: string) {
      const { rows } = await pool.query<{ n: string }>(
        `select count(*) as n from product_option_groups
          where product_id = $1 and deleted_at is null`,
        [productId],
      );
      return Number(rows[0].n);
    }

    it("remover o grupo desfaz os vínculos dele", async () => {
      const { restaurant, produto, tamanho } = await cenario();
      await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/option-groups/${tamanho.id}`,
        headers: restaurant.headers,
      });

      expect(await vinculosVivos(produto.id)).toBe(0);
    });

    it("remover o produto desfaz os vínculos dele", async () => {
      const { restaurant, produto, tamanho } = await cenario();
      await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/products/${produto.id}`,
        headers: restaurant.headers,
      });

      expect(await vinculosVivos(produto.id)).toBe(0);
    });

    it("remover o restaurante alcança grupos, opções e vínculos", async () => {
      const { restaurant, produto, tamanho } = await cenario();
      await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
      });

      const { rows } = await pool.query<{ deleted_at: Date | null }>(
        "select deleted_at from option_groups where id = $1",
        [tamanho.id],
      );
      expect(rows[0].deleted_at).not.toBeNull();
      expect(await vinculosVivos(produto.id)).toBe(0);
    });
  });
});
