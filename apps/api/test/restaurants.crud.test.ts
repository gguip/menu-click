import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createRestaurant } from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

describe("CRUD /restaurants", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /restaurants", () => {
    it("200 com array com os restaurantes criados", async () => {
      await createRestaurant(app, { name: "Tokyo Ramen House" });
      await createRestaurant(app, { name: "Cantina da Nona" });

      const response = await app.inject({ method: "GET", url: "/restaurants" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(2);
    });
  });

  describe("GET /restaurants/:id", () => {
    it("200 com o restaurante", async () => {
      const created = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: created.id,
        name: created.name,
      });
    });

    it("404 para id inexistente", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${NONEXISTENT_ID}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("PATCH /restaurants/:id", () => {
    it("200, updatedAt muda e createdAt não", async () => {
      const created = await createRestaurant(app);

      // Garante que o `now()` do PATCH caia num instante estritamente
      // depois do `now()` do INSERT (evita empate no timestamp).
      await new Promise((resolve) => setTimeout(resolve, 10));

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${created.id}`,
        payload: { name: "Novo Nome" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe("Novo Nome");
      expect(body.createdAt).toBe(created.createdAt);
      expect(body.updatedAt).not.toBe(created.updatedAt);
      expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
    });

    it("400 com tipo errado", async () => {
      const created = await createRestaurant(app);

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${created.id}`,
        payload: { isDelivery: "yes" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("404 para id inexistente", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${NONEXISTENT_ID}`,
        payload: { name: "Novo Nome" },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE /restaurants/:id", () => {
    it("204 e depois GET dá 404", async () => {
      const created = await createRestaurant(app);

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/restaurants/${created.id}`,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const getResponse = await app.inject({
        method: "GET",
        url: `/restaurants/${created.id}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });
  });
});
