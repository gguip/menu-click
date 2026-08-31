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

  describe("GET /restaurants", () => {
    it("sem query: envelope com os defaults (limit 20, offset 0)", async () => {
      await createRestaurant(app, { name: "Tokyo Ramen House" });
      await createRestaurant(app, { name: "Cantina da Nona" });

      const response = await app.inject({ method: "GET", url: "/restaurants" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        limit: 20,
        offset: 0,
        total: 2,
      });
      expect(response.json().data).toHaveLength(2);
    });

    it("limit recorta a página mas `total` continua sendo o total vivo", async () => {
      for (let i = 0; i < 5; i++) {
        await createRestaurant(app, { name: `Restaurante ${i}` });
      }

      const response = await app.inject({
        method: "GET",
        url: "/restaurants?limit=2",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(5);
      expect(body.limit).toBe(2);
    });

    it("offset pula os primeiros, mantendo a ordem de criação", async () => {
      for (let i = 0; i < 5; i++) {
        await createRestaurant(app, { name: `Restaurante ${i}` });
      }

      const primeira = await app.inject({
        method: "GET",
        url: "/restaurants?limit=2&offset=0",
      });
      const segunda = await app.inject({
        method: "GET",
        url: "/restaurants?limit=2&offset=2",
      });

      const nomesPrimeira = primeira.json().data.map((r: { name: string }) => r.name);
      const nomesSegunda = segunda.json().data.map((r: { name: string }) => r.name);

      expect(nomesPrimeira).toEqual(["Restaurante 0", "Restaurante 1"]);
      expect(nomesSegunda).toEqual(["Restaurante 2", "Restaurante 3"]);
      expect(segunda.json().offset).toBe(2);
    });

    it("offset além do fim: data vazia, total preservado", async () => {
      await createRestaurant(app, { name: "Tokyo Ramen House" });

      const response = await app.inject({
        method: "GET",
        url: "/restaurants?limit=10&offset=50",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
      expect(response.json().total).toBe(1);
    });

    it("restaurante removido não entra em `total`", async () => {
      const a = await createRestaurant(app, { name: "Tokyo Ramen House" });
      await createRestaurant(app, { name: "Cantina da Nona" });

      await app.inject({ method: "DELETE", url: `/restaurants/${a.id}` });

      const response = await app.inject({ method: "GET", url: "/restaurants" });

      expect(response.json().total).toBe(1);
      expect(response.json().data).toHaveLength(1);
    });

    it("400 com limit acima do máximo", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/restaurants?limit=500",
      });

      expect(response.statusCode).toBe(400);
    });

    it("400 com limit zero", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/restaurants?limit=0",
      });

      expect(response.statusCode).toBe(400);
    });

    it("400 com offset negativo", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/restaurants?offset=-1",
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /restaurants/:restaurantId/products", () => {
    it("envelope com total do restaurante, não da tabela toda", async () => {
      const restaurantA = await createRestaurant(app, { name: "Tokyo Ramen" });
      const restaurantB = await createRestaurant(app, { name: "Cantina" });

      await createProduct(app, restaurantA.id, { name: "Ramen Shoyu" });
      await createProduct(app, restaurantA.id, { name: "Guioza" });
      await createProduct(app, restaurantA.id, { name: "Yakimeshi" });
      await createProduct(app, restaurantB.id, { name: "Tiramisù" });

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurantA.id}/products?limit=2`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(3);
    });

    it("offset pagina os produtos do restaurante", async () => {
      const restaurant = await createRestaurant(app);
      await createProduct(app, restaurant.id, { name: "Ramen Shoyu" });
      await createProduct(app, restaurant.id, { name: "Guioza" });
      await createProduct(app, restaurant.id, { name: "Yakimeshi" });

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/products?limit=2&offset=2`,
      });

      const body = response.json();
      expect(body.data.map((p: { name: string }) => p.name)).toEqual([
        "Yakimeshi",
      ]);
      expect(body.total).toBe(3);
    });

    it("400 com limit acima do máximo", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/products?limit=500`,
      });

      expect(response.statusCode).toBe(400);
    });

    it("404 quando o restaurante não existe (a paginação não muda isso)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/restaurants/00000000-0000-0000-0000-000000000000/products?limit=5",
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
