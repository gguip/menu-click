import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createProduct, createRestaurant } from "./helpers.ts";

/**
 * Cardápio público — o que o QR code aponta, sem login.
 *
 * O ponto destes testes não é o caminho feliz (que é trivial), e sim o que a
 * resposta **não** traz: `stock` não sai daqui. Quantas unidades o restaurante
 * tem é informação dele; o cliente só precisa do `available`.
 */
describe("cardápio público", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /menu/:slug", () => {
    it("devolve o restaurante pelo slug, sem os timestamps de gestão", async () => {
      await createRestaurant(app, {
        name: "Tokyo Ramen House",
        slug: "tokyo-ramen-house",
      });

      const response = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen-house",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        slug: "tokyo-ramen-house",
        name: "Tokyo Ramen House",
      });
      expect(body.address.city).toBe("São Paulo");
      expect(body.createdAt).toBeUndefined();
      expect(body.updatedAt).toBeUndefined();
    });

    it("404 com slug inexistente", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/menu/nao-existe",
      });

      expect(response.statusCode).toBe(404);
    });

    it("404 quando o restaurante foi removido", async () => {
      const restaurant = await createRestaurant(app, { slug: "vai-fechar" });
      await app.inject({
        method: "DELETE",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}`,
      });

      const response = await app.inject({
        method: "GET",
        url: "/menu/vai-fechar",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /menu/:slug/products", () => {
    it("não expõe o estoque, só se dá para pedir", async () => {
      const restaurant = await createRestaurant(app, { slug: "tokyo-ramen" });
      await createProduct(app, restaurant, {
        name: "Ramen Shoyu",
        stock: 30,
      });
      await createProduct(app, restaurant, { name: "Guioza", stock: 0 });

      const response = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products",
      });

      expect(response.statusCode).toBe(200);
      const produtos = response.json().data;
      expect(produtos).toHaveLength(2);

      for (const produto of produtos) {
        expect(produto.stock).toBeUndefined();
        expect(produto.restaurantId).toBeUndefined();
      }
      expect(produtos[0]).toMatchObject({ name: "Ramen Shoyu", available: true });
      expect(produtos[1]).toMatchObject({ name: "Guioza", available: false });
    });

    it("responde o mesmo envelope paginado das outras listagens", async () => {
      const restaurant = await createRestaurant(app, { slug: "tokyo-ramen" });
      for (let i = 0; i < 3; i++) {
        await createProduct(app, restaurant, { name: `Prato ${i}` });
      }

      const response = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products?limit=2",
      });

      expect(response.json()).toMatchObject({ limit: 2, offset: 0, total: 3 });
      expect(response.json().data).toHaveLength(2);
    });

    it("produto removido não aparece no cardápio", async () => {
      const restaurant = await createRestaurant(app, { slug: "tokyo-ramen" });
      const product = await createProduct(app, restaurant);
      await app.inject({
        method: "DELETE",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/products/${product.id}`,
      });

      const response = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products",
      });

      expect(response.json().total).toBe(0);
    });

    it("404 com slug inexistente", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/menu/nao-existe/products",
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
