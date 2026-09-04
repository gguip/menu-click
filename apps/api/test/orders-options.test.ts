import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createOption,
  createOptionGroup,
  createOrder,
  createProduct,
  createRestaurant,
  linkOptionGroups,
  validCustomerBody,
} from "./helpers.ts";

/**
 * Criação de pedido com opções escolhidas: validação, preço e congelamento.
 *
 * A mudança mais delicada: a fusão de linhas deixa de ser só `productId`. Ver
 * o comentário no caso 7 — é o que essa mudança protege.
 */
describe("pedidos com opções", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Um hambúrguer com um grupo opcional de adicionais, bacon até 3 unidades. */
  async function cenarioComAdicionais() {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant, {
      name: "Hambúrguer",
      priceInCents: 3000,
      stock: 50,
    });
    const grupo = await createOptionGroup(app, restaurant, {
      name: "Adicionais",
      minOptions: 0,
      maxOptions: 3,
      priceRule: "sum",
    });
    const bacon = await createOption(app, restaurant, grupo.id, {
      name: "Bacon",
      priceInCents: 500,
      maxQuantity: 3,
    });
    await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);
    return { restaurant, produto, grupo, bacon };
  }

  /** Uma pizza com "Sabores" obrigatório, para exercitar highest e average. */
  async function cenarioComSabores(priceRule: "highest" | "average") {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant, {
      name: "Pizza",
      priceInCents: 3000,
      stock: 50,
    });
    const grupo = await createOptionGroup(app, restaurant, {
      name: "Sabores",
      minOptions: 1,
      maxOptions: 2,
      priceRule,
    });
    const calabresa = await createOption(app, restaurant, grupo.id, {
      name: "Calabresa",
      priceInCents: 4505,
    });
    const portuguesa = await createOption(app, restaurant, grupo.id, {
      name: "Portuguesa",
      priceInCents: 5000,
    });
    await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);
    return { restaurant, produto, grupo, calabresa, portuguesa };
  }

  it("sum: unitário e total refletem os adicionais escolhidos", async () => {
    const { restaurant, produto, bacon } = await cenarioComAdicionais();

    const order = await createOrder(app, restaurant.id, [
      {
        productId: produto.id,
        quantity: 1,
        options: [{ optionId: bacon.id, quantity: 2 }],
      },
    ]);

    expect(order.items).toHaveLength(1);
    // 3000 (produto) + 2 * 500 (bacon)
    expect(order.items[0].unitPriceInCents).toBe(4000);
    expect(order.totalInCents).toBe(4000);
  });

  it("highest: unitário é o maior sabor escolhido, não a soma dos dois", async () => {
    const { restaurant, produto, calabresa, portuguesa } =
      await cenarioComSabores("highest");

    const order = await createOrder(app, restaurant.id, [
      {
        productId: produto.id,
        quantity: 1,
        options: [
          { optionId: calabresa.id, quantity: 1 },
          { optionId: portuguesa.id, quantity: 1 },
        ],
      },
    ]);

    // 3000 (produto) + max(4505, 5000)
    expect(order.items[0].unitPriceInCents).toBe(8000);
  });

  /**
   * O caso do meio centavo: 30,00 + (45,05 + 50,00)/2 = 30,00 + 47,53 = 77,53.
   * Com quantidade 2 no item, o total tem que ser o unitário vezes 2 — nunca
   * um arredondamento por conta própria no total, que daria 15505.
   */
  it("average: arredonda no unitário, e o total é unitário × quantidade", async () => {
    const { restaurant, produto, calabresa, portuguesa } =
      await cenarioComSabores("average");

    const order = await createOrder(app, restaurant.id, [
      {
        productId: produto.id,
        quantity: 2,
        options: [
          { optionId: calabresa.id, quantity: 1 },
          { optionId: portuguesa.id, quantity: 1 },
        ],
      },
    ]);

    expect(order.items[0].unitPriceInCents).toBe(7753);
    expect(order.totalInCents).toBe(15506);
    expect(order.totalInCents).not.toBe(15505);
  });

  it("congela o preço da opção: reajuste depois de criado não muda o pedido", async () => {
    const { restaurant, produto, grupo, bacon } = await cenarioComAdicionais();

    const order = await createOrder(app, restaurant.id, [
      {
        productId: produto.id,
        quantity: 1,
        options: [{ optionId: bacon.id, quantity: 1 }],
      },
    ]);

    await app.inject({
      method: "PATCH",
      headers: restaurant.headers,
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options/${bacon.id}`,
      payload: { priceInCents: 9999 },
    });

    const detalhe = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders/${order.id}`,
      headers: restaurant.headers,
    });
    const reloaded = detalhe.json();

    // continua valendo o preço de quando o pedido foi feito, não o novo
    expect(reloaded.items[0].options[0].priceInCents).toBe(500);
    expect(reloaded.items[0].unitPriceInCents).toBe(3500);
  });

  it("options[].groupName vem congelado", async () => {
    const { restaurant, produto, calabresa } = await cenarioComSabores(
      "highest",
    );

    const order = await createOrder(app, restaurant.id, [
      {
        productId: produto.id,
        quantity: 1,
        options: [{ optionId: calabresa.id, quantity: 1 }],
      },
    ]);

    const detalhe = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders/${order.id}`,
      headers: restaurant.headers,
    });

    expect(detalhe.json().items[0].options[0].groupName).toBe("Sabores");
  });

  it("mesmas opções fundem numa linha só, com a quantidade somada", async () => {
    const { restaurant, produto, bacon } = await cenarioComAdicionais();

    const order = await createOrder(app, restaurant.id, [
      {
        productId: produto.id,
        quantity: 1,
        options: [{ optionId: bacon.id, quantity: 1 }],
      },
      {
        productId: produto.id,
        quantity: 1,
        options: [{ optionId: bacon.id, quantity: 1 }],
      },
    ]);

    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(2);
  });

  /**
   * `chaveDeFusao` ordena as escolhas por optionId antes de montar a chave —
   * sem o `.sort()`, a mesma seleção mandada em ordem diferente cairia em
   * chaves diferentes e NÃO fundiria. O caso acima usa uma lista de uma opção
   * só, então não exercita o `.sort()` (uma lista de um elemento "ordena"
   * sozinha); este caso manda os dois sabores em ordens opostas.
   */
  it("a mesma seleção em ordem diferente ainda funde (exercita o sort da chave)", async () => {
    const { restaurant, produto, calabresa, portuguesa } =
      await cenarioComSabores("highest");

    const order = await createOrder(app, restaurant.id, [
      {
        productId: produto.id,
        quantity: 1,
        options: [
          { optionId: calabresa.id, quantity: 1 },
          { optionId: portuguesa.id, quantity: 1 },
        ],
      },
      {
        productId: produto.id,
        quantity: 1,
        options: [
          { optionId: portuguesa.id, quantity: 1 },
          { optionId: calabresa.id, quantity: 1 },
        ],
      },
    ]);

    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(2);
  });

  /**
   * A regra de fusão de linhas mudou por causa disto. Fundir por `productId`
   * transformaria "um com bacon" e "um sem bacon" em "dois hambúrgueres", e o
   * cliente receberia dois iguais.
   */
  it("mesmo produto com opções diferentes gera DUAS linhas", async () => {
    const { restaurant, produto, bacon } = await cenarioComAdicionais();

    const order = await createOrder(app, restaurant.id, [
      { productId: produto.id, quantity: 1, options: [{ optionId: bacon.id, quantity: 1 }] },
      { productId: produto.id, quantity: 1 },
    ]);

    const detalhe = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders/${order.id}`,
      headers: restaurant.headers,
    });

    const items = detalhe.json().items;
    expect(items).toHaveLength(2);
    expect(items.map((i: { quantity: number }) => i.quantity).sort()).toEqual([1, 1]);
  });

  /**
   * `findItems` ordena por `created_at, id` — e `created_at` é o instante em
   * que a TRANSAÇÃO começou, igual para todo item do mesmo pedido. Quem
   * desempata é o uuid aleatório de cada linha, então a ordem da resposta NÃO
   * é a ordem do corpo da requisição. Por isso o teste identifica cada linha
   * pelo conteúdo (o `unitPriceInCents`, que só a linha com bacon tem), nunca
   * por índice — um teste por índice não pegaria `insertItems` devolvendo os
   * ids fora de ordem, porque as quantidades (1 e 1) seriam simétricas sob
   * inversão. Aqui as quantidades são 1 e 3, de propósito: assimétricas.
   */
  it("cada linha recebe as opções que ELA pediu, não a de outra linha", async () => {
    const { restaurant, produto, bacon } = await cenarioComAdicionais();

    const order = await createOrder(app, restaurant.id, [
      {
        productId: produto.id,
        quantity: 1,
        options: [{ optionId: bacon.id, quantity: 1 }],
      },
      { productId: produto.id, quantity: 3 },
    ]);

    const detalhe = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders/${order.id}`,
      headers: restaurant.headers,
    });

    const items = detalhe.json().items;
    expect(items).toHaveLength(2);

    // 3000 (produto) + 500 (bacon) = 3500; sem bacon é só o produto, 3000
    const comBacon = items.find(
      (i: { unitPriceInCents: number }) => i.unitPriceInCents === 3500,
    );
    const semBacon = items.find(
      (i: { unitPriceInCents: number }) => i.unitPriceInCents === 3000,
    );

    expect(comBacon).toBeDefined();
    expect(semBacon).toBeDefined();
    expect(comBacon.quantity).toBe(1);
    expect(comBacon.options.map((o: { name: string }) => o.name)).toEqual([
      "Bacon",
    ]);
    expect(semBacon.quantity).toBe(3);
    expect(semBacon.options).toEqual([]);
  });

  it("opção repetida no mesmo item soma a quantidade antes de checar o teto", async () => {
    const { restaurant, produto, bacon } = await cenarioComAdicionais();

    const order = await createOrder(app, restaurant.id, [
      {
        productId: produto.id,
        quantity: 1,
        options: [
          { optionId: bacon.id, quantity: 1 },
          { optionId: bacon.id, quantity: 1 },
        ],
      },
    ]);

    expect(order.items[0].options).toHaveLength(1);
    expect(order.items[0].options[0].quantity).toBe(2);
  });

  it("e ainda assim é 400 quando a soma das repetições passa do teto", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant, {
      name: "Hambúrguer",
      priceInCents: 3000,
      stock: 50,
    });
    const grupo = await createOptionGroup(app, restaurant, {
      name: "Adicionais",
      minOptions: 0,
      maxOptions: 3,
      priceRule: "sum",
    });
    const bacon = await createOption(app, restaurant, grupo.id, {
      name: "Bacon",
      priceInCents: 500,
      maxQuantity: 1,
    });
    await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "dine_in",
        customer: validCustomerBody,
        items: [
          {
            productId: produto.id,
            quantity: 1,
            options: [
              { optionId: bacon.id, quantity: 1 },
              { optionId: bacon.id, quantity: 1 },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400: opção de um grupo não ligado ao produto", async () => {
    const { restaurant, produto } = await cenarioComAdicionais();
    const outroProduto = await createProduct(app, restaurant, {
      name: "Suco",
      priceInCents: 800,
    });
    const outroGrupo = await createOptionGroup(app, restaurant, {
      name: "Tamanho",
      minOptions: 0,
      maxOptions: 1,
      priceRule: "sum",
    });
    const grande = await createOption(app, restaurant, outroGrupo.id, {
      name: "Grande",
      priceInCents: 200,
    });
    await linkOptionGroups(app, restaurant, outroProduto.id, [outroGrupo.id]);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "dine_in",
        customer: validCustomerBody,
        items: [
          {
            productId: produto.id,
            quantity: 1,
            options: [{ optionId: grande.id, quantity: 1 }],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400: grupo obrigatório sem escolha nenhuma", async () => {
    const { restaurant, produto } = await cenarioComSabores("highest");

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "dine_in",
        customer: validCustomerBody,
        items: [{ productId: produto.id, quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400: excede o maxOptions do grupo (opções distintas)", async () => {
    const { restaurant, produto, grupo, calabresa, portuguesa } =
      await cenarioComSabores("highest");
    const marguerita = await createOption(app, restaurant, grupo.id, {
      name: "Marguerita",
      priceInCents: 4200,
    });

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "dine_in",
        customer: validCustomerBody,
        items: [
          {
            productId: produto.id,
            quantity: 1,
            options: [
              { optionId: calabresa.id, quantity: 1 },
              { optionId: portuguesa.id, quantity: 1 },
              { optionId: marguerita.id, quantity: 1 },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400: excede o maxQuantity da opção", async () => {
    const { restaurant, produto, bacon } = await cenarioComAdicionais();

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "dine_in",
        customer: validCustomerBody,
        items: [
          {
            productId: produto.id,
            quantity: 1,
            options: [{ optionId: bacon.id, quantity: 4 }],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400: opção indisponível", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant, {
      name: "Hambúrguer",
      priceInCents: 3000,
      stock: 50,
    });
    const grupo = await createOptionGroup(app, restaurant, {
      name: "Adicionais",
      minOptions: 0,
      maxOptions: 3,
      priceRule: "sum",
    });
    const bacon = await createOption(app, restaurant, grupo.id, {
      name: "Bacon",
      priceInCents: 500,
      maxQuantity: 3,
      available: false,
    });
    await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "dine_in",
        customer: validCustomerBody,
        items: [
          {
            productId: produto.id,
            quantity: 1,
            options: [{ optionId: bacon.id, quantity: 1 }],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400: optionId que não é uuid", async () => {
    const { restaurant, produto } = await cenarioComAdicionais();

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "dine_in",
        customer: validCustomerBody,
        items: [
          {
            productId: produto.id,
            quantity: 1,
            options: [{ optionId: "not-a-uuid", quantity: 1 }],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("pedido sem `options` continua funcionando (comportamento antigo)", async () => {
    const { restaurant, produto } = await cenarioComAdicionais();

    const order = await createOrder(app, restaurant.id, [
      { productId: produto.id, quantity: 2 },
    ]);

    expect(order.items).toHaveLength(1);
    expect(order.items[0].unitPriceInCents).toBe(3000);
    expect(order.items[0].options).toEqual([]);
    expect(order.totalInCents).toBe(6000);
  });
});
