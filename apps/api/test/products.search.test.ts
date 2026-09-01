import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createProduct, createRestaurant } from "./helpers.ts";
import type { TestRestaurant } from "./helpers.ts";

/**
 * A busca por nome na grade de gestão do cardápio (`?search=`).
 *
 * O caminho feliz é trivial. O que estes testes existem para travar é o S5: os
 * curingas do `LIKE` que vêm do cliente são **escapados**. Não é injection (o
 * termo continua indo como parâmetro), mas `%` sem escape casa com o cardápio
 * inteiro, e `_` casa com qualquer caractere — o que a pessoa digitou deixaria
 * de ser o que ela procura.
 */
describe("busca de produtos por nome", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Nomes dos produtos que a busca devolveu, na ordem. */
  async function buscar(restaurant: TestRestaurant, termo: string) {
    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/products?search=${encodeURIComponent(termo)}`,
      headers: restaurant.headers,
    });
    return {
      statusCode: response.statusCode,
      nomes: response.json().data.map((p: { name: string }) => p.name),
      total: response.json().total,
    };
  }

  it("acha por parte do nome, sem diferenciar maiúscula", async () => {
    const restaurant = await createRestaurant(app);
    await createProduct(app, restaurant, { name: "Coca-Cola" });
    await createProduct(app, restaurant, { name: "Suco de Laranja" });

    const { statusCode, nomes, total } = await buscar(restaurant, "coca");

    expect(statusCode).toBe(200);
    expect(nomes).toEqual(["Coca-Cola"]);
    // o total acompanha o filtro: 2 aqui faria a paginação mentir
    expect(total).toBe(1);
  });

  it("termo que não casa devolve página vazia", async () => {
    const restaurant = await createRestaurant(app);
    await createProduct(app, restaurant, { name: "Coca-Cola" });

    const { nomes, total } = await buscar(restaurant, "pizza");

    expect(nomes).toEqual([]);
    expect(total).toBe(0);
  });

  /**
   * Sem o escape, "%" casaria com TODOS os produtos — o oposto de uma busca.
   */
  it("'%' é procurado como texto, não como curinga (S5)", async () => {
    const restaurant = await createRestaurant(app);
    await createProduct(app, restaurant, { name: "Suco 100% Natural" });
    await createProduct(app, restaurant, { name: "Coca-Cola" });
    await createProduct(app, restaurant, { name: "Ramen Shoyu" });

    const { nomes } = await buscar(restaurant, "%");

    expect(nomes).toEqual(["Suco 100% Natural"]);
  });

  /** Sem o escape, "_" casaria com qualquer caractere naquela posição. */
  it("'_' é procurado como texto, não como curinga (S5)", async () => {
    const restaurant = await createRestaurant(app);
    await createProduct(app, restaurant, { name: "Combo_Familia" });
    await createProduct(app, restaurant, { name: "ComboXFamilia" });

    const { nomes } = await buscar(restaurant, "Combo_");

    expect(nomes).toEqual(["Combo_Familia"]);
  });

  /** A barra invertida é o próprio caractere de escape do Postgres. */
  it("a barra invertida também é texto", async () => {
    const restaurant = await createRestaurant(app);
    await createProduct(app, restaurant, { name: "Ramen \\ Especial" });
    await createProduct(app, restaurant, { name: "Coca-Cola" });

    const { nomes } = await buscar(restaurant, "\\");

    expect(nomes).toEqual(["Ramen \\ Especial"]);
  });

  it("aspas simples não quebram a query (S1)", async () => {
    const restaurant = await createRestaurant(app);
    await createProduct(app, restaurant, { name: "Coca-Cola" });

    const { statusCode, nomes } = await buscar(
      restaurant,
      "'; drop table products; --",
    );

    expect(statusCode).toBe(200);
    expect(nomes).toEqual([]);

    // a tabela continua lá
    const lista = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/products`,
      headers: restaurant.headers,
    });
    expect(lista.json().total).toBe(1);
  });

  it("combina com o filtro de categoria", async () => {
    const restaurant = await createRestaurant(app);
    const criarCategoria = async (name: string) => {
      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/categories`,
        headers: restaurant.headers,
        payload: { name },
      });
      return response.json();
    };
    const bebidas = await criarCategoria("Bebidas");
    const pratos = await criarCategoria("Pratos");
    await createProduct(app, restaurant, {
      name: "Suco de Laranja",
      categoryId: bebidas.id,
    });
    await createProduct(app, restaurant, {
      name: "Suco de Uva",
      categoryId: bebidas.id,
    });
    await createProduct(app, restaurant, {
      name: "Suco na sopa",
      categoryId: pratos.id,
    });

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/products?search=suco&categoryId=${bebidas.id}`,
      headers: restaurant.headers,
    });

    expect(response.json().total).toBe(2);
    expect(
      response.json().data.map((p: { name: string }) => p.name),
    ).toEqual(["Suco de Laranja", "Suco de Uva"]);
  });

  it("400 com search vazio", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/products?search=`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(400);
  });
});
