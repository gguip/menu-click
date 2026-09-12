import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestRestaurant } from "./helpers.ts";
import {
  buildTestApp,
  createOrder,
  createProduct,
  createRestaurant,
  setDeliveryNeighborhoods,
  validCustomerBody,
  validDeliveryAddress,
} from "./helpers.ts";

/**
 * `POST /menu/:slug/delivery-quote` — a cotação de frete ANTES do pedido.
 *
 * É a superfície pública: o cliente do QR code (ou a tela do cardápio) quer
 * saber se a loja entrega no endereço dele e por quanto, sem precisar montar
 * um carrinho primeiro. O cálculo de verdade mora em `quoteDelivery`
 * (`domain/delivery.ts`, Task 4) — este endpoint só resolve o restaurante pelo
 * slug e busca os bairros quando o modo precisa deles.
 *
 * A Task 6 confere de novo no servidor, na criação do pedido: esta rota
 * informa, não decide.
 */
describe("cotação de frete pública", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("cota o frete pelo bairro, sem precisar de sessão", async () => {
    const restaurant = await createRestaurant(app, { slug: "cota" });
    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { deliveryFeeMode: "neighborhood" },
    });
    // o endereço de teste (`validDeliveryAddress`) tem o bairro "Consolação" —
    // é ele que precisa estar na lista atendida para a cotação bater
    await setDeliveryNeighborhoods(app, restaurant, [
      { name: validDeliveryAddress.neighborhood, feeInCents: 500 },
    ]);

    // sem headers: a rota é pública, como o cardápio
    const response = await app.inject({
      method: "POST",
      url: "/menu/cota/delivery-quote",
      payload: { address: validDeliveryAddress, subtotalInCents: 3000 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ deliversTo: true, isFree: false });
  });

  it("devolve a lista de bairros atendidos, para a tela oferecer seletor", async () => {
    const restaurant = await createRestaurant(app, { slug: "cota-lista" });
    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { deliveryFeeMode: "neighborhood" },
    });
    await setDeliveryNeighborhoods(app, restaurant, [
      { name: "Centro", feeInCents: 500 },
      { name: "Jardim América", feeInCents: 900 },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/menu/cota-lista/delivery-quote",
      // bairro não atendido: o que importa aqui é a lista, não o resultado
      payload: { address: validDeliveryAddress, subtotalInCents: 1000 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().servedNeighborhoods).toEqual(["Centro", "Jardim América"]);
  });

  it("no modo taxa fixa, não busca nem devolve bairro nenhum", async () => {
    const restaurant = await createRestaurant(app, { slug: "cota-fixa" });
    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { deliveryFeeMode: "fixed", deliveryFixedFeeInCents: 700 },
    });

    const response = await app.inject({
      method: "POST",
      url: "/menu/cota-fixa/delivery-quote",
      payload: { address: validDeliveryAddress, subtotalInCents: 1000 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      deliversTo: true,
      feeInCents: 700,
      isFree: false,
      toArrange: false,
      servedNeighborhoods: [],
    });
  });

  it("bairro não atendido responde deliversTo: false", async () => {
    const restaurant = await createRestaurant(app, { slug: "cota-fora" });
    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { deliveryFeeMode: "neighborhood" },
    });
    // "Centro" nunca é o bairro de `validDeliveryAddress` — serve exatamente
    // para exercitar o endereço não atendido
    await setDeliveryNeighborhoods(app, restaurant, [
      { name: "Centro", feeInCents: 500 },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/menu/cota-fora/delivery-quote",
      payload: { address: validDeliveryAddress, subtotalInCents: 1000 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      deliversTo: false,
      feeInCents: null,
      isFree: false,
      toArrange: false,
    });
  });

  it("slug que não existe responde 404", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/menu/nao-existe/delivery-quote",
      payload: { address: validDeliveryAddress, subtotalInCents: 1000 },
    });

    expect(response.statusCode).toBe(404);
  });

  it("não devolve nada além do que a cotação precisa", async () => {
    const restaurant = await createRestaurant(app, { slug: "cota-schema" });
    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { deliveryFeeMode: "neighborhood" },
    });
    await setDeliveryNeighborhoods(app, restaurant, [
      { name: validDeliveryAddress.neighborhood, feeInCents: 500 },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/menu/cota-schema/delivery-quote",
      payload: { address: validDeliveryAddress, subtotalInCents: 3000 },
    });

    // a resposta é superfície pública: o schema decide o que sai (S10)
    const corpo = response.json();
    expect(Object.keys(corpo).sort()).toEqual(
      ["deliversTo", "feeInCents", "isFree", "servedNeighborhoods", "toArrange"].sort(),
    );
  });

  /**
   * O frete cotado aqui é só informativo — Task 6 confere de novo na criação
   * do pedido, dentro da transação, e é o valor dessa segunda cotação que fica
   * congelado em `order.deliveryFeeInCents`.
   *
   * ⚠️ Estes testes tocam CINCO superfícies de leitura (criação, detalhe,
   * listagem, recibo do cliente e o openapi.json), e a PR anterior (grupos de
   * opções) esqueceu exatamente uma delas — o `trackedOrderResponseSchema` de
   * `routes/tracking.ts`, que é separado do schema de detalhe/listagem. Os
   * testes de recibo abaixo existem para não deixar isso se repetir.
   */
  describe("o frete no pedido", () => {
    /** Restaurante em modo bairro, com o bairro do endereço-fixture atendido a R$ 5,00. */
    async function lojaComFreteDeBairro(slugPrefix: string) {
      const restaurant = await createRestaurant(app, { slug: slugPrefix });
      await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
        payload: { deliveryFeeMode: "neighborhood" },
      });
      // ⚠️ registra o bairro que a fixture REALMENTE carrega — nunca um nome
      // fixo tipo "Centro" — senão o pedido cairia em "não entrega" (409).
      await setDeliveryNeighborhoods(app, restaurant, [
        { name: validDeliveryAddress.neighborhood, feeInCents: 500 },
      ]);
      return restaurant;
    }

    /** Um pedido de entrega, pronto para receber os overrides do teste. */
    function criarPedidoEntrega(
      restaurant: TestRestaurant,
      produto: { id: string },
      overrides: Record<string, unknown> = {},
    ) {
      return app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: {
          type: "delivery",
          customer: validCustomerBody,
          items: [{ productId: produto.id, quantity: 1 }],
          deliveryAddress: validDeliveryAddress,
          paymentMethod: "cash",
          ...overrides,
        },
      });
    }

    it("soma o frete no total e guarda o valor congelado", async () => {
      const restaurant = await lojaComFreteDeBairro("frete-soma");
      const produto = await createProduct(app, restaurant, { priceInCents: 3000 });

      const response = await criarPedidoEntrega(restaurant, produto, {
        items: [{ productId: produto.id, quantity: 2 }],
      });

      expect(response.statusCode).toBe(201);
      const corpo = response.json();
      expect(corpo.deliveryFeeInCents).toBe(500);
      // 2 x 3000 + 500
      expect(corpo.totalInCents).toBe(6500);
      const soma = corpo.items.reduce(
        (s: number, i: { unitPriceInCents: number; quantity: number }) =>
          s + i.unitPriceInCents * i.quantity,
        0,
      );
      expect(soma + corpo.deliveryFeeInCents).toBe(corpo.totalInCents);
    });

    it("recusa com 409 quando a loja não entrega naquele endereço", async () => {
      const restaurant = await createRestaurant(app, { slug: "frete-fora" });
      await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
        payload: { deliveryFeeMode: "neighborhood" },
      });
      // lista só com um bairro que NÃO é o de `validDeliveryAddress`, e
      // `deliveryFeeToArrange` continua `false` (o default) — não há como
      // determinar a taxa, e sem "a combinar" isso é recusa
      await setDeliveryNeighborhoods(app, restaurant, [
        { name: "Centro", feeInCents: 500 },
      ]);
      const produto = await createProduct(app, restaurant);

      const response = await criarPedidoEntrega(restaurant, produto);

      expect(response.statusCode).toBe(409);
    });

    it("aceita com frete nulo quando a loja escolheu 'a combinar'", async () => {
      const restaurant = await createRestaurant(app, { slug: "frete-combinar" });
      await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
        payload: { deliveryFeeMode: "neighborhood", deliveryFeeToArrange: true },
      });
      // nenhum bairro cadastrado: a cotação não consegue determinar a taxa, e
      // o "a combinar" aceita mesmo assim, sem frete
      const produto = await createProduct(app, restaurant, { priceInCents: 6000 });

      const response = await criarPedidoEntrega(restaurant, produto);

      expect(response.statusCode).toBe(201);
      expect(response.json().deliveryFeeInCents).toBeNull();
      // o total é só os itens: não há frete para somar
      expect(response.json().totalInCents).toBe(6000);
    });

    it("pedido que não é entrega não tem frete", async () => {
      const restaurant = await createRestaurant(app, { slug: "frete-takeaway" });
      const produto = await createProduct(app, restaurant);

      const order = await createOrder(
        app,
        restaurant.id,
        [{ productId: produto.id, quantity: 1 }],
        { type: "takeaway" },
      );

      expect(order.deliveryFeeInCents).toBeNull();
    });

    it("o troco é conferido contra o total COM frete", async () => {
      const restaurant = await lojaComFreteDeBairro("frete-troco");
      const produto = await createProduct(app, restaurant, { priceInCents: 3000 });

      // itens 3000 + frete 500 = 3500; troco de 3200 não cobre
      const response = await criarPedidoEntrega(restaurant, produto, {
        changeForInCents: 3200,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain("3500");
    });

    it("ignora um frete mandado no corpo", async () => {
      const restaurant = await lojaComFreteDeBairro("frete-ignora");
      const produto = await createProduct(app, restaurant);

      // mesmo raciocínio do totalInCents: quem paga não escolhe o preço
      const response = await criarPedidoEntrega(restaurant, produto, {
        deliveryFeeInCents: 1,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().deliveryFeeInCents).toBe(500);
    });

    it("o recibo do cliente fecha com o próprio total", async () => {
      const restaurant = await lojaComFreteDeBairro("frete-recibo");
      const produto = await createProduct(app, restaurant, { priceInCents: 3000 });

      const criado = (await criarPedidoEntrega(restaurant, produto)).json();
      expect(criado.deliveryFeeInCents).toBe(500);

      // GET /orders/:id?token= — a superfície que quebrou da última vez
      const recibo = await app.inject({
        method: "GET",
        url: `/orders/${criado.id}?token=${encodeURIComponent(criado.trackingToken)}`,
      });

      expect(recibo.statusCode).toBe(200);
      const corpo = recibo.json();
      const soma = corpo.items.reduce(
        (s: number, i: { unitPriceInCents: number; quantity: number }) =>
          s + i.unitPriceInCents * i.quantity,
        0,
      );
      expect(soma + (corpo.deliveryFeeInCents ?? 0)).toBe(corpo.totalInCents);
    });

    it("a listagem do restaurante mostra o frete", async () => {
      const restaurant = await lojaComFreteDeBairro("frete-lista");
      const produto = await createProduct(app, restaurant, { priceInCents: 3000 });
      await criarPedidoEntrega(restaurant, produto);

      const lista = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/orders`,
        headers: restaurant.headers,
      });

      expect(lista.statusCode).toBe(200);
      expect(lista.json().data[0].deliveryFeeInCents).toBe(500);
    });
  });
});
