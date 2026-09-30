import { describe, expect, it } from "vitest";
import { apiBaseUrl } from "../src/lib/api.ts";

// primeiro deploy: NEXT_PUBLIC_API_URL com barra no fim virou "//menu/…", que
// não bate com rota nenhuma — a API respondeu 401 e todo cardápio deu 500
describe("apiBaseUrl", () => {
  it("tira a barra do fim e os espaços", () => {
    expect(apiBaseUrl("https://api.exemplo.dev/")).toBe("https://api.exemplo.dev");
    expect(apiBaseUrl(" https://api.exemplo.dev// ")).toBe("https://api.exemplo.dev");
  });

  it("sem valor, usa a API local", () => {
    expect(apiBaseUrl(undefined)).toBe("http://localhost:3333");
    expect(apiBaseUrl("  ")).toBe("http://localhost:3333");
  });
});
