import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { pool } from "../src/db/pool.ts";
import { createOrder, createProduct, createRestaurant } from "./helpers.ts";

/**
 * Confirmação e cancelamento de pedido.
 *
 * A confirmação é o único ponto do sistema que tira unidade de `products.stock`
 * — e o único que precisa travar mais de uma linha por transação. Os testes de
 * concorrência no fim do arquivo são o que dá sentido aos dois
 * `select ... for update` do serviço.
 */
describe("confirmação e cancelamento de pedido", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Abre `n` conexões no pool antes de uma corrida.
   *
   * Sem isso os testes de concorrência mentem: com o pool frio, cada requisição
   * espera o handshake de uma conexão nova, e o handshake é lento o bastante
   * para a primeira transação inteira terminar antes de a segunda começar. O
   * teste passa mesmo com o lock removido — porque nunca houve corrida.
   */
  async function warmPool(n: number): Promise<void> {
    await Promise.all(Array.from({ length: n }, () => pool.query("select 1")));
  }

  /** Estoque real da linha, lido fora da API. */
  async function stockOf(productId: string): Promise<number> {
    const { rows } = await pool.query<{ stock: number }>(
      "select stock from products where id = $1",
      [productId],
    );
    return rows[0].stock;
  }

  function confirm(restaurantId: string, orderId: string) {
    return app.inject({
      method: "POST",
      url: `/restaurants/${restaurantId}/orders/${orderId}/confirm`,
    });
  }

  function cancel(restaurantId: string, orderId: string) {
    return app.inject({
      method: "POST",
      url: `/restaurants/${restaurantId}/orders/${orderId}/cancel`,
    });
  }

  describe("POST .../confirm", () => {
    it("confirma o pedido e debita o estoque", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant.id, { stock: 10 });
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 3 },
      ]);

      const response = await confirm(restaurant.id, order.id);

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe("confirmed");
      expect(await stockOf(product.id)).toBe(7);
    });

    it("debita cada produto pela sua quantidade", async () => {
      const restaurant = await createRestaurant(app);
      const ramen = await createProduct(app, restaurant.id, {
        name: "Ramen",
        stock: 10,
      });
      const guioza = await createProduct(app, restaurant.id, {
        name: "Guioza",
        stock: 4,
      });
      const order = await createOrder(app, restaurant.id, [
        { productId: ramen.id, quantity: 2 },
        { productId: guioza.id, quantity: 4 },
      ]);

      expect((await confirm(restaurant.id, order.id)).statusCode).toBe(200);
      expect(await stockOf(ramen.id)).toBe(8);
      expect(await stockOf(guioza.id)).toBe(0);
    });

    it("409 ao confirmar duas vezes, sem debitar de novo", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant.id, { stock: 10 });
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 3 },
      ]);

      expect((await confirm(restaurant.id, order.id)).statusCode).toBe(200);
      expect((await confirm(restaurant.id, order.id)).statusCode).toBe(409);
      expect(await stockOf(product.id)).toBe(7);
    });

    it("409 com estoque insuficiente, sem debitar nada", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant.id, { stock: 2 });
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 5 },
      ]);

      const response = await confirm(restaurant.id, order.id);

      expect(response.statusCode).toBe(409);
      expect(await stockOf(product.id)).toBe(2);
    });

    it("um item sem estoque não deixa os outros serem debitados", async () => {
      const restaurant = await createRestaurant(app);
      const ramen = await createProduct(app, restaurant.id, {
        name: "Ramen",
        stock: 10,
      });
      const guioza = await createProduct(app, restaurant.id, {
        name: "Guioza",
        stock: 1,
      });
      const order = await createOrder(app, restaurant.id, [
        { productId: ramen.id, quantity: 2 },
        { productId: guioza.id, quantity: 5 },
      ]);

      expect((await confirm(restaurant.id, order.id)).statusCode).toBe(409);
      // o item que TINHA estoque continua intacto: a transação inteira voltou
      expect(await stockOf(ramen.id)).toBe(10);
      expect(await stockOf(guioza.id)).toBe(1);
    });

    it("409 quando um produto saiu do cardápio depois do pedido", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant.id, { stock: 10 });
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 1 },
      ]);

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/products/${product.id}`,
      });

      const response = await confirm(restaurant.id, order.id);
      expect(response.statusCode).toBe(409);
    });

    it("409 ao confirmar pedido cancelado", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant.id, { stock: 10 });
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 1 },
      ]);

      expect((await cancel(restaurant.id, order.id)).statusCode).toBe(200);
      expect((await confirm(restaurant.id, order.id)).statusCode).toBe(409);
      expect(await stockOf(product.id)).toBe(10);
    });

    it("404 com pedido inexistente", async () => {
      const restaurant = await createRestaurant(app);

      const response = await confirm(
        restaurant.id,
        "00000000-0000-0000-0000-000000000000",
      );
      expect(response.statusCode).toBe(404);
    });

    it("404 ao confirmar pedido de outro restaurante", async () => {
      const restaurantA = await createRestaurant(app);
      const restaurantB = await createRestaurant(app);
      const product = await createProduct(app, restaurantA.id, { stock: 10 });
      const order = await createOrder(app, restaurantA.id, [
        { productId: product.id, quantity: 1 },
      ]);

      const response = await confirm(restaurantB.id, order.id);

      expect(response.statusCode).toBe(404);
      expect(await stockOf(product.id)).toBe(10);
    });
  });

  describe("POST .../cancel", () => {
    it("cancela pedido pendente sem mexer no estoque", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant.id, { stock: 10 });
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 3 },
      ]);

      const response = await cancel(restaurant.id, order.id);

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe("cancelled");
      expect(await stockOf(product.id)).toBe(10);
    });

    it("409 ao cancelar pedido já confirmado", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant.id, { stock: 10 });
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 3 },
      ]);

      expect((await confirm(restaurant.id, order.id)).statusCode).toBe(200);
      expect((await cancel(restaurant.id, order.id)).statusCode).toBe(409);
      // continua debitado: cancelar confirmado não devolve estoque (nem cancela)
      expect(await stockOf(product.id)).toBe(7);
    });

    it("409 ao cancelar duas vezes", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant.id, { stock: 10 });
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 1 },
      ]);

      expect((await cancel(restaurant.id, order.id)).statusCode).toBe(200);
      expect((await cancel(restaurant.id, order.id)).statusCode).toBe(409);
    });
  });

  /**
   * Os testes que dão sentido aos dois locks do serviço. Sem eles, `for update`
   * seria só uma palavra a mais no SQL.
   */
  describe("concorrência", () => {
    /**
     * Oito confirmações do mesmo pedido ao mesmo tempo, não duas: com duas, as
     * transações quase sempre acabam se alternando por acaso e o teste passa
     * mesmo sem lock nenhum — não prova nada.
     *
     * Verificado: tirando o `for update` de `selectStatusForUpdate`, as oito
     * transações leem `pending` juntas, as oito confirmam e o estoque cai de
     * 30 para 6 (8 x 3) em vez de 27. O `update` de status sozinho não protege:
     * ele serializa a escrita, mas cada transação já tinha decidido confirmar.
     */
    it("oito confirmações simultâneas do mesmo pedido debitam uma vez só", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant.id, { stock: 30 });
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 3 },
      ]);

      await warmPool(8);
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => confirm(restaurant.id, order.id)),
      );

      const confirmed = responses.filter((r) => r.statusCode === 200);
      const rejected = responses.filter((r) => r.statusCode === 409);

      expect(confirmed).toHaveLength(1);
      expect(rejected).toHaveLength(7);
      expect(await stockOf(product.id)).toBe(27);
    });

    /**
     * O tradeoff assumido ao debitar só na confirmação: pedido `pending` NÃO é
     * reserva. Os dois pedidos nascem, e a disputa acontece na confirmação.
     */
    it("dois pedidos para a última unidade: os dois nascem, só um confirma", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant.id, { stock: 1 });

      const primeiro = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 1 },
      ]);
      const segundo = await createOrder(
        app,
        restaurant.id,
        [{ productId: product.id, quantity: 1 }],
        { customer: { name: "Bruno Lima", phone: "11988887777" } },
      );

      // criar não reservou: os dois existem e estão pendentes
      expect(primeiro.status).toBe("pending");
      expect(segundo.status).toBe("pending");

      await warmPool(2);
      const responses = await Promise.all([
        confirm(restaurant.id, primeiro.id),
        confirm(restaurant.id, segundo.id),
      ]);

      const codes = responses.map((r) => r.statusCode).sort();
      expect(codes).toEqual([200, 409]);
      expect(await stockOf(product.id)).toBe(0);
    });

    /**
     * Vários pedidos com os MESMOS produtos, listados em ordens invertidas,
     * confirmados ao mesmo tempo.
     *
     * Honestidade sobre o que este teste prova: ele NÃO falha se o `order by
     * id` de `selectStocksForUpdate` for removido. O `= any($1::uuid[])` deixa
     * a ordem de travamento por conta do plano de execução, e hoje o plano é o
     * mesmo nas duas transações — então elas travam na mesma ordem por acaso,
     * não por garantia. O `order by id` existe justamente para não depender
     * desse acaso (plano diferente com a tabela maior, index scan virando seq
     * scan) e o teste serve como regressão do caminho feliz: pedidos
     * concorrentes que se sobrepõem terminam os dois.
     */
    it("pedidos com produtos em ordem invertida se resolvem sem travar", async () => {
      const restaurant = await createRestaurant(app);
      const ramen = await createProduct(app, restaurant.id, {
        name: "Ramen",
        stock: 50,
      });
      const guioza = await createProduct(app, restaurant.id, {
        name: "Guioza",
        stock: 50,
      });

      const primeiro = await createOrder(app, restaurant.id, [
        { productId: ramen.id, quantity: 1 },
        { productId: guioza.id, quantity: 1 },
      ]);
      const segundo = await createOrder(
        app,
        restaurant.id,
        [
          { productId: guioza.id, quantity: 1 },
          { productId: ramen.id, quantity: 1 },
        ],
        { customer: { name: "Bruno Lima", phone: "11988887777" } },
      );

      await warmPool(2);
      const responses = await Promise.all([
        confirm(restaurant.id, primeiro.id),
        confirm(restaurant.id, segundo.id),
      ]);

      expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(await stockOf(ramen.id)).toBe(48);
      expect(await stockOf(guioza.id)).toBe(48);
    });
  });
});
