import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiRequest,
  describeError,
  NetworkError,
  onUnauthorized,
} from "../src/api/client.ts";
import { readSession, saveSession } from "../src/api/session.ts";
import { mockApi } from "./api-mock.ts";

function signIn() {
  saveSession({ token: "tok", expiresAt: "2099-01-01T00:00:00.000Z" });
}

describe("apiRequest", () => {
  it("manda o Bearer quando há sessão, e o caminho vai com /api", async () => {
    signIn();
    const api = mockApi([{ method: "GET", path: "/auth/me", body: { id: "u1" } }]);
    await expect(apiRequest("/auth/me")).resolves.toEqual({ id: "u1" });
    expect(api.calls[0].headers.Authorization).toBe("Bearer tok");
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url.startsWith("/api/auth/me")).toBe(true);
  });

  it("sem corpo, não declara Content-Type (o Fastify recusa JSON vazio)", async () => {
    signIn();
    const api = mockApi([{ method: "POST", path: "/auth/logout", status: 204 }]);
    await expect(apiRequest("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
    expect(api.calls[0].headers["Content-Type"]).toBeUndefined();
    expect(api.calls[0].body).toBeUndefined();
  });

  it("com corpo, manda JSON", async () => {
    const api = mockApi([{ method: "POST", path: "/auth/login", body: { token: "t" } }]);
    await apiRequest("/auth/login", { method: "POST", body: { email: "a@b.c" }, auth: false });
    expect(api.calls[0].headers["Content-Type"]).toBe("application/json");
    expect(api.calls[0].body).toEqual({ email: "a@b.c" });
  });

  it("monta a querystring pulando o que é vazio", async () => {
    const api = mockApi([{ method: "GET", path: "/x", body: {} }]);
    await apiRequest("/x", { query: { a: "1", b: undefined, c: "", d: 2 } });
    expect(api.calls[0].query).toEqual({ a: "1", d: "2" });
  });

  it("erro vira ApiError com a mensagem da API e o Retry-After", async () => {
    mockApi([
      {
        method: "POST",
        path: "/auth/resend-verification",
        status: 429,
        body: { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded" },
        headers: { "retry-after": "38" },
      },
    ]);
    const error = await apiRequest<never>("/auth/resend-verification", { method: "POST" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(38);
  });

  it("401 com sessão limpa a sessão e avisa quem escuta", async () => {
    signIn();
    const handler = vi.fn();
    onUnauthorized(handler);
    mockApi([{ method: "GET", path: "/auth/me", status: 401, body: { message: "Sessão inválida ou expirada" } }]);
    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(readSession()).toBeNull();
    expect(handler).toHaveBeenCalledOnce();
    onUnauthorized(null);
  });

  it("401 sem sessão (login errado) não é sessão expirada", async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    mockApi([{ method: "POST", path: "/auth/login", status: 401, body: { message: "E-mail ou senha inválidos" } }]);
    await expect(
      apiRequest("/auth/login", { method: "POST", body: {}, auth: false }),
    ).rejects.toMatchObject({ status: 401, message: "E-mail ou senha inválidos" });
    expect(handler).not.toHaveBeenCalled();
    onUnauthorized(null);
  });

  it("falha de rede vira NetworkError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("describeError", () => {
  it("traduz 429 e rede para quem está no balcão", () => {
    expect(describeError(new ApiError(429, "Rate limit exceeded", 30))).toBe(
      "Muitas tentativas seguidas. Aguarde um instante e tente de novo.",
    );
    expect(describeError(new NetworkError())).toBe(
      "Sem conexão com o servidor. Confira a internet e tente de novo.",
    );
    expect(describeError(new ApiError(409, "Já existe uma categoria chamada \"Bebidas\"", null))).toBe(
      "Já existe uma categoria chamada \"Bebidas\"",
    );
  });
});
