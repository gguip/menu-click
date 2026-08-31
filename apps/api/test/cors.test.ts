import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers.ts";

const ORIGEM_AUTORIZADA = "https://app.exemplo.test";
const ORIGEM_QUALQUER = "https://site-aleatorio.test";

/**
 * CORS com allowlist configurada.
 *
 * O caso do default (sem `CORS_ORIGINS`) fica em `cors-fechado.test.ts`: o
 * `pool` do banco é singleton e o `onClose` do app o encerra, então duas
 * instâncias de `buildApp()` no mesmo arquivo não sobrevivem uma à outra.
 * Arquivos diferentes rodam em contextos de módulo diferentes.
 *
 * Dois comportamentos precisam de prova: a allowlist realmente exclui quem não
 * está nela, e o **preflight de rota protegida não é 401**. O segundo é o que
 * mais dói na prática: o `OPTIONS` que o navegador manda antes de uma
 * requisição com `Authorization` não carrega o `Authorization` (ele é anônimo
 * por definição), então o hook de negação por padrão o rejeitaria — e o
 * navegador reportaria "erro de CORS", apontando para o lugar errado.
 */
describe("CORS", () => {
  describe("com origens configuradas", () => {
    let app: FastifyInstance;
    const anterior = process.env.CORS_ORIGINS;

    beforeAll(async () => {
      process.env.CORS_ORIGINS = `${ORIGEM_AUTORIZADA}, https://outra.test`;
      app = await buildTestApp();
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      process.env.CORS_ORIGINS = anterior;
    });

    it("libera a origem que está na lista", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: ORIGEM_AUTORIZADA },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe(
        ORIGEM_AUTORIZADA,
      );
    });

    it("não libera origem fora da lista", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: ORIGEM_QUALQUER },
      });

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    /**
     * O teste que justifica o CORS ser registrado antes do `installAuth()`.
     */
    it("o preflight de rota PROTEGIDA não é 401", async () => {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/restaurants",
        headers: {
          origin: ORIGEM_AUTORIZADA,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      });

      expect(response.statusCode).not.toBe(401);
      expect(response.headers["access-control-allow-origin"]).toBe(
        ORIGEM_AUTORIZADA,
      );
    });

    it("o preflight anuncia o header Authorization", async () => {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/restaurants",
        headers: {
          origin: ORIGEM_AUTORIZADA,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      });

      expect(
        String(response.headers["access-control-allow-headers"]).toLowerCase(),
      ).toContain("authorization");
    });

    it("não anuncia credenciais: a API usa header, não cookie", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: ORIGEM_AUTORIZADA },
      });

      expect(
        response.headers["access-control-allow-credentials"],
      ).toBeUndefined();
    });
  });
});
