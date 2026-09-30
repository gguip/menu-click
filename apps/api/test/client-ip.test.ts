// apps/api/test/client-ip.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOGIN_RATE_LIMIT_MAX, parseClientIpHeader } from "../src/limits.ts";
import { buildTestApp } from "./helpers.ts";

/**
 * No Render, o `X-Forwarded-For` chega como "cliente, borda do Cloudflare,
 * interno do Render" com o interno mudando a cada requisição: nem
 * `trustProxy` ligado nem um número de saltos dão a chave certa. O Cloudflare
 * sobrescreve o `CF-Connecting-IP` na borda — é ele a chave do limite.
 */
describe("IP do cliente pelo header do proxy", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip";
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    delete process.env.CLIENT_IP_HEADER;
    await app.close();
  });

  const login = (headers: Record<string, string>, remoteAddress: string) =>
    app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress,
      headers,
      payload: { email: "ninguem@exemplo.com", password: "senha-errada-123" },
    });

  it("o mesmo header vindo de endereços diferentes conta como um cliente só", async () => {
    const codes: number[] = [];
    for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
      codes.push((await login({ "cf-connecting-ip": "203.0.113.7" }, `10.0.0.${i + 1}`)).statusCode);
    }
    expect(codes.at(-1)).toBe(429);
  });

  it("headers diferentes contam separado", async () => {
    const codes: number[] = [];
    for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
      codes.push((await login({ "cf-connecting-ip": `198.51.100.${i + 1}` }, "10.0.1.1")).statusCode);
    }
    expect(codes).not.toContain(429);
  });

  it("sem o header na requisição, vale o endereço de sempre", async () => {
    const codes: number[] = [];
    for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
      codes.push((await login({}, "192.0.2.50")).statusCode);
    }
    expect(codes.at(-1)).toBe(429);
  });

  // um describe de topo só por arquivo: o app.close() fecha o pool singleton
  describe("CLIENT_IP_HEADER", () => {
    it("vazio ou ausente é desligado; o nome vai para minúsculas", () => {
      expect(parseClientIpHeader(undefined)).toBeNull();
      expect(parseClientIpHeader("  ")).toBeNull();
      expect(parseClientIpHeader("CF-Connecting-IP")).toBe("cf-connecting-ip");
    });

    it("nome inválido derruba a subida", () => {
      expect(() => parseClientIpHeader("cf connecting ip")).toThrow(/CLIENT_IP_HEADER/);
      expect(() => parseClientIpHeader("x-ip:1")).toThrow(/CLIENT_IP_HEADER/);
    });
  });
});
