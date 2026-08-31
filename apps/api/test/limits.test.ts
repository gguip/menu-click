import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { validRestaurantBody, validUserBody } from "./helpers.ts";

/**
 * Limites de corpo e de conexão.
 *
 * São defaults do Fastify que passaram a ser decisão explícita (F27/S16). O
 * teste existe menos para provar que o Fastify funciona e mais para o número
 * não voltar ao default sem alguém perceber.
 */
describe("limites de exposição", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("413 com corpo acima do bodyLimit", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        restaurant: {
          ...validRestaurantBody,
          // 200 KB só neste campo, acima dos 128 KB de teto
          name: "R".repeat(200 * 1024),
        },
        user: validUserBody,
      },
    });

    expect(response.statusCode).toBe(413);
  });

  it("um cadastro normal passa folgado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { restaurant: validRestaurantBody, user: validUserBody },
    });

    expect(response.statusCode).toBe(201);
  });
});
