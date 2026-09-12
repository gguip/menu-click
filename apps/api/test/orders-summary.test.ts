import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import {
  buildTestApp,
  createOrder,
  createProduct,
  createRestaurant,
  validDeliveryAddress,
} from "./helpers.ts";
import type { TestRestaurant } from "./helpers.ts";

/**
 * O resumo do painel.
 *
 * Duas coisas aqui não são detalhe: o que conta como **faturamento** (de
 * `confirmed` em diante, sem `pending` nem `cancelled`) e o fato de o período
 * ser resolvido no fuso do restaurante, como na listagem.
 */
describe("resumo dos pedidos", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function cenario(timezone?: string) {
    const restaurant = await createRestaurant(
      app,
      timezone === undefined ? {} : { timezone },
    );
    const product = await createProduct(app, restaurant, {
      priceInCents: 1000,
      stock: 1000,
    });
    return { restaurant, product };
  }

  /** Cria um pedido de `quantity * 1000` centavos e o leva até `status`. */
  async function pedido(
    restaurant: TestRestaurant,
    productId: string,
    quantity: number,
    status: string,
  ) {
    const order = await createOrder(app, restaurant.id, [
      { productId, quantity },
    ]);
    const caminho: Record<string, string[]> = {
      pending: [],
      confirmed: ["confirm"],
      preparing: ["confirm", "start-preparing"],
      completed: ["confirm", "start-preparing", "complete"],
      cancelled: ["cancel"],
    };
    for (const passo of caminho[status]) {
      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders/${order.id}/${passo}`,
        headers: restaurant.headers,
      });
      if (response.statusCode !== 200) {
        throw new Error(`${passo} falhou: ${response.statusCode} ${response.body}`);
      }
    }
    return order;
  }

  async function resumo(restaurant: TestRestaurant, query = "") {
    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders/summary${query ? `?${query}` : ""}`,
      headers: restaurant.headers,
    });
    return { statusCode: response.statusCode, body: response.json() };
  }

  /**
   * ⚠️ Este teste PRENDE um comportamento herdado, não escolhido.
   *
   * Desde a taxa de entrega, `total_in_cents` carrega o frete, e o faturamento
   * soma esse total — então o frete entra no faturamento e no ticket médio.
   * Para faturamento bruto o número está certo: foi o que a loja cobrou. Para
   * decidir preço de cardápio, não: o frete pode ir inteiro para o entregador.
   *
   * Ninguém decidiu isso — veio junto com a mudança da invariante do total. O
   * teste existe para que separar as duas coisas seja uma decisão deliberada,
   * com um teste vermelho apontando para esta explicação, em vez de uma
   * descoberta no meio de um fechamento de mês.
   */
  it("o faturamento inclui o frete, e isso é herdado e não escolhido", async () => {
    const restaurant = await createRestaurant(app, { slug: "faturamento-frete" });
    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { deliveryFixedFeeInCents: 1500 },
    });
    const product = await createProduct(app, restaurant, {
      priceInCents: 3000,
      stock: 10,
    });

    const order = await createOrder(
      app,
      restaurant.id,
      [{ productId: product.id, quantity: 1 }],
      { type: "delivery", deliveryAddress: validDeliveryAddress },
    );
    await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders/${order.id}/confirm`,
      headers: restaurant.headers,
    });

    const { body } = await resumo(restaurant);

    // 3000 de mercadoria + 1500 de frete
    expect(body.revenueInCents).toBe(4500);
    expect(body.averageTicketInCents).toBe(4500);
  });

  it("conta todos os status, inclusive os zerados", async () => {
    const { restaurant, product } = await cenario();
    await pedido(restaurant, product.id, 1, "pending");
    await pedido(restaurant, product.id, 1, "pending");
    await pedido(restaurant, product.id, 1, "confirmed");

    const { statusCode, body } = await resumo(restaurant);

    expect(statusCode).toBe(200);
    expect(body.counts).toEqual({
      pending: 2,
      confirmed: 1,
      preparing: 0,
      ready_for_pickup: 0,
      out_for_delivery: 0,
      completed: 0,
      cancelled: 0,
    });
  });

  /**
   * A regra de negócio do resumo. Contar só `completed` mostraria quase zero
   * no pico do almoço — justamente quando alguém abre o painel.
   */
  describe("o que conta como faturamento", () => {
    it("de confirmed em diante entra", async () => {
      const { restaurant, product } = await cenario();
      await pedido(restaurant, product.id, 1, "confirmed"); // 1000
      await pedido(restaurant, product.id, 2, "preparing"); // 2000
      await pedido(restaurant, product.id, 3, "completed"); // 3000

      const { body } = await resumo(restaurant);

      expect(body.revenueInCents).toBe(6000);
      expect(body.revenueOrderCount).toBe(3);
      expect(body.averageTicketInCents).toBe(2000);
    });

    it("pending fica de fora — ainda não é venda", async () => {
      const { restaurant, product } = await cenario();
      await pedido(restaurant, product.id, 5, "pending");

      const { body } = await resumo(restaurant);

      expect(body.counts.pending).toBe(1);
      expect(body.revenueInCents).toBe(0);
      expect(body.revenueOrderCount).toBe(0);
    });

    it("cancelado fica de fora — deixou de ser venda", async () => {
      const { restaurant, product } = await cenario();
      await pedido(restaurant, product.id, 1, "confirmed"); // 1000
      await pedido(restaurant, product.id, 9, "cancelled");

      const { body } = await resumo(restaurant);

      expect(body.counts.cancelled).toBe(1);
      expect(body.revenueInCents).toBe(1000);
    });

    it("sem faturamento, o ticket médio é zero e não NaN", async () => {
      const { restaurant } = await cenario();

      const { body } = await resumo(restaurant);

      expect(body.revenueInCents).toBe(0);
      expect(body.averageTicketInCents).toBe(0);
    });
  });

  describe("recorte de tempo", () => {
    it("period=today ignora o que é de ontem", async () => {
      const { restaurant, product } = await cenario();
      const ontem = await pedido(restaurant, product.id, 7, "confirmed");
      await pedido(restaurant, product.id, 1, "confirmed");
      await pool.query(
        "update orders set created_at = now() - interval '2 days' where id = $1",
        [ontem.id],
      );

      const { body } = await resumo(restaurant, "period=today");

      expect(body.revenueInCents).toBe(1000);
      expect(body.counts.confirmed).toBe(1);
    });

    /**
     * Sem os limites, um faturamento zerado não tem como ser explicado.
     *
     * A asserção antiga comparava os dois `from` e exigia 1h de diferença —
     * verdade na maior parte do dia, mas falsa entre 00h e 01h em São Paulo,
     * quando Manaus ainda está no dia anterior e a diferença vira −23h. A
     * propriedade que vale sempre é outra: cada `from`, lido no fuso do
     * PRÓPRIO restaurante, é meia-noite em ponto — não importa quantas horas
     * de distância há entre os dois fusos no instante em que o teste roda.
     */
    it("devolve os instantes que usou, no fuso do restaurante", async () => {
      const sp = await cenario("America/Sao_Paulo");
      const manaus = await cenario("America/Manaus");

      const emSp = (await resumo(sp.restaurant, "period=today")).body;
      const emManaus = (await resumo(manaus.restaurant, "period=today")).body;

      expect(emSp.period.from).toBeTruthy();
      expect(emManaus.period.from).toBeTruthy();

      const horaLocal = (iso: string, timezone: string) =>
        new Intl.DateTimeFormat("pt-BR", {
          timeZone: timezone,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).format(new Date(iso));

      expect(horaLocal(emSp.period.from, "America/Sao_Paulo")).toBe("00:00:00");
      expect(horaLocal(emManaus.period.from, "America/Manaus")).toBe(
        "00:00:00",
      );

      // e são instantes de verdade diferentes — senão a coluna `timezone`
      // não estaria fazendo nada
      expect(emSp.period.from).not.toBe(emManaus.period.from);
    });

    it("sem período, não há limites a reportar", async () => {
      const { restaurant } = await cenario();

      const { body } = await resumo(restaurant);

      expect(body.period).toEqual({});
    });

    it("yesterday reporta os dois limites", async () => {
      const { restaurant } = await cenario();

      const { body } = await resumo(restaurant, "period=yesterday");

      expect(body.period.from).toBeTruthy();
      expect(body.period.to).toBeTruthy();
      expect(new Date(body.period.to).getTime()).toBeGreaterThan(
        new Date(body.period.from).getTime(),
      );
    });

    it("400 com period e from juntos", async () => {
      const { restaurant } = await cenario();

      expect(
        (await resumo(restaurant, "period=today&from=2026-01-01")).statusCode,
      ).toBe(400);
    });
  });

  /**
   * `/orders/summary` convive com `/orders/:orderId`. O roteador do Fastify
   * prefere segmento estático a paramétrico, mas isso é garantia dele, e uma
   * garantia da qual esta rota depende merece teste.
   */
  it("summary não é lido como um id de pedido", async () => {
    const { restaurant } = await cenario();

    const { statusCode, body } = await resumo(restaurant);

    expect(statusCode).toBe(200);
    expect(body.counts).toBeDefined();
    // se tivesse caído na rota de detalhe, seria 404 de "pedido não encontrado"
    expect(body.message).toBeUndefined();
  });

  it("só o dono vê o resumo", async () => {
    const dono = await cenario();
    const intruso = await cenario();

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${dono.restaurant.id}/orders/summary`,
      headers: intruso.restaurant.headers,
    });

    expect(response.statusCode).toBe(404);
  });
});
