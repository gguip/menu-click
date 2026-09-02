import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import {
  buildTestApp,
  createOrder,
  createProduct,
  createRestaurant,
} from "./helpers.ts";
import type { TestRestaurant } from "./helpers.ts";

/**
 * A ordenação da listagem de pedidos.
 *
 * O default é o mais novo primeiro — o painel existe para ver o pedido que
 * acabou de chegar. A parte que precisa de cuidado é `?sort=`: `order by` não
 * aceita `$n`, porque nome de coluna é identificador e não valor, então o que
 * protege aqui é a allowlist (S3), não o driver.
 */
describe("ordenação dos pedidos", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Três pedidos de valores diferentes, criados em instantes distintos. */
  async function cenario() {
    const restaurant = await createRestaurant(app);
    const barato = await createProduct(app, restaurant, {
      name: "Chá",
      priceInCents: 500,
      stock: 100,
    });
    const caro = await createProduct(app, restaurant, {
      name: "Ramen",
      priceInCents: 5000,
      stock: 100,
    });

    // criados em ordem: primeiro o de 500, depois o de 5000, depois o de 1000
    const primeiro = await createOrder(app, restaurant.id, [
      { productId: barato.id, quantity: 1 },
    ]);
    const segundo = await createOrder(app, restaurant.id, [
      { productId: caro.id, quantity: 1 },
    ]);
    const terceiro = await createOrder(app, restaurant.id, [
      { productId: barato.id, quantity: 2 },
    ]);

    // instantes distintos e conhecidos, ancorados na meia-noite de SP (o fuso
    // default do restaurante) em vez de "now() - X minutos": perto da virada
    // do dia, subtrair minutos de `now()` podia jogar o pedido para ONTEM, e
    // o teste de "period=today" logo abaixo via menos de três pedidos
    const inicioDoDiaEmSp =
      "date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'";
    const em = async (id: string, minutos: number) =>
      pool.query(
        `update orders set created_at = (${inicioDoDiaEmSp}) + interval '${minutos} minutes' where id = $1`,
        [id],
      );
    await em(primeiro.id, 10);
    await em(segundo.id, 20);
    await em(terceiro.id, 30);

    return { restaurant, primeiro, segundo, terceiro };
  }

  async function listar(restaurant: TestRestaurant, query = "") {
    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders${query ? `?${query}` : ""}`,
      headers: restaurant.headers,
    });
    return {
      statusCode: response.statusCode,
      ids: (response.json().data ?? []).map((o: { id: string }) => o.id),
      totais: (response.json().data ?? []).map(
        (o: { totalInCents: number }) => o.totalInCents,
      ),
    };
  }

  it("o default é do mais novo para o mais antigo", async () => {
    const { restaurant, primeiro, segundo, terceiro } = await cenario();

    const { ids } = await listar(restaurant);

    expect(ids).toEqual([terceiro.id, segundo.id, primeiro.id]);
  });

  it("order=asc devolve a ordem da cozinha", async () => {
    const { restaurant, primeiro, segundo, terceiro } = await cenario();

    const { ids } = await listar(restaurant, "order=asc");

    expect(ids).toEqual([primeiro.id, segundo.id, terceiro.id]);
  });

  it("sort=totalInCents ordena por valor", async () => {
    const { restaurant } = await cenario();

    const desc = await listar(restaurant, "sort=totalInCents&order=desc");
    const asc = await listar(restaurant, "sort=totalInCents&order=asc");

    expect(desc.totais).toEqual([5000, 1000, 500]);
    expect(asc.totais).toEqual([500, 1000, 5000]);
  });

  /**
   * A propriedade que interessa: paginar por um campo com empates não repete
   * nem perde pedido.
   *
   * ⚠️ Este teste **não** prova o desempate por `id`: removendo-o do `order by`,
   * ele continua passando (verificado). Com a tabela pequena o Postgres devolve
   * as linhas empatadas sempre na mesma ordem, e provocar o contrário exigiria
   * dado suficiente para mudar o plano de execução. O desempate está lá como
   * garantia contra esse plano futuro; o que este teste trava é o
   * comportamento visível de hoje.
   */
  it("empate no campo ordenado não repete nem perde pedido", async () => {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant, {
      priceInCents: 1000,
      stock: 100,
    });
    for (let i = 0; i < 6; i++) {
      await createOrder(app, restaurant.id, [
        { productId: produto.id, quantity: 1 },
      ]);
    }

    const paginas: string[] = [];
    for (const offset of [0, 2, 4]) {
      const { ids } = await listar(
        restaurant,
        `sort=totalInCents&order=desc&limit=2&offset=${offset}`,
      );
      paginas.push(...ids);
    }

    // seis pedidos, todos de 1000: nenhum repetido, nenhum faltando
    expect(new Set(paginas).size).toBe(6);
  });

  describe("allowlist", () => {
    it("400 com sort fora da lista", async () => {
      const { restaurant } = await cenario();

      expect((await listar(restaurant, "sort=deleted_at")).statusCode).toBe(400);
    });

    it("400 com order fora da lista", async () => {
      const { restaurant } = await cenario();

      expect((await listar(restaurant, "order=descending")).statusCode).toBe(
        400,
      );
    });

    /**
     * O ataque óbvio contra `order by` montado por concatenação. Aqui ele nem
     * chega ao SQL: o valor não está na allowlist, então é 400.
     */
    it("400 com injection na cláusula de ordenação", async () => {
      const { restaurant } = await cenario();

      const injecao = encodeURIComponent("created_at; drop table orders; --");
      expect((await listar(restaurant, `sort=${injecao}`)).statusCode).toBe(400);

      // e a tabela continua lá
      expect((await listar(restaurant)).ids).toHaveLength(3);
    });
  });

  it("a ordenação combina com o filtro por período", async () => {
    const { restaurant, primeiro, segundo, terceiro } = await cenario();

    const { ids } = await listar(restaurant, "period=today&order=asc");

    expect(ids).toEqual([primeiro.id, segundo.id, terceiro.id]);
  });
});
