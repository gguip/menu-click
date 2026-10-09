import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createProduct, createRestaurant, validProductBody } from "./helpers.ts";

/**
 * `isSuggested`: a marca de "sugerir no carrinho". Na gestão o campo é
 * `isSuggested`; no cardápio público sai como `suggested`, ao lado de
 * `available`.
 */
describe("produto sugerido no carrinho", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const menuProducts = async (slug: string) => {
    const response = await app.inject({ method: "GET", url: `/menu/${slug}/products` });
    return response.json().data.flatMap((section: { products: unknown[] }) => section.products) as Record<
      string,
      unknown
    >[];
  };

  it("produto criado sem a marca nasce não sugerido", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant);
    expect(product.isSuggested).toBe(false);
  });

  it("a criação aceita a marca", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant, { isSuggested: true });
    expect(product.isSuggested).toBe(true);
  });

  it("o PATCH liga e desliga, e a leitura devolve o que ficou", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant);
    const url = `/restaurants/${restaurant.id}/products/${product.id}`;

    const on = await app.inject({ method: "PATCH", url, headers: restaurant.headers, payload: { isSuggested: true } });
    expect(on.statusCode).toBe(200);
    expect(on.json().isSuggested).toBe(true);
    expect((await app.inject({ method: "GET", url, headers: restaurant.headers })).json().isSuggested).toBe(true);

    const off = await app.inject({ method: "PATCH", url, headers: restaurant.headers, payload: { isSuggested: false } });
    expect(off.json().isSuggested).toBe(false);
  });

  it("PATCH de outro campo não desliga a marca", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant, { isSuggested: true });
    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}/products/${product.id}`,
      headers: restaurant.headers,
      payload: { name: "Outro nome" },
    });
    expect(response.json().isSuggested).toBe(true);
  });

  it("valor que não é booleano é 400", async () => {
    const restaurant = await createRestaurant(app);
    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/products`,
      headers: restaurant.headers,
      payload: { ...validProductBody, isSuggested: "sim" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("o cardápio público diz `suggested`, e não vaza `isSuggested`", async () => {
    const restaurant = await createRestaurant(app);
    await createProduct(app, restaurant, { name: "Água", stock: 5, isSuggested: true });
    await createProduct(app, restaurant, { name: "Ramen", stock: 5 });

    const products = await menuProducts(restaurant.slug);
    const byName = Object.fromEntries(products.map((product) => [product.name, product]));
    expect(byName["Água"].suggested).toBe(true);
    expect(byName["Ramen"].suggested).toBe(false);
    expect(products.every((product) => !("isSuggested" in product))).toBe(true);
  });
});
