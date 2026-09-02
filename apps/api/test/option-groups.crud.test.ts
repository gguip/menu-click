import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import {
  buildTestApp,
  createOption,
  createOptionGroup,
  createRestaurant,
} from "./helpers.ts";

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

  describe("opções dentro do grupo", () => {
    it("201, e a opção aparece aninhada no grupo", async () => {
      const restaurant = await createRestaurant(app);
      const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });

      const criada = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options`,
        headers: restaurant.headers,
        payload: { name: "Calabresa", priceInCents: 4505 },
      });
      const lido = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
        headers: restaurant.headers,
      });

      expect(criada.statusCode).toBe(201);
      expect(criada.json()).toMatchObject({
        name: "Calabresa",
        priceInCents: 4505,
        maxQuantity: 1,
        available: true,
      });
      expect(lido.json().options).toHaveLength(1);
    });

    /** "Ponto da carne" é escolha obrigatória sem custo. */
    it("preço ausente é zero", async () => {
      const restaurant = await createRestaurant(app);
      const grupo = await createOptionGroup(app, restaurant, { name: "Ponto" });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options`,
        headers: restaurant.headers,
        payload: { name: "Ao ponto" },
      });

      expect(response.json().priceInCents).toBe(0);
    });

    /**
     * O `check` do banco é a rede; a recusa útil é aqui. Preço negativo fecharia
     * a porta da assimetria do arredondamento — ver a spec.
     */
    it("400 com preço negativo", async () => {
      const restaurant = await createRestaurant(app);
      const grupo = await createOptionGroup(app, restaurant, { name: "Extras" });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options`,
        headers: restaurant.headers,
        payload: { name: "Sem queijo", priceInCents: -200 },
      });

      expect(response.statusCode).toBe(400);
    });

    it("400 com preço em string — o validador não coage", async () => {
      const restaurant = await createRestaurant(app);
      const grupo = await createOptionGroup(app, restaurant, { name: "Extras" });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options`,
        headers: restaurant.headers,
        payload: { name: "Bacon", priceInCents: "500" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("as opções saem ordenadas por position, com o nome desempatando", async () => {
      const restaurant = await createRestaurant(app);
      const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });
      const criar = (name: string, position: number) =>
        app.inject({
          method: "POST",
          url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options`,
          headers: restaurant.headers,
          payload: { name, position },
        });
      await criar("Portuguesa", 1);
      await criar("Calabresa", 0);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
        headers: restaurant.headers,
      });

      expect(response.json().options.map((o: { name: string }) => o.name)).toEqual([
        "Calabresa",
        "Portuguesa",
      ]);
    });

    it("PATCH muda preço, disponibilidade e teto de unidades", async () => {
      const restaurant = await createRestaurant(app);
      const grupo = await createOptionGroup(app, restaurant, { name: "Extras" });
      const opcao = await createOption(app, restaurant, grupo.id, {
        name: "Bacon",
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options/${opcao.id}`,
        headers: restaurant.headers,
        payload: { priceInCents: 700, available: false, maxQuantity: 3 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        priceInCents: 700,
        available: false,
        maxQuantity: 3,
      });
    });

    it("DELETE 204, e a opção some do grupo", async () => {
      const restaurant = await createRestaurant(app);
      const grupo = await createOptionGroup(app, restaurant, { name: "Extras" });
      const opcao = await createOption(app, restaurant, grupo.id, {
        name: "Bacon",
      });

      const remocao = await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options/${opcao.id}`,
        headers: restaurant.headers,
      });
      const lido = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
        headers: restaurant.headers,
      });

      expect(remocao.statusCode).toBe(204);
      expect(lido.json().options).toEqual([]);
    });

    it("404 ao criar opção em grupo de outro restaurante", async () => {
      const dono = await createRestaurant(app);
      const intruso = await createRestaurant(app);
      const grupoAlheio = await createOptionGroup(app, dono, { name: "Sabores" });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${intruso.id}/option-groups/${grupoAlheio.id}/options`,
        headers: intruso.headers,
        payload: { name: "Calabresa" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("remover o grupo remove as opções dele (D3)", async () => {
      const restaurant = await createRestaurant(app);
      const grupo = await createOptionGroup(app, restaurant, { name: "Extras" });
      const opcao = await createOption(app, restaurant, grupo.id, {
        name: "Bacon",
      });

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
        headers: restaurant.headers,
      });

      const { rows } = await pool.query<{ deleted_at: Date | null }>(
        "select deleted_at from options where id = $1",
        [opcao.id],
      );
      expect(rows[0].deleted_at).not.toBeNull();
    });
  });
});
