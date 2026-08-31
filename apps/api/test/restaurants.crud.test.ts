import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createRestaurant,
} from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

describe("CRUD /restaurants", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /restaurants", () => {
    it("devolve o restaurante da sessão, não os dos outros", async () => {
      const meu = await createRestaurant(app, { name: "Tokyo Ramen House" });
      await createRestaurant(app, { name: "Cantina da Nona" });

      const response = await app.inject({
        method: "GET",
        url: "/restaurants",
        headers: meu.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(1);
      expect(response.json().data[0].id).toBe(meu.id);
      expect(response.json().total).toBe(1);
    });

    it("401 sem sessão", async () => {
      const response = await app.inject({ method: "GET", url: "/restaurants" });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /restaurants/:id", () => {
    it("200 com o restaurante", async () => {
      const created = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        headers: created.headers,
        url: `/restaurants/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: created.id,
        name: created.name,
      });
    });

    it("404 para id que não é o da sessão", async () => {
      const created = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${NONEXISTENT_ID}`,
        headers: created.headers,
      });

      expect(response.statusCode).toBe(404);
    });

    it("404 ao ler o restaurante de outra sessão (não 403)", async () => {
      const meu = await createRestaurant(app);
      const alheio = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${alheio.id}`,
        headers: meu.headers,
      });

      // 403 confirmaria que esse restaurante existe
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
        headers: created.headers,
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
        headers: created.headers,
        url: `/restaurants/${created.id}`,
        payload: { isDelivery: "yes" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("404 para id que não é o da sessão", async () => {
      const created = await createRestaurant(app);

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${NONEXISTENT_ID}`,
        headers: created.headers,
        payload: { name: "Novo Nome" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("404 ao editar o restaurante de outra sessão", async () => {
      const meu = await createRestaurant(app);
      const alheio = await createRestaurant(app, { name: "Cantina da Nona" });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${alheio.id}`,
        headers: meu.headers,
        payload: { name: "Sequestrado" },
      });

      expect(response.statusCode).toBe(404);

      // e o nome do outro continua intacto
      const conferindo = await app.inject({
        method: "GET",
        url: `/restaurants/${alheio.id}`,
        headers: alheio.headers,
      });
      expect(conferindo.json().name).toBe("Cantina da Nona");
    });
  });

  describe("DELETE /restaurants/:id", () => {
    it("204 e depois GET dá 404", async () => {
      const created = await createRestaurant(app);

      const deleteResponse = await app.inject({
        method: "DELETE",
        headers: created.headers,
        url: `/restaurants/${created.id}`,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const getResponse = await app.inject({
        method: "GET",
        headers: created.headers,
        url: `/restaurants/${created.id}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });
  });
});
