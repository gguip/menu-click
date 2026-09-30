// apps/panel/test/vercel-config.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// o painel é SPA: /pedidos digitado ou recarregado não existe como arquivo, e
// sem a volta para o index.html a Vercel responde 404
describe("vercel.json do painel", () => {
  it("devolve o index.html para toda rota que não é arquivo", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"));
    expect(config.rewrites).toContainEqual({ source: "/(.*)", destination: "/index.html" });
  });
});
