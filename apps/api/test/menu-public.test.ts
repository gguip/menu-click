import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createCategory,
  createOption,
  createOptionGroup,
  createProduct,
  createRestaurant,
  linkOptionGroups,
} from "./helpers.ts";

/**
 * Cardápio público — o que o QR code aponta, sem login.
 *
 * O ponto destes testes não é o caminho feliz (que é trivial), e sim o que a
 * resposta **não** traz: `stock` não sai daqui. Quantas unidades o restaurante
 * tem é informação dele; o cliente só precisa do `available`.
 *
 * O cardápio vem agrupado por seção, e **quem pagina são as categorias**. Boa
 * parte do que se testa aqui é consequência disso: nenhum grupo se parte entre
 * páginas, e os produtos sem seção têm que aparecer em algum lugar.
 */
describe("cardápio público", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
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
      const pratos = await createCategory(app, restaurant, { name: "Pratos" });
      await createProduct(app, restaurant, {
        name: "Ramen Shoyu",
        categoryId: pratos.id,
        stock: 30,
      });
      await createProduct(app, restaurant, {
        name: "Guioza",
        categoryId: pratos.id,
        stock: 0,
      });

      const response = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products",
      });

      expect(response.statusCode).toBe(200);
      const secoes = response.json().data;
      expect(secoes).toHaveLength(1);

      const produtos = secoes[0].products;
      expect(produtos).toHaveLength(2);
      for (const produto of produtos) {
        expect(produto.stock).toBeUndefined();
        expect(produto.restaurantId).toBeUndefined();
        // o vínculo já está na seção que envolve o produto
        expect(produto.categoryId).toBeUndefined();
      }
      expect(produtos[0]).toMatchObject({
        name: "Ramen Shoyu",
        available: true,
      });
      expect(produtos[1]).toMatchObject({ name: "Guioza", available: false });
    });

    it("agrupa por seção, na ordem da position", async () => {
      const restaurant = await createRestaurant(app, { slug: "tokyo-ramen" });
      // criadas fora de ordem; a alfabética colocaria "Bebidas" na frente
      const bebidas = await createCategory(app, restaurant, {
        name: "Bebidas",
        position: 2,
      });
      const entradas = await createCategory(app, restaurant, {
        name: "Entradas",
        position: 0,
      });
      const pratos = await createCategory(app, restaurant, {
        name: "Pratos",
        position: 1,
      });
      await createProduct(app, restaurant, {
        name: "Chá Verde",
        categoryId: bebidas.id,
      });
      await createProduct(app, restaurant, {
        name: "Guioza",
        categoryId: entradas.id,
      });
      await createProduct(app, restaurant, {
        name: "Ramen",
        categoryId: pratos.id,
      });

      const response = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products",
      });

      const secoes = response.json().data;
      expect(secoes.map((s: { name: string }) => s.name)).toEqual([
        "Entradas",
        "Pratos",
        "Bebidas",
      ]);
      expect(secoes.map((s: { products: unknown[] }) => s.products.length)).toEqual([
        1, 1, 1,
      ]);
      expect(secoes[0].products[0].name).toBe("Guioza");
    });

    it("seção sem produto ainda aparece, vazia", async () => {
      const restaurant = await createRestaurant(app, { slug: "tokyo-ramen" });
      await createCategory(app, restaurant, { name: "Sobremesas" });

      const response = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products",
      });

      expect(response.json().data).toEqual([
        expect.objectContaining({ name: "Sobremesas", products: [] }),
      ]);
    });

    /**
     * O produto sem seção não pode sumir do cardápio: ele está à venda. Isso
     * acontece de verdade quando o restaurante apaga uma seção.
     */
    it("produto sem categoria vai para o grupo 'Sem categoria', no fim", async () => {
      const restaurant = await createRestaurant(app, { slug: "tokyo-ramen" });
      const pratos = await createCategory(app, restaurant, { name: "Pratos" });
      await createProduct(app, restaurant, {
        name: "Ramen",
        categoryId: pratos.id,
      });
      await createProduct(app, restaurant, { name: "Item avulso" });

      const response = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products",
      });

      const secoes = response.json().data;
      expect(secoes.map((s: { name: string }) => s.name)).toEqual([
        "Pratos",
        "Sem categoria",
      ]);
      expect(secoes[1].products[0].name).toBe("Item avulso");
      // não é uma categoria de verdade: não tem id, e não conta no total
      expect(secoes[1].id).toBeUndefined();
      expect(response.json().total).toBe(1);
    });

    it("sem produto solto, o grupo 'Sem categoria' não aparece", async () => {
      const restaurant = await createRestaurant(app, { slug: "tokyo-ramen" });
      const pratos = await createCategory(app, restaurant, { name: "Pratos" });
      await createProduct(app, restaurant, {
        name: "Ramen",
        categoryId: pratos.id,
      });

      const response = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products",
      });

      expect(response.json().data).toHaveLength(1);
    });

    /**
     * A razão de a paginação ser por categoria: com produtos como unidade, um
     * grupo cairia partido entre duas páginas.
     */
    it("pagina categorias, não produtos — e nenhum grupo vem partido", async () => {
      const restaurant = await createRestaurant(app, { slug: "tokyo-ramen" });
      for (const [indice, nome] of ["Entradas", "Pratos", "Bebidas"].entries()) {
        const categoria = await createCategory(app, restaurant, {
          name: nome,
          position: indice,
        });
        // três produtos por seção: uma paginação por produto quebraria aqui
        for (let i = 0; i < 3; i++) {
          await createProduct(app, restaurant, {
            name: `${nome} ${i}`,
            categoryId: categoria.id,
          });
        }
      }

      const primeira = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products?limit=2",
      });

      expect(primeira.json()).toMatchObject({ limit: 2, offset: 0, total: 3 });
      const secoes = primeira.json().data;
      expect(secoes.map((s: { name: string }) => s.name)).toEqual([
        "Entradas",
        "Pratos",
      ]);
      // cada seção veio inteira
      expect(secoes.map((s: { products: unknown[] }) => s.products.length)).toEqual([
        3, 3,
      ]);

      const segunda = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products?limit=2&offset=2",
      });
      expect(
        segunda.json().data.map((s: { name: string }) => s.name),
      ).toEqual(["Bebidas"]);
    });

    /**
     * O grupo do resto vem uma vez só, na última página — repeti-lo em todas
     * mostraria os mesmos produtos várias vezes ao rolar o cardápio.
     */
    it("'Sem categoria' só aparece na última página", async () => {
      const restaurant = await createRestaurant(app, { slug: "tokyo-ramen" });
      for (const [indice, nome] of ["Entradas", "Pratos"].entries()) {
        await createCategory(app, restaurant, { name: nome, position: indice });
      }
      await createProduct(app, restaurant, { name: "Item avulso" });

      const primeira = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products?limit=1",
      });
      expect(
        primeira.json().data.map((s: { name: string }) => s.name),
      ).toEqual(["Entradas"]);

      const ultima = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products?limit=1&offset=1",
      });
      expect(ultima.json().data.map((s: { name: string }) => s.name)).toEqual([
        "Pratos",
        "Sem categoria",
      ]);
    });

    it("produto removido não aparece no cardápio", async () => {
      const restaurant = await createRestaurant(app, { slug: "tokyo-ramen" });
      const pratos = await createCategory(app, restaurant, { name: "Pratos" });
      const product = await createProduct(app, restaurant, {
        categoryId: pratos.id,
      });
      await app.inject({
        method: "DELETE",
        headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}/products/${product.id}`,
      });

      const response = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products",
      });

      expect(response.json().data[0].products).toEqual([]);
    });

    it("cardápio vazio devolve página vazia", async () => {
      await createRestaurant(app, { slug: "tokyo-ramen" });

      const response = await app.inject({
        method: "GET",
        url: "/menu/tokyo-ramen/products",
      });

      expect(response.json()).toMatchObject({ data: [], total: 0 });
    });

    it("404 com slug inexistente", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/menu/nao-existe/products",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("grupos de opções no cardápio", () => {
    it("os grupos vêm normalizados, cada um uma vez", async () => {
      const restaurant = await createRestaurant(app, { slug: "pizzaria" });
      const categoria = await createCategory(app, restaurant, { name: "Pizzas" });
      const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });
      await createOption(app, restaurant, grupo.id, { name: "Calabresa" });
      // DOIS produtos usando o MESMO grupo: é o que o formato normalizado evita
      // repetir
      for (const nome of ["Pizza Grande", "Pizza Média"]) {
        const produto = await createProduct(app, restaurant, {
          name: nome,
          categoryId: categoria.id,
          stock: 10,
        });
        await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);
      }

      const response = await app.inject({
        method: "GET",
        url: "/menu/pizzaria/products",
      });

      const body = response.json();
      expect(body.optionGroups).toHaveLength(1);
      expect(body.optionGroups[0].options[0].name).toBe("Calabresa");
      for (const produto of body.data[0].products) {
        expect(produto.optionGroupIds).toEqual([grupo.id]);
      }
    });

    it("opção indisponível não sai no cardápio", async () => {
      const restaurant = await createRestaurant(app, { slug: "pizzaria" });
      const categoria = await createCategory(app, restaurant, { name: "Pizzas" });
      const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });
      await createOption(app, restaurant, grupo.id, { name: "Calabresa" });
      await createOption(app, restaurant, grupo.id, {
        name: "Fora de estoque",
        available: false,
      });
      const produto = await createProduct(app, restaurant, {
        categoryId: categoria.id,
        stock: 10,
      });
      await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);

      const response = await app.inject({
        method: "GET",
        url: "/menu/pizzaria/products",
      });

      expect(
        response.json().optionGroups[0].options.map((o: { name: string }) => o.name),
      ).toEqual(["Calabresa"]);
    });

    /**
     * A regra do iFood: "o item não aparece à venda enquanto não houver opção
     * para o usuário selecionar". Sem isso o cliente montaria um carrinho que a
     * criação de pedido recusaria.
     */
    it("produto com grupo obrigatório sem opção disponível fica indisponível", async () => {
      const restaurant = await createRestaurant(app, { slug: "pizzaria" });
      const categoria = await createCategory(app, restaurant, { name: "Pizzas" });
      const grupo = await createOptionGroup(app, restaurant, {
        name: "Sabores",
        minOptions: 1,
        maxOptions: 2,
        priceRule: "highest",
      });
      await createOption(app, restaurant, grupo.id, {
        name: "Calabresa",
        available: false,
      });
      const produto = await createProduct(app, restaurant, {
        categoryId: categoria.id,
        stock: 10,
      });
      await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);

      const response = await app.inject({
        method: "GET",
        url: "/menu/pizzaria/products",
      });

      expect(response.json().data[0].products[0].available).toBe(false);
    });

    it("grupo opcional sem opção não torna o produto indisponível", async () => {
      const restaurant = await createRestaurant(app, { slug: "pizzaria" });
      const categoria = await createCategory(app, restaurant, { name: "Pizzas" });
      const grupo = await createOptionGroup(app, restaurant, {
        name: "Adicionais",
        minOptions: 0,
        maxOptions: 3,
        priceRule: "sum",
      });
      const produto = await createProduct(app, restaurant, {
        categoryId: categoria.id,
        stock: 10,
      });
      await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);

      const response = await app.inject({
        method: "GET",
        url: "/menu/pizzaria/products",
      });

      expect(response.json().data[0].products[0].available).toBe(true);
    });

    it("cardápio sem grupo nenhum devolve optionGroups vazio", async () => {
      const restaurant = await createRestaurant(app, { slug: "pizzaria" });
      const categoria = await createCategory(app, restaurant, { name: "Pizzas" });
      await createProduct(app, restaurant, { categoryId: categoria.id, stock: 5 });

      const response = await app.inject({
        method: "GET",
        url: "/menu/pizzaria/products",
      });

      expect(response.json().optionGroups).toEqual([]);
    });
  });
});
