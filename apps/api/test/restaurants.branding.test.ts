import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createRestaurant, type TestRestaurant } from "./helpers.ts";

describe("capa e cor da marca", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const patch = (r: TestRestaurant, payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: `/restaurants/${r.id}`, headers: r.headers, payload });

  it("salva e sai no cardápio público", async () => {
    const r = await createRestaurant(app);
    const res = await patch(r, { coverUrl: "https://example.com/capa.jpg", brandColor: "#0B7A48" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ coverUrl: "https://example.com/capa.jpg", brandColor: "#0B7A48" });
    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu).toMatchObject({ coverUrl: "https://example.com/capa.jpg", brandColor: "#0B7A48" });
  });

  it("null tira os dois", async () => {
    const r = await createRestaurant(app);
    await patch(r, { coverUrl: "https://example.com/capa.jpg", brandColor: "#0B7A48" });
    const res = await patch(r, { coverUrl: null, brandColor: null });
    expect(res.json().coverUrl).toBeUndefined();
    expect(res.json().brandColor).toBeUndefined();
  });

  it("cor sem contraste com o branco é 400, com a razão na mensagem", async () => {
    const r = await createRestaurant(app);
    const res = await patch(r, { brandColor: "#F5C518" });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/contraste/i);
  });

  it("formato fora de #RRGGBB é 400", async () => {
    const r = await createRestaurant(app);
    expect((await patch(r, { brandColor: "blue" })).statusCode).toBe(400);
    expect((await patch(r, { brandColor: "#12345" })).statusCode).toBe(400);
  });
});
