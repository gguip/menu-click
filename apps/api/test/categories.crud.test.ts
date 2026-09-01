import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp, createCategory, createRestaurant } from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

describe("CRUD /restaurants/:restaurantId/categories", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST", () => {
    it("201 e a primeira categoria nasce na posição 0", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/categories`,
        headers: restaurant.headers,
        payload: { name: "Entradas" },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        name: "Entradas",
        position: 0,
        restaurantId: restaurant.id,
      });
      expect(response.json().id).toBeTruthy();
    });

    it("sem position, a categoria nova vai para o FIM", async () => {
      const restaurant = await createRestaurant(app);
      await createCategory(app, restaurant, { name: "Entradas" });
      await createCategory(app, restaurant, { name: "Pratos" });

      const terceira = await createCategory(app, restaurant, {
        name: "Sobremesas",
      });

      expect(terceira.position).toBe(2);
    });

    it("aceita position explícita", async () => {
      const restaurant = await createRestaurant(app);

      const categoria = await createCategory(app, restaurant, {
        name: "Bebidas",
        position: 10,
      });

      expect(categoria.position).toBe(10);
    });

    it("409 no nome repetido", async () => {
      const restaurant = await createRestaurant(app);
      await createCategory(app, restaurant, { name: "Bebidas" });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/categories`,
        headers: restaurant.headers,
        payload: { name: "Bebidas" },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain("Bebidas");
    });

    /**
     * A razão de a categoria ser entidade: com texto livre, "Bebidas" e
     * "bebidas" eram duas seções no mesmo cardápio. O índice único é sobre
     * `lower(name)` justamente para isso.
     */
    it("409 no nome repetido com outra caixa", async () => {
      const restaurant = await createRestaurant(app);
      await createCategory(app, restaurant, { name: "Bebidas" });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/categories`,
        headers: restaurant.headers,
        payload: { name: "bebidas" },
      });

      expect(response.statusCode).toBe(409);
    });

    it("o mesmo nome em OUTRO restaurante é permitido", async () => {
      const primeiro = await createRestaurant(app);
      const segundo = await createRestaurant(app);
      await createCategory(app, primeiro, { name: "Bebidas" });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${segundo.id}/categories`,
        headers: segundo.headers,
        payload: { name: "Bebidas" },
      });

      expect(response.statusCode).toBe(201);
    });

    it("400 com position como string — o validador não coage", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/categories`,
        headers: restaurant.headers,
        payload: { name: "Entradas", position: "3" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("400 com campo desconhecido no corpo", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/categories`,
        headers: restaurant.headers,
        payload: { name: "Entradas", restaurantId: NONEXISTENT_ID },
      });

      // `removeAdditional` tira o campo; o que importa é que ele não vira dado
      expect(response.json().restaurantId).toBe(restaurant.id);
    });
  });

  describe("GET (listagem)", () => {
    it("ordena por position, não por nome", async () => {
      const restaurant = await createRestaurant(app);
      // criadas fora de ordem e com nomes que, alfabeticamente, sairiam ao
      // contrário do que o cardápio quer
      await createCategory(app, restaurant, { name: "Sobremesas", position: 2 });
      await createCategory(app, restaurant, { name: "Bebidas", position: 3 });
      await createCategory(app, restaurant, { name: "Entradas", position: 0 });
      await createCategory(app, restaurant, { name: "Pratos", position: 1 });

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/categories`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.map((c: { name: string }) => c.name)).toEqual([
        "Entradas",
        "Pratos",
        "Sobremesas",
        "Bebidas",
      ]);
      expect(response.json().total).toBe(4);
    });

    it("empate de position é desfeito pelo nome", async () => {
      const restaurant = await createRestaurant(app);
      await createCategory(app, restaurant, { name: "Zakuska", position: 0 });
      await createCategory(app, restaurant, { name: "Antipasto", position: 0 });

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/categories`,
        headers: restaurant.headers,
      });

      expect(response.json().data.map((c: { name: string }) => c.name)).toEqual([
        "Antipasto",
        "Zakuska",
      ]);
    });

    it("restaurante sem categorias devolve página vazia", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/categories`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ data: [], total: 0 });
    });
  });

  describe("GET (detalhe)", () => {
    it("200 com a categoria", async () => {
      const restaurant = await createRestaurant(app);
      const criada = await createCategory(app, restaurant, { name: "Entradas" });

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/categories/${criada.id}`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe("Entradas");
    });

    it("404 para id que não é uuid", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/categories/nao-e-uuid`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("PATCH", () => {
    it("renomeia", async () => {
      const restaurant = await createRestaurant(app);
      const criada = await createCategory(app, restaurant, { name: "Entradas" });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/categories/${criada.id}`,
        headers: restaurant.headers,
        payload: { name: "Para começar" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe("Para começar");
      expect(response.json().position).toBe(criada.position);
    });

    it("reordena mandando só a position", async () => {
      const restaurant = await createRestaurant(app);
      const entradas = await createCategory(app, restaurant, {
        name: "Entradas",
      });
      await createCategory(app, restaurant, { name: "Bebidas" });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/categories/${entradas.id}`,
        headers: restaurant.headers,
        payload: { position: 9 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().position).toBe(9);
      expect(response.json().name).toBe("Entradas");

      const lista = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/categories`,
        headers: restaurant.headers,
      });
      expect(lista.json().data.map((c: { name: string }) => c.name)).toEqual([
        "Bebidas",
        "Entradas",
      ]);
    });

    it("409 ao renomear para um nome que já existe", async () => {
      const restaurant = await createRestaurant(app);
      await createCategory(app, restaurant, { name: "Bebidas" });
      const entradas = await createCategory(app, restaurant, {
        name: "Entradas",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/categories/${entradas.id}`,
        headers: restaurant.headers,
        payload: { name: "Bebidas" },
      });

      expect(response.statusCode).toBe(409);
    });

    it("404 em categoria inexistente", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/categories/${NONEXISTENT_ID}`,
        headers: restaurant.headers,
        payload: { name: "Entradas" },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE", () => {
    it("204, e depois o GET dá 404", async () => {
      const restaurant = await createRestaurant(app);
      const criada = await createCategory(app, restaurant, { name: "Entradas" });

      const remocao = await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/categories/${criada.id}`,
        headers: restaurant.headers,
      });
      expect(remocao.statusCode).toBe(204);

      const leitura = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/categories/${criada.id}`,
        headers: restaurant.headers,
      });
      expect(leitura.statusCode).toBe(404);
    });

    it("remover duas vezes é 404 na segunda", async () => {
      const restaurant = await createRestaurant(app);
      const criada = await createCategory(app, restaurant, { name: "Entradas" });
      const url = `/restaurants/${restaurant.id}/categories/${criada.id}`;

      await app.inject({ method: "DELETE", url, headers: restaurant.headers });
      const segunda = await app.inject({
        method: "DELETE",
        url,
        headers: restaurant.headers,
      });

      expect(segunda.statusCode).toBe(404);
    });

    /** O índice único é parcial: nome removido não bloqueia a recriação (D6). */
    it("o nome de uma categoria removida pode ser reusado", async () => {
      const restaurant = await createRestaurant(app);
      const criada = await createCategory(app, restaurant, { name: "Bebidas" });
      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/categories/${criada.id}`,
        headers: restaurant.headers,
      });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/categories`,
        headers: restaurant.headers,
        payload: { name: "Bebidas" },
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe("escopo do restaurante", () => {
    it("categoria de outro restaurante é 404, não 403 (S19)", async () => {
      const dono = await createRestaurant(app);
      const intruso = await createRestaurant(app);
      const categoria = await createCategory(app, dono, { name: "Entradas" });

      // a sessão do intruso, apontando para o restaurante DELE, com o id da
      // categoria alheia: o hook não barra, e quem tem que barrar é a query
      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${intruso.id}/categories/${categoria.id}`,
        headers: intruso.headers,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("cascata do restaurante", () => {
    it("remover o restaurante remove as categorias dele (D3)", async () => {
      const restaurant = await createRestaurant(app);
      const categoria = await createCategory(app, restaurant, {
        name: "Entradas",
      });

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
      });

      // a API não tem mais como responder por esse restaurante, então a
      // verificação é no banco: a linha continua lá, marcada
      const { rows } = await pool.query<{ deleted_at: Date | null }>(
        "select deleted_at from categories where id = $1",
        [categoria.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].deleted_at).not.toBeNull();
    });
  });
});
