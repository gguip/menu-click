import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers.ts";

/**
 * CORS no default: `CORS_ORIGINS` ausente.
 *
 * Arquivo separado do `cors.test.ts` porque cada um precisa da sua instância
 * de `buildApp()` com env diferente, e o `pool` é singleton — o `onClose` do
 * primeiro app encerraria o pool do segundo.
 *
 * O comportamento aqui é o mais importante dos dois: **falhar fechado**. Um
 * esquecimento de configuração quebra o front de forma visível, em vez de
 * abrir a API para qualquer site — que é um problema sem sintoma nenhum.
 */
describe("CORS sem CORS_ORIGINS", () => {
  let app: FastifyInstance;
  const anterior = process.env.CORS_ORIGINS;

  beforeAll(async () => {
    delete process.env.CORS_ORIGINS;
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (anterior !== undefined) process.env.CORS_ORIGINS = anterior;
  });

  it("nenhuma origem cruzada é liberada", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://qualquer-site.test" },
    });

    // a requisição em si responde: CORS é decidido pelo NAVEGADOR, a partir dos
    // headers. O que não vem é a autorização para ele entregar a resposta.
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("o preflight também não autoriza ninguém", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/restaurants",
      headers: {
        origin: "https://qualquer-site.test",
        "access-control-request-method": "GET",
      },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
