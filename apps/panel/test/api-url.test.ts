import { describe, expect, it } from "vitest";
import { apiBaseUrl } from "../src/api/client.ts";

// primeiro deploy do app: endereço da API com barra no fim virou "//rota", que
// não bate com rota nenhuma e sai 401 — o painel leria isso como sessão expirada
describe("apiBaseUrl", () => {
  it("tira a barra do fim e os espaços", () => {
    expect(apiBaseUrl("https://api.exemplo.dev/")).toBe("https://api.exemplo.dev");
    expect(apiBaseUrl(" https://api.exemplo.dev// ")).toBe("https://api.exemplo.dev");
  });

  it("sem valor, usa o proxy do dev", () => {
    expect(apiBaseUrl(undefined)).toBe("/api");
    expect(apiBaseUrl("")).toBe("/api");
  });
});
