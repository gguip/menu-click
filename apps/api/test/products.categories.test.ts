import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createCategory,
  createProduct,
  createRestaurant,
  validProductBody,
} from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * O vínculo entre produto e categoria.
 *
 * Duas garantias sustentam o desenho todo: a categoria gravada num produto tem
 * que ser **do mesmo restaurante**, e apagar uma seção não pode apagar a comida
 * que estava nela.
 */
describe("produto e categoria", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("gravar o vínculo", () => {
    it("cria o produto dentro da categoria", async () => {
      const restaurant = await createRestaurant(app);
      const categoria = await createCategory(app, restaurant, {
        name: "Entradas",
      });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/products`,
        headers: restaurant.headers,
        payload: { ...validProductBody, categoryId: categoria.id },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().categoryId).toBe(categoria.id);
    });

    it("produto sem categoria é estado legítimo", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/products`,
        headers: restaurant.headers,
        payload: validProductBody,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().categoryId).toBeUndefined();
    });

    /**
     * Sem esta checagem, o id de uma categoria alheia entraria no produto e ele
     * apareceria agrupado no cardápio de quem não o criou. 404 e não 403: do
     * lado de fora, categoria dos outros é indistinguível de inexistente (S19).
     */
    it("404 ao usar categoria de OUTRO restaurante", async () => {
      const dono = await createRestaurant(app);
      const intruso = await createRestaurant(app);
      const categoriaAlheia = await createCategory(app, dono, {
        name: "Entradas",
      });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${intruso.id}/products`,
        headers: intruso.headers,
        payload: { ...validProductBody, categoryId: categoriaAlheia.id },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toContain("Categoria");
    });

    it("404 com categoria inexistente", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/products`,
        headers: restaurant.headers,
        payload: { ...validProductBody, categoryId: NONEXISTENT_ID },
      });

      expect(response.statusCode).toBe(404);
    });

    it("404 com categoryId que não é uuid — não vira 500", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/products`,
        headers: restaurant.headers,
        payload: { ...validProductBody, categoryId: "nao-e-uuid" },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("mudar o vínculo (PATCH)", () => {
    it("move o produto de seção", async () => {
      const restaurant = await createRestaurant(app);
      const entradas = await createCategory(app, restaurant, {
        name: "Entradas",
      });
      const pratos = await createCategory(app, restaurant, { name: "Pratos" });
      const produto = await createProduct(app, restaurant, {
        categoryId: entradas.id,
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/products/${produto.id}`,
        headers: restaurant.headers,
        payload: { categoryId: pratos.id },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().categoryId).toBe(pratos.id);
    });

    /** É a diferença entre "não mexe na categoria" e "tira da seção". */
    it("categoryId: null tira o produto da seção sem removê-lo", async () => {
      const restaurant = await createRestaurant(app);
      const entradas = await createCategory(app, restaurant, {
        name: "Entradas",
      });
      const produto = await createProduct(app, restaurant, {
        categoryId: entradas.id,
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/products/${produto.id}`,
        headers: restaurant.headers,
        payload: { categoryId: null },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().categoryId).toBeUndefined();
      expect(response.json().name).toBe(produto.name);
    });

    it("não mandar categoryId não mexe na categoria", async () => {
      const restaurant = await createRestaurant(app);
      const entradas = await createCategory(app, restaurant, {
        name: "Entradas",
      });
      const produto = await createProduct(app, restaurant, {
        categoryId: entradas.id,
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/products/${produto.id}`,
        headers: restaurant.headers,
        payload: { name: "Outro nome" },
      });

      expect(response.json().categoryId).toBe(entradas.id);
    });

    it("404 ao mover para categoria de outro restaurante", async () => {
      const dono = await createRestaurant(app);
      const intruso = await createRestaurant(app);
      const categoriaAlheia = await createCategory(app, dono, {
        name: "Entradas",
      });
      const produto = await createProduct(app, intruso);

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${intruso.id}/products/${produto.id}`,
        headers: intruso.headers,
        payload: { categoryId: categoriaAlheia.id },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("remover a categoria", () => {
    /**
     * A decisão de desenho: apagar a seção **não** apaga a comida. A
     * alternativa (409 enquanto houver produto) obrigaria a recategorizar o
     * cardápio inteiro à mão só para corrigir um nome digitado errado.
     */
    it("os produtos ficam sem categoria, mas continuam no cardápio", async () => {
      const restaurant = await createRestaurant(app, { slug: "tokyo-ramen" });
      const entradas = await createCategory(app, restaurant, {
        name: "Entradas",
      });
      const produto = await createProduct(app, restaurant, {
        name: "Guioza",
        categoryId: entradas.id,
      });

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/categories/${entradas.id}`,
        headers: restaurant.headers,
      });

      const leitura = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/products/${produto.id}`,
        headers: restaurant.headers,
      });
      expect(leitura.statusCode).toBe(200);
      expect(leitura.json().categoryId).toBeUndefined();

      // e continua à venda no cardápio público, agora no grupo do resto
      const cardapio = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products",
      });
      expect(cardapio.json().data).toEqual([
        expect.objectContaining({
          name: "Sem categoria",
          products: [expect.objectContaining({ name: "Guioza" })],
        }),
      ]);
    });

    it("produto de OUTRA seção não é afetado", async () => {
      const restaurant = await createRestaurant(app);
      const entradas = await createCategory(app, restaurant, {
        name: "Entradas",
      });
      const pratos = await createCategory(app, restaurant, { name: "Pratos" });
      const ramen = await createProduct(app, restaurant, {
        name: "Ramen",
        categoryId: pratos.id,
      });

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/categories/${entradas.id}`,
        headers: restaurant.headers,
      });

      const leitura = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/products/${ramen.id}`,
        headers: restaurant.headers,
      });
      expect(leitura.json().categoryId).toBe(pratos.id);
    });
  });

  describe("filtro ?categoryId= na listagem de gestão", () => {
    it("recorta pela seção, e o total acompanha", async () => {
      const restaurant = await createRestaurant(app);
      const entradas = await createCategory(app, restaurant, {
        name: "Entradas",
      });
      const pratos = await createCategory(app, restaurant, { name: "Pratos" });
      await createProduct(app, restaurant, {
        name: "Guioza",
        categoryId: entradas.id,
      });
      await createProduct(app, restaurant, {
        name: "Ramen",
        categoryId: pratos.id,
      });
      await createProduct(app, restaurant, { name: "Avulso" });

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/products?categoryId=${pratos.id}`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(1);
      expect(response.json().data[0].name).toBe("Ramen");
      // o total tem que refletir o filtro: 3 aqui faria a paginação mentir
      expect(response.json().total).toBe(1);
    });

    /**
     * Filtro é recorte de listagem, não acesso a recurso: uma seção apagada
     * enquanto a tela estava aberta devolve "não sobrou nada", não um erro.
     */
    it("categoria inexistente devolve página vazia, não 404", async () => {
      const restaurant = await createRestaurant(app);
      await createProduct(app, restaurant);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/products?categoryId=${NONEXISTENT_ID}`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ data: [], total: 0 });
    });
  });
});
