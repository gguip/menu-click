import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createProduct, createRestaurant } from "./helpers.ts";

/**
 * Paginação das listagens (`limit`/`offset` com envelope).
 *
 * As duas listagens da API respondem `{ data, limit, offset, total }` — nunca
 * mais um array cru. `total` é o total de registros **vivos** (soft delete não
 * conta), não o tamanho da página.
 */
describe("paginação das listagens", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * `GET /restaurants` devolve só o restaurante da sessão, então não dá para
   * exercitar várias páginas por ali. Os casos de recorte e de borda mudaram de
   * casa para a listagem de produtos, logo abaixo; o que fica aqui é o que
   * continua sendo específico da rota: o envelope e a rejeição de faixa.
   */
  describe("GET /restaurants", () => {
    it("envelope com os defaults (limit 20, offset 0)", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: "/restaurants",
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ limit: 20, offset: 0, total: 1 });
      expect(response.json().data).toHaveLength(1);
    });

    it("restaurante removido some da própria listagem", async () => {
      const restaurant = await createRestaurant(app);
      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
      });

      const response = await app.inject({
        method: "GET",
        url: "/restaurants",
        headers: restaurant.headers,
      });

      expect(response.json().total).toBe(0);
      expect(response.json().data).toEqual([]);
    });

    it.each([
      ["limit acima do máximo", "?limit=500"],
      ["limit zero", "?limit=0"],
      ["offset negativo", "?offset=-1"],
      ["limit fracionado", "?limit=2.5"],
    ])("400 com %s", async (_caso, query) => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants${query}`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /restaurants/:restaurantId/products", () => {
    it("envelope com total do restaurante, não da tabela toda", async () => {
      const restaurantA = await createRestaurant(app, { name: "Tokyo Ramen" });
      const restaurantB = await createRestaurant(app, { name: "Cantina" });

      await createProduct(app, restaurantA, { name: "Ramen Shoyu" });
      await createProduct(app, restaurantA, { name: "Guioza" });
      await createProduct(app, restaurantA, { name: "Yakimeshi" });
      await createProduct(app, restaurantB, { name: "Tiramisù" });

      const response = await app.inject({
        method: "GET",
        headers: restaurantA.headers,
        url: `/restaurants/${restaurantA.id}/products?limit=2`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(3);
    });

    it("offset pagina os produtos do restaurante", async () => {
      const restaurant = await createRestaurant(app);
      await createProduct(app, restaurant, { name: "Ramen Shoyu" });
      await createProduct(app, restaurant, { name: "Guioza" });
      await createProduct(app, restaurant, { name: "Yakimeshi" });

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/products?limit=2&offset=2`,
      });

      const body = response.json();
      expect(body.data.map((p: { name: string }) => p.name)).toEqual([
        "Yakimeshi",
      ]);
      expect(body.total).toBe(3);
    });

    it("limit recorta a página mas `total` continua sendo o total vivo", async () => {
      const restaurant = await createRestaurant(app);
      for (let i = 0; i < 5; i++) {
        await createProduct(app, restaurant, { name: `Prato ${i}` });
      }

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/products?limit=2`,
      });

      expect(response.json().data).toHaveLength(2);
      expect(response.json().total).toBe(5);
    });

    it("offset além do fim: data vazia, total preservado", async () => {
      const restaurant = await createRestaurant(app);
      await createProduct(app, restaurant);

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/products?limit=10&offset=50`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
      expect(response.json().total).toBe(1);
    });

    it("produto removido não entra em `total`", async () => {
      const restaurant = await createRestaurant(app);
      const produto = await createProduct(app, restaurant);
      await createProduct(app, restaurant, { name: "Outro" });
      await app.inject({
        method: "DELETE",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/products/${produto.id}`,
      });

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/products`,
      });

      expect(response.json().total).toBe(1);
    });

    it("400 com limit acima do máximo", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/products?limit=500`,
      });

      expect(response.statusCode).toBe(400);
    });

    it("404 quando o restaurante não é o da sessão (a paginação não muda isso)", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: "/restaurants/00000000-0000-0000-0000-000000000000/products?limit=5",
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
