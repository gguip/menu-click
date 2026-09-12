import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestRestaurant } from "./helpers.ts";
import {
  buildTestApp,
  createOrder,
  createProduct,
  createRestaurant,
} from "./helpers.ts";

/**
 * E2E adversarial da taxa de entrega.
 *
 * O objetivo deste arquivo não é repetir o que as unidades já garantem (a
 * fórmula em `domain/delivery.ts`, o CRUD de bairros, o schema da rota) — é
 * andar o caminho inteiro como loja e como cliente, e comparar os NÚMEROS que
 * cada superfície devolve entre si. Duas vezes neste projeto um defeito
 * sobreviveu a toda revisão por task e só apareceu aqui: um recibo cujos itens
 * não fechavam com o próprio total.
 *
 * O caminho: a loja configura o frete (modo bairro, com "grátis acima de X"),
 * o cliente cota um endereço atendido e um não atendido, cria o pedido, e o
 * pedido é relido de QUATRO superfícies diferentes — a listagem de gestão, o
 * detalhe de gestão, o gêmeo HTTP do acompanhamento e o próprio WebSocket —
 * comparando `totalInCents`/`deliveryFeeInCents`/a soma dos itens entre elas.
 */
describe("e2e: taxa de entrega", () => {
  let app: FastifyInstance;
  let wsBase: string;

  beforeAll(async () => {
    app = await buildTestApp();
    // porta efêmera: só o WebSocket precisa de socket de verdade (F21 não se
    // aplica a ele — `inject` não faz upgrade de protocolo)
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    wsBase = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Atualiza a configuração de frete da loja via PATCH. */
  function configureDeliveryFee(
    restaurant: TestRestaurant,
    config: Record<string, unknown>,
  ) {
    return app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: config,
    });
  }

  /** Define a lista de bairros atendidos e o preço de cada um. */
  function setNeighborhoods(
    restaurant: TestRestaurant,
    neighborhoods: { name: string; feeInCents: number }[],
  ) {
    return app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
      payload: { neighborhoods },
    });
  }

  function quote(slug: string, address: Record<string, unknown>, subtotalInCents: number) {
    return app.inject({
      method: "POST",
      url: `/menu/${slug}/delivery-quote`,
      payload: { address, subtotalInCents },
    });
  }

  /**
   * Conecta no canal de acompanhamento e devolve só a primeira mensagem — o
   * `snapshot`. O listener é registrado ANTES do `open` (na própria
   * construção do `WebSocket`), então não há corrida com o servidor mandando
   * o snapshot assim que o handshake termina.
   */
  function receiveSnapshot(
    orderId: string,
    token: string,
  ): Promise<{ type: string; order: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(
        `${wsBase}/orders/${orderId}/track?token=${encodeURIComponent(token)}`,
      );
      socket.once("message", (raw) => {
        const mensagem = JSON.parse(String(raw));
        socket.close();
        resolve(mensagem);
      });
      socket.once("unexpected-response", (_req, res) =>
        reject(new Error(`upgrade recusado com ${res.statusCode}`)),
      );
      socket.once("error", reject);
    });
  }

  it("o frete anda o caminho inteiro sem discordância entre superfícies", async () => {
    // ---- 1. A LOJA configura o frete: modo bairro, dois bairros, com
    // "grátis acima de R$ 50" ----
    const restaurant = await createRestaurant(app, { slug: "e2e-frete" });

    const patchResponse = await configureDeliveryFee(restaurant, {
      deliveryFeeMode: "neighborhood",
      freeDeliveryAboveInCents: 5000,
    });
    expect(patchResponse.statusCode).toBe(200);

    const neighborhoodsResponse = await setNeighborhoods(restaurant, [
      { name: "Consolação", feeInCents: 900 },
      { name: "Pinheiros", feeInCents: 700 },
    ]);
    expect(neighborhoodsResponse.statusCode).toBe(200);

    const product = await createProduct(app, restaurant, {
      name: "Combo Executivo",
      priceInCents: 3000,
      stock: 50,
    });

    const consolacaoAddress = {
      street: "Rua Augusta",
      number: "1500",
      neighborhood: "Consolação",
      city: "São Paulo",
      state: "SP",
      zipCode: "01304-001",
    };
    const unservedAddress = {
      street: "Rua Sem Cadastro",
      number: "1",
      neighborhood: "Bairro Fantasma",
      city: "São Paulo",
      state: "SP",
      zipCode: "00000-000",
    };

    // ---- 2. O CARDÁPIO PÚBLICO anuncia o modo e o limite de frete grátis,
    // ANTES de qualquer carrinho existir — compara com o que a loja configurou
    // no passo 1, não só que o campo existe ----
    const menuResponse = await app.inject({
      method: "GET",
      url: `/menu/${restaurant.slug}`,
    });
    const menu = menuResponse.json();
    expect(menu.deliveryFeeMode).toBe("neighborhood");
    expect(menu.freeDeliveryAboveInCents).toBe(5000);
    // a configuração crua e o timezone não vazam para o cliente (S10)
    expect(menu.deliveryFixedFeeInCents).toBeUndefined();
    expect(menu.deliveryFeeToArrange).toBeUndefined();
    expect(menu.timezone).toBeUndefined();

    // ---- 3. O CLIENTE cota ANTES de montar o carrinho ----

    // 3a. Um endereço atendido, com subtotal ABAIXO do limite de frete grátis:
    // a cotação tem que devolver a taxa do bairro, sem desconto.
    const quoteBelowThreshold = await quote(
      restaurant.slug,
      consolacaoAddress,
      3000, // 1 unidade — abaixo dos 5000 de freeDeliveryAboveInCents
    );
    expect(quoteBelowThreshold.statusCode).toBe(200);
    const quoteBelowBody = quoteBelowThreshold.json();
    expect(quoteBelowBody).toMatchObject({
      deliversTo: true,
      feeInCents: 900,
      isFree: false,
      toArrange: false,
    });
    expect(quoteBelowBody.servedNeighborhoods.sort()).toEqual([
      "Consolação",
      "Pinheiros",
    ]);

    // 3b. O MESMO endereço, com subtotal NO limite (inclusivo): a promoção
    // zera a taxa — mas o pedido ainda existe (deliversTo continua true, e
    // feeInCents é 0, não null: "grátis" e "a combinar" são estados diferentes)
    const quoteAtThreshold = await quote(restaurant.slug, consolacaoAddress, 5000);
    expect(quoteAtThreshold.statusCode).toBe(200);
    expect(quoteAtThreshold.json()).toMatchObject({
      deliversTo: true,
      feeInCents: 0,
      isFree: true,
      toArrange: false,
    });

    // 3c. Um endereço em bairro NÃO cadastrado: a loja não entrega ali, e
    // "não atende" não é a mesma resposta de "grátis" nem de "a combinar"
    const quoteUnserved = await quote(restaurant.slug, unservedAddress, 3000);
    expect(quoteUnserved.statusCode).toBe(200);
    expect(quoteUnserved.json()).toMatchObject({
      deliversTo: false,
      feeInCents: null,
      isFree: false,
      toArrange: false,
    });

    // ---- 4. A CRIAÇÃO decide (não só informa) ----

    // 4a. Pedido de 1 unidade no bairro atendido: a cotação da criação tem que
    // bater com a cotação pública do passo 3a — é a mesma pergunta, feita duas
    // vezes, e a resposta não pode discordar de si mesma.
    const createResponse = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "delivery",
        customer: { name: "Ana Souza", phone: "11999990000" },
        items: [{ productId: product.id, quantity: 1 }],
        deliveryAddress: consolacaoAddress,
        paymentMethod: "pix",
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();

    // a taxa cobrada na criação é a MESMA que a cotação pública anunciou
    expect(created.deliveryFeeInCents).toBe(quoteBelowBody.feeInCents);
    expect(created.deliveryFeeInCents).toBe(900);

    // ⚠️ A invariante que mudou: Σ itens NÃO é mais o total em pedido de
    // entrega. Isto é o próprio ponto do e2e — se algum dia isto voltar a
    // bater por acidente (por exemplo por alguém "consertar" o total para
    // ficar igual à soma dos itens), o pedido passa a mentir sobre o frete.
    const itemsSum = created.items.reduce(
      (sum: number, item: { unitPriceInCents: number; quantity: number }) =>
        sum + item.unitPriceInCents * item.quantity,
      0,
    );
    expect(itemsSum).toBe(3000);
    expect(created.totalInCents).toBe(3900);
    expect(itemsSum).not.toBe(created.totalInCents);
    expect(itemsSum + created.deliveryFeeInCents).toBe(created.totalInCents);

    const { id: orderId, trackingToken } = created;
    expect(trackingToken).toEqual(expect.any(String));

    // 4b. O MESMO carrinho para o endereço não atendido é 409 — a criação
    // não aceita silenciosamente onde a cotação já disse que não entrega
    const rejectedResponse = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "delivery",
        customer: { name: "Ana Souza", phone: "11999990001" },
        items: [{ productId: product.id, quantity: 1 }],
        deliveryAddress: unservedAddress,
        paymentMethod: "pix",
      },
    });
    expect(rejectedResponse.statusCode).toBe(409);
    expect(rejectedResponse.json().message).toBe(
      "A loja não entrega neste endereço",
    );

    // 4c. Pedido de 2 unidades no MESMO bairro atinge o limite de frete
    // grátis: a mesma cotação de 3b, mas agora com dinheiro de verdade — e o
    // ponto fino é que "grátis acima de X" tem que comparar com o SUBTOTAL, e
    // aqui subtotal (6000) e total (6000, com fee 0) coincidem. O teste
    // seguinte (fora deste bloco) força os dois a DIVERGIREM para provar que
    // a comparação realmente é contra o subtotal.
    const freeOrderResponse = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "delivery",
        customer: { name: "Ana Souza", phone: "11999990002" },
        items: [{ productId: product.id, quantity: 2 }],
        deliveryAddress: consolacaoAddress,
        paymentMethod: "pix",
      },
    });
    expect(freeOrderResponse.statusCode).toBe(201);
    const freeOrder = freeOrderResponse.json();
    // 0 é grátis, e precisa ser DISTINGUÍVEL de null ("a combinar")
    expect(freeOrder.deliveryFeeInCents).toBe(0);
    expect(freeOrder.totalInCents).toBe(6000);

    // ---- 5. LER DE VOLTA o primeiro pedido (o de taxa 900) de QUATRO
    // superfícies diferentes, comparando os NÚMEROS entre si — não só a
    // presença dos campos ----

    // 5a. Listagem de gestão
    const listResponse = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders`,
      headers: restaurant.headers,
    });
    expect(listResponse.statusCode).toBe(200);
    const listed = listResponse
      .json()
      .data.find((order: { id: string }) => order.id === orderId);
    expect(listed).toBeDefined();

    // 5b. Detalhe de gestão (com os itens)
    const detailResponse = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders/${orderId}`,
      headers: restaurant.headers,
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = detailResponse.json();

    // 5c. O gêmeo HTTP do acompanhamento — pelo token, sem sessão
    const trackedResponse = await app.inject({
      method: "GET",
      url: `/orders/${orderId}?token=${encodeURIComponent(trackingToken)}`,
    });
    expect(trackedResponse.statusCode).toBe(200);
    const tracked = trackedResponse.json();

    // 5d. O WebSocket, de verdade (servidor real, cliente real — F21 não
    // cobre upgrade de protocolo)
    const snapshot = await receiveSnapshot(orderId, trackingToken);
    expect(snapshot.type).toBe("snapshot");

    // Os quatro concordam sobre o total — é o número que mais importa, porque
    // é o que o cliente paga e o que o painel soma no faturamento.
    expect(listed.totalInCents).toBe(created.totalInCents);
    expect(detail.totalInCents).toBe(created.totalInCents);
    expect(tracked.totalInCents).toBe(created.totalInCents);
    expect(snapshot.order.totalInCents).toBe(created.totalInCents);

    // As três que expõem `deliveryFeeInCents` (o WebSocket não — ele só
    // transmite id/type/status/totalInCents/updatedAt) concordam entre si
    expect(listed.deliveryFeeInCents).toBe(created.deliveryFeeInCents);
    expect(detail.deliveryFeeInCents).toBe(created.deliveryFeeInCents);
    expect(tracked.deliveryFeeInCents).toBe(created.deliveryFeeInCents);

    // E as duas que trazem os itens (detalhe de gestão e gêmeo do cliente)
    // fecham a MESMA conta que a criação: Σ itens + frete = total. Se
    // qualquer uma delas recalculasse o total a partir só dos itens (o bug
    // que este e2e existe para pegar), a comparação abaixo falharia.
    const detailItemsSum = detail.items.reduce(
      (sum: number, item: { unitPriceInCents: number; quantity: number }) =>
        sum + item.unitPriceInCents * item.quantity,
      0,
    );
    const trackedItemsSum = tracked.items.reduce(
      (sum: number, item: { unitPriceInCents: number; quantity: number }) =>
        sum + item.unitPriceInCents * item.quantity,
      0,
    );
    expect(detailItemsSum).toBe(itemsSum);
    expect(trackedItemsSum).toBe(itemsSum);
    expect(detailItemsSum + detail.deliveryFeeInCents).toBe(detail.totalInCents);
    expect(trackedItemsSum + tracked.deliveryFeeInCents).toBe(tracked.totalInCents);
  });

  it('"grátis acima de X" compara com o SUBTOTAL, nunca com o total', async () => {
    // Cenário desenhado para os dois discordarem: taxa fixa de R$ 10 e limite
    // de R$ 50. Um pedido de subtotal R$ 45 fica ABAIXO do limite — mas
    // subtotal + taxa (R$ 55) já estaria ACIMA. Se a comparação (por bug)
    // fosse contra o total, este pedido sairia de graça; contra o subtotal
    // (o certo), a taxa é cobrada normalmente.
    const restaurant = await createRestaurant(app, { slug: "e2e-frete-fixo" });
    await configureDeliveryFee(restaurant, {
      deliveryFeeMode: "fixed",
      deliveryFixedFeeInCents: 1000,
      freeDeliveryAboveInCents: 5000,
    });
    const product = await createProduct(app, restaurant, {
      name: "Prato Único",
      priceInCents: 4500,
      stock: 10,
    });

    const address = {
      street: "Rua Qualquer",
      number: "10",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01000-000",
    };

    const quoteResponse = await quote(restaurant.slug, address, 4500);
    expect(quoteResponse.statusCode).toBe(200);
    // se a comparação fosse contra o total (5500), isto sairia `isFree: true`
    expect(quoteResponse.json()).toMatchObject({
      deliversTo: true,
      feeInCents: 1000,
      isFree: false,
    });

    const orderResponse = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "delivery",
        customer: { name: "Ana Souza", phone: "11999990003" },
        items: [{ productId: product.id, quantity: 1 }],
        deliveryAddress: address,
        paymentMethod: "pix",
      },
    });
    expect(orderResponse.statusCode).toBe(201);
    const order = orderResponse.json();
    expect(order.deliveryFeeInCents).toBe(1000);
    expect(order.totalInCents).toBe(5500);
  });

  it("pedido sem endereço configurado (dine_in) não carrega frete nenhum", async () => {
    // Controle negativo: um pedido que não é delivery não deve ganhar
    // `deliveryFeeInCents` nenhum, nem por engano — nas outras duas
    // modalidades ele é sempre `null` (o `check` do banco recusaria qualquer
    // outro valor).
    const restaurant = await createRestaurant(app, { slug: "e2e-frete-mesa" });
    await configureDeliveryFee(restaurant, {
      deliveryFeeMode: "fixed",
      deliveryFixedFeeInCents: 1000,
    });
    const product = await createProduct(app, restaurant, { stock: 5 });

    const order = await createOrder(app, restaurant.id, [
      { productId: product.id, quantity: 1 },
    ]);

    expect(order.type).toBe("dine_in");
    expect(order.deliveryFeeInCents).toBeNull();
    expect(order.totalInCents).toBe(order.items[0].unitPriceInCents);
  });
});
