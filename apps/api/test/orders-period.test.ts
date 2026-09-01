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
 * O recorte de tempo do painel.
 *
 * A parte que importa não é filtrar por data — é filtrar **no fuso do
 * restaurante**. Um pedido feito 00h30 em São Paulo é de ontem para um
 * restaurante em Manaus, e é essa diferença que a coluna `timezone` existe
 * para respeitar.
 */
describe("filtro por período nos pedidos", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Move o `created_at` de um pedido para um instante SQL arbitrário.
   *
   * Pedido nasce com `now()`, então a única forma de exercitar "ontem" é
   * reescrever a coluna. A expressão vai crua de propósito: ela é escrita
   * neste arquivo, nunca vem de entrada (S6).
   */
  async function backdate(orderId: string, expressaoSql: string) {
    await pool.query(
      `update orders set created_at = ${expressaoSql} where id = $1`,
      [orderId],
    );
  }

  /** Restaurante com um produto, pronto para receber pedidos. */
  async function cenario(timezone?: string) {
    const restaurant = await createRestaurant(
      app,
      timezone === undefined ? {} : { timezone },
    );
    const product = await createProduct(app, restaurant, { stock: 100 });
    return { restaurant, product };
  }

  async function pedir(restaurant: TestRestaurant, productId: string) {
    const order = await createOrder(app, restaurant.id, [
      { productId, quantity: 1 },
    ]);
    return order.id as string;
  }

  /** Ids dos pedidos que a listagem devolveu para aquela querystring. */
  async function listar(restaurant: TestRestaurant, query: string) {
    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders?${query}`,
      headers: restaurant.headers,
    });
    return {
      statusCode: response.statusCode,
      ids: (response.json().data ?? []).map((o: { id: string }) => o.id),
      total: response.json().total,
      message: response.json().message,
    };
  }

  describe("atalhos nomeados", () => {
    it("today traz só o que é de hoje", async () => {
      const { restaurant, product } = await cenario();
      const hoje = await pedir(restaurant, product.id);
      const ontem = await pedir(restaurant, product.id);
      await backdate(ontem, "now() - interval '1 day'");

      const { statusCode, ids, total } = await listar(restaurant, "period=today");

      expect(statusCode).toBe(200);
      expect(ids).toEqual([hoje]);
      // o filtro vale para o total também: 2 aqui faria a paginação mentir
      expect(total).toBe(1);
    });

    it("yesterday exclui hoje e anteontem", async () => {
      const { restaurant, product } = await cenario();
      await pedir(restaurant, product.id);
      const ontem = await pedir(restaurant, product.id);
      const anteontem = await pedir(restaurant, product.id);
      await backdate(
        ontem,
        "(date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '12 hours') at time zone 'America/Sao_Paulo'",
      );
      await backdate(
        anteontem,
        "(date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '36 hours') at time zone 'America/Sao_Paulo'",
      );

      const { ids } = await listar(restaurant, "period=yesterday");

      expect(ids).toEqual([ontem]);
    });

    it("last7days inclui hoje e 6 dias atrás, mas não 7", async () => {
      const { restaurant, product } = await cenario();
      const hoje = await pedir(restaurant, product.id);
      const seisDias = await pedir(restaurant, product.id);
      const seteDias = await pedir(restaurant, product.id);
      const meioDoDia = (dias: number) =>
        `(date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '${dias} days' + interval '12 hours') at time zone 'America/Sao_Paulo'`;
      await backdate(seisDias, meioDoDia(6));
      await backdate(seteDias, meioDoDia(7));

      const { ids } = await listar(restaurant, "period=last7days");

      expect(ids).toContain(hoje);
      expect(ids).toContain(seisDias);
      expect(ids).not.toContain(seteDias);
    });

    it("thisMonth exclui o mês passado", async () => {
      const { restaurant, product } = await cenario();
      const esteMes = await pedir(restaurant, product.id);
      const mesPassado = await pedir(restaurant, product.id);
      await backdate(
        mesPassado,
        "(date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 hour') at time zone 'America/Sao_Paulo'",
      );

      const { ids } = await listar(restaurant, "period=thisMonth");

      expect(ids).toEqual([esteMes]);
    });
  });

  /**
   * A razão de existir da coluna `timezone`, num teste só.
   *
   * O mesmo instante — 00h30 em São Paulo — é hoje para um restaurante
   * paulista e ontem para um em Manaus, que está uma hora atrás. Se o recorte
   * fosse feito em UTC ou no fuso do servidor, os dois veriam a mesma coisa, e
   * um deles estaria errado.
   */
  describe("o fuso do restaurante decide onde o dia começa", () => {
    /** 00h30 de hoje em São Paulo = 23h30 de ontem em Manaus. */
    const MEIA_NOITE_E_MEIA_EM_SP =
      "(date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '30 minutes') at time zone 'America/Sao_Paulo'";

    it("para São Paulo, o pedido das 00h30 é de HOJE", async () => {
      const { restaurant, product } = await cenario("America/Sao_Paulo");
      const pedido = await pedir(restaurant, product.id);
      await backdate(pedido, MEIA_NOITE_E_MEIA_EM_SP);

      expect((await listar(restaurant, "period=today")).ids).toEqual([pedido]);
    });

    it("para Manaus, o MESMO instante é de ONTEM", async () => {
      const { restaurant, product } = await cenario("America/Manaus");
      const pedido = await pedir(restaurant, product.id);
      await backdate(pedido, MEIA_NOITE_E_MEIA_EM_SP);

      expect((await listar(restaurant, "period=today")).ids).toEqual([]);
      expect((await listar(restaurant, "period=yesterday")).ids).toEqual([
        pedido,
      ]);
    });
  });

  describe("intervalo por datas", () => {
    it("from/to é fechado nos dois lados — a mesma data é o dia inteiro", async () => {
      const { restaurant, product } = await cenario();
      const pedido = await pedir(restaurant, product.id);
      // 23h59 de um dia fixo: o limite superior tem que incluir o dia todo
      await backdate(pedido, "timestamptz '2026-03-15 23:59:00-03'");

      const dentro = await listar(restaurant, "from=2026-03-15&to=2026-03-15");
      const antes = await listar(restaurant, "from=2026-03-16&to=2026-03-20");
      const depois = await listar(restaurant, "from=2026-03-01&to=2026-03-14");

      expect(dentro.ids).toEqual([pedido]);
      expect(antes.ids).toEqual([]);
      expect(depois.ids).toEqual([]);
    });

    it("só from vale como 'daí em diante'", async () => {
      const { restaurant, product } = await cenario();
      const antigo = await pedir(restaurant, product.id);
      const recente = await pedir(restaurant, product.id);
      await backdate(antigo, "timestamptz '2020-01-01 12:00:00-03'");

      const { ids } = await listar(restaurant, "from=2021-01-01");

      expect(ids).toEqual([recente]);
    });

    it("só to vale como 'até ali'", async () => {
      const { restaurant, product } = await cenario();
      const antigo = await pedir(restaurant, product.id);
      await pedir(restaurant, product.id);
      await backdate(antigo, "timestamptz '2020-01-01 12:00:00-03'");

      const { ids } = await listar(restaurant, "to=2020-12-31");

      expect(ids).toEqual([antigo]);
    });
  });

  describe("combinações recusadas", () => {
    /**
     * Não existe "hoje, de 1 a 5 de agosto". Aceitar em silêncio, ignorando um
     * dos dois, devolveria um número que ninguém pediu — e num painel de
     * faturamento isso é pior do que um erro.
     */
    it("400 com period e from juntos", async () => {
      const { restaurant } = await cenario();

      const { statusCode, message } = await listar(
        restaurant,
        "period=today&from=2026-03-01",
      );

      expect(statusCode).toBe(400);
      expect(message).toContain("period");
    });

    it("400 quando o período começa depois de terminar", async () => {
      const { restaurant } = await cenario();

      const { statusCode, message } = await listar(
        restaurant,
        "from=2026-03-20&to=2026-03-01",
      );

      expect(statusCode).toBe(400);
      expect(message).toContain("2026-03-20");
    });

    it("400 com period fora da lista", async () => {
      const { restaurant } = await cenario();

      expect((await listar(restaurant, "period=lastCentury")).statusCode).toBe(
        400,
      );
    });

    it("400 com data mal formada", async () => {
      const { restaurant } = await cenario();

      expect((await listar(restaurant, "from=15/03/2026")).statusCode).toBe(400);
    });
  });

  it("sem filtro, o período não recorta nada", async () => {
    const { restaurant, product } = await cenario();
    const hoje = await pedir(restaurant, product.id);
    const antigo = await pedir(restaurant, product.id);
    await backdate(antigo, "timestamptz '2020-01-01 12:00:00-03'");

    const { total } = await listar(restaurant, "limit=20");

    expect(total).toBe(2);
    expect((await listar(restaurant, "limit=20")).ids).toContain(hoje);
  });
});
