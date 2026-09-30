// apps/api/test/menu-neighborhoods.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createRestaurant, setDeliveryNeighborhoods } from "./helpers.ts";

describe("cardápio público: bairros atendidos e endereço da loja", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("no modo por bairro, só os nomes — nunca os valores", async () => {
    const r = await createRestaurant(app, { isDelivery: true });
    await setDeliveryNeighborhoods(app, r, [
      { name: "Jardins", feeInCents: 0 },
      { name: "Centro", feeInCents: 900 },
    ]);
    await app.inject({ method: "PATCH", url: `/restaurants/${r.id}`, headers: r.headers, payload: { deliveryFeeMode: "neighborhood" } });
    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu.deliveryNeighborhoods).toEqual(["Centro", "Jardins"]);
    expect(JSON.stringify(menu)).not.toContain("feeInCents");
  });

  it("fora do modo por bairro, a lista vem vazia", async () => {
    const r = await createRestaurant(app, { isDelivery: true });
    await setDeliveryNeighborhoods(app, r, [{ name: "Centro", feeInCents: 900 }]);
    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu.deliveryNeighborhoods).toEqual([]);
  });

  // a retirada precisa dizer onde buscar
  it("traz o endereço da loja", async () => {
    const r = await createRestaurant(app);
    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu.address).toMatchObject({ street: expect.any(String), number: expect.any(String), city: expect.any(String) });
  });
});
