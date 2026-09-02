import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOptionGroup, createRestaurant } from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

describe("CRUD /restaurants/:restaurantId/option-groups", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("201 com os limites e a regra de preço", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
      payload: {
        name: "Sabores",
        minOptions: 1,
        maxOptions: 2,
        priceRule: "highest",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: "Sabores",
      minOptions: 1,
      maxOptions: 2,
      priceRule: "highest",
      restaurantId: restaurant.id,
    });
    expect(response.json().options).toEqual([]);
  });

  it("minOptions ausente vira 0 — grupo opcional", async () => {
    const restaurant = await createRestaurant(app);

    const grupo = await createOptionGroup(app, restaurant, {
      name: "Adicionais",
      maxOptions: 5,
      priceRule: "sum",
    });

    expect(grupo.minOptions).toBe(0);
  });

  /** Um grupo que exige mais do que aceita nunca poderia ser satisfeito. */
  it("400 quando minOptions é maior que maxOptions", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
      payload: {
        name: "Impossível",
        minOptions: 3,
        maxOptions: 2,
        priceRule: "sum",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com maxOptions zero", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
      payload: { name: "Vazio", maxOptions: 0, priceRule: "sum" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com regra de preço fora da lista", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
      payload: { name: "X", maxOptions: 2, priceRule: "lowest" },
    });

    expect(response.statusCode).toBe(400);
  });

  /** Mesma política de categoria, e pelo mesmo motivo. */
  it("409 com nome repetido, sem diferenciar maiúscula", async () => {
    const restaurant = await createRestaurant(app);
    await createOptionGroup(app, restaurant, { name: "Adicionais" });

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
      payload: { name: "adicionais", maxOptions: 3, priceRule: "sum" },
    });

    expect(response.statusCode).toBe(409);
  });

  it("o mesmo nome em outro restaurante é permitido", async () => {
    const primeiro = await createRestaurant(app);
    const segundo = await createRestaurant(app);
    await createOptionGroup(app, primeiro, { name: "Adicionais" });

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${segundo.id}/option-groups`,
      headers: segundo.headers,
      payload: { name: "Adicionais", maxOptions: 3, priceRule: "sum" },
    });

    expect(response.statusCode).toBe(201);
  });

  it("lista em envelope paginado, ordenada por nome", async () => {
    const restaurant = await createRestaurant(app);
    await createOptionGroup(app, restaurant, { name: "Sabores" });
    await createOptionGroup(app, restaurant, { name: "Adicionais" });

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(2);
    expect(response.json().data.map((g: { name: string }) => g.name)).toEqual([
      "Adicionais",
      "Sabores",
    ]);
  });

  it("PATCH renomeia e muda os limites", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });

    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
      payload: { name: "Sabores da casa", maxOptions: 4 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Sabores da casa",
      maxOptions: 4,
    });
  });

  /**
   * A checagem precisa considerar o valor RESULTANTE, não só o enviado: baixar
   * só o `maxOptions` pode deixá-lo abaixo do `minOptions` que já estava lá.
   */
  it("400 ao editar deixando minOptions acima de maxOptions", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, {
      name: "Sabores",
      minOptions: 2,
      maxOptions: 3,
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
      payload: { maxOptions: 1 },
    });

    expect(response.statusCode).toBe(400);
  });

  it("DELETE 204, e depois o GET dá 404", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });

    const remocao = await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
    });
    const leitura = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
    });

    expect(remocao.statusCode).toBe(204);
    expect(leitura.statusCode).toBe(404);
  });

  it("grupo de outro restaurante é 404 (S19)", async () => {
    const dono = await createRestaurant(app);
    const intruso = await createRestaurant(app);
    const grupo = await createOptionGroup(app, dono, { name: "Sabores" });

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${intruso.id}/option-groups/${grupo.id}`,
      headers: intruso.headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("404 com id que não é uuid", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/option-groups/nao-e-uuid`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("404 com grupo inexistente", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}/option-groups/${NONEXISTENT_ID}`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(404);
  });
});
