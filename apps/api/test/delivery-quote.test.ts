import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createRestaurant,
  setDeliveryNeighborhoods,
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
});
