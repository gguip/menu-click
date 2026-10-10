import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createRestaurant } from "./helpers.ts";

describe("link do cardápio no detalhe do restaurante", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("o GET traz a URL do cardápio, montada pelo servidor", async () => {
    const r = await createRestaurant(app);
    const res = await app.inject({ method: "GET", url: `/restaurants/${r.id}`, headers: r.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().menuUrl).toBe(`http://localhost:5173/${r.slug}`);
  });

  it("o cardápio público não repete a própria URL", async () => {
    const r = await createRestaurant(app);
    const res = await app.inject({ method: "GET", url: `/menu/${r.slug}` });
    expect(res.json().menuUrl).toBeUndefined();
  });
});
