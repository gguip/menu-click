import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers.ts";

/**
 * O documento OpenAPI.
 *
 * Nada aqui verifica o conteúdo dos schemas — eles são os mesmos que validam as
 * requisições, e já têm teste próprio em cada arquivo. O que estes testes
 * protegem é o que o gerador NÃO garante sozinho:
 *
 *  1. o `openapi.json` versionado não fica para trás do código;
 *  2. rota nova não entra sem descrição;
 *  3. a marcação de "exige sessão" continua batendo com a realidade.
 */

const ARQUIVO = fileURLToPath(new URL("../openapi.json", import.meta.url));

/** As mesmas de `authorization.test.ts`, escritas de novo de propósito. */
const OPERACOES_PUBLICAS = new Set([
  "GET /health",
  "GET /menu/{slug}",
  "GET /menu/{slug}/products",
  "POST /auth/register",
  "POST /auth/login",
  "POST /restaurants/{restaurantId}/orders",
  // a leitura do pedido pelo token: quem pediu não tem conta, e quem autoriza
  // é o token devolvido na criação — não a sessão
  "GET /orders/{orderId}",
]);

type Operacao = {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  security?: unknown[];
};

describe("OpenAPI", () => {
  let app: FastifyInstance;
  let documento: { paths: Record<string, Record<string, Operacao>>; tags?: { name: string }[] };

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
    documento = (app as unknown as { swagger: () => typeof documento }).swagger();
  });

  afterAll(async () => {
    await app.close();
  });

  function operacoes(): [string, Operacao][] {
    return Object.entries(documento.paths).flatMap(([caminho, metodos]) =>
      Object.entries(metodos).map(
        ([metodo, op]) => [`${metodo.toUpperCase()} ${caminho}`, op] as [string, Operacao],
      ),
    );
  }

  it("serve o documento em /docs/json sem exigir sessão", async () => {
    const response = await app.inject({ method: "GET", url: "/docs/json" });

    expect(response.statusCode).toBe(200);
    expect(response.json().openapi).toMatch(/^3\./);
  });

  /**
   * O arquivo é gerado, nunca editado à mão. Este teste é o que impede que ele
   * vire ficção: mudar um schema sem regerar quebra aqui, e não meses depois
   * quando alguém confiar no documento.
   */
  it("o openapi.json versionado está em dia com o código", async () => {
    const versionado = JSON.parse(await readFile(ARQUIVO, "utf8"));

    expect(
      versionado,
      "openapi.json desatualizado — rode `pnpm --filter @menuclick/api openapi:generate`",
    ).toEqual(documento);
  });

  it("toda operação tem tag, summary, description e operationId", () => {
    for (const [nome, op] of operacoes()) {
      expect(op.tags?.length, `${nome} sem tag`).toBeGreaterThan(0);
      expect(op.summary, `${nome} sem summary`).toBeTruthy();
      expect(op.description, `${nome} sem description`).toBeTruthy();
      expect(op.operationId, `${nome} sem operationId`).toBeTruthy();
    }
  });

  it("os operationId são únicos (é deles que o front gera os nomes)", () => {
    const ids = operacoes().map(([, op]) => op.operationId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("toda tag usada está declarada no topo do documento", () => {
    const declaradas = new Set((documento.tags ?? []).map((t) => t.name));

    for (const [nome, op] of operacoes()) {
      for (const tag of op.tags ?? []) {
        expect(declaradas, `${nome} usa a tag "${tag}", que não foi declarada`)
          .toContain(tag);
      }
    }
  });

  /**
   * A marcação de segurança é derivada do `config.public` das rotas, então ela
   * não pode divergir do comportamento. O que pode divergir é a INTENÇÃO: este
   * teste repete a lista de públicas à mão justamente para que abrir uma rota
   * por engano apareça aqui, e não só no `authorization.test.ts`.
   */
  it("as operações públicas do documento são exatamente as esperadas", () => {
    const publicas = operacoes()
      .filter(([, op]) => Array.isArray(op.security) && op.security.length === 0)
      .map(([nome]) => nome);

    expect(new Set(publicas)).toEqual(OPERACOES_PUBLICAS);
  });

  it("as demais exigem bearerAuth", () => {
    for (const [nome, op] of operacoes()) {
      if (OPERACOES_PUBLICAS.has(nome)) continue;
      expect(op.security, `${nome} deveria exigir bearerAuth`).toEqual([
        { bearerAuth: [] },
      ]);
    }
  });
});
