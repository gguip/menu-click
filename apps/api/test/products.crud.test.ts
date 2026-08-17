import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createProduct, createRestaurant, validProductBody } from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

describe("CRUD /restaurants/:restaurantId/products", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /restaurants/:restaurantId/products", () => {
    it("201 ao criar produto", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/products`,
        payload: validProductBody,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        restaurantId: restaurant.id,
        name: validProductBody.name,
        category: validProductBody.category,
        priceInCents: validProductBody.priceInCents,
      });
    });

    it("404 com restaurantId inexistente", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${NONEXISTENT_ID}/products`,
        payload: validProductBody,
      });

      expect(response.statusCode).toBe(404);
    });

    it("400 com priceInCents float", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/products`,
        payload: { ...validProductBody, priceInCents: 48.9 },
      });

      expect(response.statusCode).toBe(400);
    });

    it("400 com priceInCents string", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/products`,
        payload: { ...validProductBody, priceInCents: "4890" },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /restaurants/:restaurantId/products", () => {
    it("lista só os produtos daquele restaurante", async () => {
      const restaurantA = await createRestaurant(app, {
        name: "Tokyo Ramen House",
      });
      const restaurantB = await createRestaurant(app, {
        name: "Cantina da Nona",
      });

      await createProduct(app, restaurantA.id, { name: "Ramen Shoyu" });
      await createProduct(app, restaurantA.id, { name: "Guioza" });
      await createProduct(app, restaurantB.id, { name: "Tiramisù" });

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurantA.id}/products`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Array<{ restaurantId: string }>;
      expect(body).toHaveLength(2);
      expect(body.every((product) => product.restaurantId === restaurantA.id)).toBe(
        true,
      );
    });
  });
});
