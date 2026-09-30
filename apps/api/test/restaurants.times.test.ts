// apps/api/test/restaurants.times.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createRestaurant } from "./helpers.ts";

describe("tempos estimados da loja", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function patch(payload: Record<string, unknown>) {
    const r = await createRestaurant(app);
    const res = await app.inject({ method: "PATCH", url: `/restaurants/${r.id}`, headers: r.headers, payload });
    return { r, res };
  }

  it("grava preparo e faixa de entrega, e devolve no restaurante", async () => {
    const { res } = await patch({ prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 });
  });

  it("null desliga: a chave some da resposta", async () => {
    const { r } = await patch({ prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 });
    const res = await app.inject({
      method: "PATCH",
      url: `/restaurants/${r.id}`,
      headers: r.headers,
      payload: { prepTimeMinutes: null, deliveryTimeMinMinutes: null, deliveryTimeMaxMinutes: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty("prepTimeMinutes");
    expect(res.json()).not.toHaveProperty("deliveryTimeMinMinutes");
  });

  it("recusa fora de 1–240, mínimo maior que máximo, e só um dos dois de entrega", async () => {
    expect((await patch({ prepTimeMinutes: 0 })).res.statusCode).toBe(400);
    expect((await patch({ prepTimeMinutes: 241 })).res.statusCode).toBe(400);
    expect((await patch({ deliveryTimeMinMinutes: 60, deliveryTimeMaxMinutes: 40 })).res.statusCode).toBe(400);
    expect((await patch({ deliveryTimeMinMinutes: 40 })).res.statusCode).toBe(400);
    expect((await patch({ deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: null })).res.statusCode).toBe(400);
  });

  it("não sai no cardápio público", async () => {
    const { r } = await patch({ prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 });
    const menu = await app.inject({ method: "GET", url: `/menu/${r.slug}` });
    expect(menu.json()).not.toHaveProperty("prepTimeMinutes");
    expect(menu.json()).not.toHaveProperty("deliveryTimeMinMinutes");
  });
});
