import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createRestaurant,
} from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

describe("CRUD /restaurants", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /restaurants", () => {
    it("devolve o restaurante da sessão, não os dos outros", async () => {
      const meu = await createRestaurant(app, { name: "Tokyo Ramen House" });
      await createRestaurant(app, { name: "Cantina da Nona" });

      const response = await app.inject({
        method: "GET",
        url: "/restaurants",
        headers: meu.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(1);
      expect(response.json().data[0].id).toBe(meu.id);
      expect(response.json().total).toBe(1);
    });

    it("401 sem sessão", async () => {
      const response = await app.inject({ method: "GET", url: "/restaurants" });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /restaurants/:id", () => {
    it("200 com o restaurante", async () => {
      const created = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        headers: created.headers,
        url: `/restaurants/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: created.id,
        name: created.name,
      });
    });

    it("404 para id que não é o da sessão", async () => {
      const created = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${NONEXISTENT_ID}`,
        headers: created.headers,
      });

      expect(response.statusCode).toBe(404);
    });

    it("404 ao ler o restaurante de outra sessão (não 403)", async () => {
      const meu = await createRestaurant(app);
      const alheio = await createRestaurant(app);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${alheio.id}`,
        headers: meu.headers,
      });

      // 403 confirmaria que esse restaurante existe
      expect(response.statusCode).toBe(404);
    });
  });

  describe("PATCH /restaurants/:id", () => {
    it("200, updatedAt muda e createdAt não", async () => {
      const created = await createRestaurant(app);

      // Garante que o `now()` do PATCH caia num instante estritamente
      // depois do `now()` do INSERT (evita empate no timestamp).
      await new Promise((resolve) => setTimeout(resolve, 10));

      const response = await app.inject({
        method: "PATCH",
        headers: created.headers,
        url: `/restaurants/${created.id}`,
        payload: { name: "Novo Nome" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe("Novo Nome");
      expect(body.createdAt).toBe(created.createdAt);
      expect(body.updatedAt).not.toBe(created.updatedAt);
      expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
    });

    it("400 com tipo errado", async () => {
      const created = await createRestaurant(app);

      const response = await app.inject({
        method: "PATCH",
        headers: created.headers,
        url: `/restaurants/${created.id}`,
        payload: { isDelivery: "yes" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("404 para id que não é o da sessão", async () => {
      const created = await createRestaurant(app);

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${NONEXISTENT_ID}`,
        headers: created.headers,
        payload: { name: "Novo Nome" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("404 ao editar o restaurante de outra sessão", async () => {
      const meu = await createRestaurant(app);
      const alheio = await createRestaurant(app, { name: "Cantina da Nona" });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${alheio.id}`,
        headers: meu.headers,
        payload: { name: "Sequestrado" },
      });

      expect(response.statusCode).toBe(404);

      // e o nome do outro continua intacto
      const conferindo = await app.inject({
        method: "GET",
        url: `/restaurants/${alheio.id}`,
        headers: alheio.headers,
      });
      expect(conferindo.json().name).toBe("Cantina da Nona");
    });
  });

  describe("DELETE /restaurants/:id", () => {
    it("204 e depois GET dá 404", async () => {
      const created = await createRestaurant(app);

      const deleteResponse = await app.inject({
        method: "DELETE",
        headers: created.headers,
        url: `/restaurants/${created.id}`,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const getResponse = await app.inject({
        method: "GET",
        headers: created.headers,
        url: `/restaurants/${created.id}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });
  });

  describe("formas de pagamento aceitas", () => {
    it("nasce aceitando dinheiro, cartão e pix, mas não vale-refeição", async () => {
      const restaurant = await createRestaurant(app);

      expect(restaurant).toMatchObject({
        acceptsCash: true,
        acceptsCardOnDelivery: true,
        acceptsPix: true,
        // exige credenciamento com a bandeira: quem tem, liga
        acceptsMealVoucher: false,
      });
    });

    it("PATCH muda o que é aceito", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
        payload: { acceptsPix: false, acceptsMealVoucher: true },
      });

      expect(response.json()).toMatchObject({
        acceptsPix: false,
        acceptsMealVoucher: true,
        acceptsCash: true,
      });
    });

    it("o cardápio público lista as formas aceitas, não as flags", async () => {
      const restaurant = await createRestaurant(app, { slug: "pagamentos" });
      await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
        payload: { acceptsPix: false },
      });

      const response = await app.inject({ method: "GET", url: "/menu/pagamentos" });

      expect(response.json().paymentMethods).toEqual(["cash", "card_on_delivery"]);
      // as flags cruas não vazam: o cliente recebe a lista pronta
      expect(response.json().acceptsCash).toBeUndefined();
    });
  });

  describe("configuração de frete", () => {
    it("configura o frete por PATCH e devolve na leitura", async () => {
      const restaurant = await createRestaurant(app, { slug: "com-frete" });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
        payload: {
          // `neighborhood`, e não `fixed`, de propósito: `fixed` É o default da
          // coluna, então a leitura bateria mesmo que o PATCH nunca escrevesse
          // a coluna — o teste passaria sem testar nada. Todo campo aqui manda
          // valor diferente do default pelo mesmo motivo.
          deliveryFeeMode: "neighborhood",
          deliveryFixedFeeInCents: 700,
          freeDeliveryAboveInCents: 5000,
          deliveryFeeToArrange: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        deliveryFeeMode: "neighborhood",
        deliveryFixedFeeInCents: 700,
        freeDeliveryAboveInCents: 5000,
        deliveryFeeToArrange: true,
      });
    });

    it("restaurante nasce com entrega grátis, como era antes", async () => {
      const restaurant = await createRestaurant(app, { slug: "novo-frete" });

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
      });

      // o default da coluna é o comportamento de hoje: delivery de graça
      expect(response.json()).toMatchObject({
        deliveryFeeMode: "fixed",
        deliveryFixedFeeInCents: 0,
        deliveryFeeToArrange: false,
      });
      expect(response.json().freeDeliveryAboveInCents).toBeUndefined();
    });

    it("recusa modo de cobrança inventado com 400", async () => {
      const restaurant = await createRestaurant(app, { slug: "modo-ruim" });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
        payload: { deliveryFeeMode: "por_lua" },
      });

      expect(response.statusCode).toBe(400);
    });

    /**
     * O validador ESTRITO do corpo, provado pelo campo onde a falha custaria
     * mais caro.
     *
     * Sem `installRouteValidators`, vale o Ajv padrão do Fastify, que coage
     * tipo: `null` num campo `integer` vira `0`, com **200** na resposta. Em
     * `freeDeliveryAboveInCents` isso significa "frete grátis acima de
     * R$ 0,00" — entrega grátis em todo pedido da loja —, e não havia caminho
     * pela API de volta para NULL. Era o defeito que a revisão da branch
     * inteira pegou, e nenhuma revisão por tarefa podia ver: a lacuna estava
     * num arquivo de rota anterior a esta feature.
     */
    it("desliga a promoção de frete grátis com null", async () => {
      const restaurant = await createRestaurant(app, { slug: "desliga-promo" });
      await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
        payload: { freeDeliveryAboveInCents: 5000 },
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
        // `null` aqui é intenção, não ausência: sem este caminho a promoção
        // seria de mão única, e a loja que rodou "grátis acima de R$ 50" só
        // poderia disfarçá-la subindo o limite para um número absurdo
        payload: { freeDeliveryAboveInCents: null },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().freeDeliveryAboveInCents).toBeUndefined();
    });

    it("recusa null e string nos campos de dinheiro, em vez de coagir", async () => {
      const restaurant = await createRestaurant(app, { slug: "sem-coercao" });

      // `freeDeliveryAboveInCents: null` NÃO entra aqui: naquele campo o nulo é
      // intenção declarada (`nullable: true`), e desliga a promoção. Estes são
      // os casos em que o nulo ou a string são erro de quem chama.
      const respostas = await Promise.all(
        [
          { deliveryFixedFeeInCents: null },
          { deliveryFixedFeeInCents: "2500" },
          { deliveryFeeToArrange: "true" },
          { deliveryFeeMode: 1 },
        ].map((payload) =>
          app.inject({
            method: "PATCH",
            url: `/restaurants/${restaurant.id}`,
            headers: restaurant.headers,
            payload,
          }),
        ),
      );

      expect(respostas.map((r) => r.statusCode)).toEqual([400, 400, 400, 400]);
    });

    it("ainda não deixa escolher o modo por distância", async () => {
      const restaurant = await createRestaurant(app, { slug: "modo-distancia" });

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
        payload: { deliveryFeeMode: "distance" },
      });

      // o banco aceitaria; quem recusa é o schema da rota, até a Parte 2
      expect(response.statusCode).toBe(400);
    });
  });
});
