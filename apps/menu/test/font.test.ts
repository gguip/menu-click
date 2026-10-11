import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// o vitest roda da raiz do pacote; no jsdom o `import.meta.url` não é `file:`
const app = resolve(process.cwd(), "src/app");
const layout = readFileSync(resolve(app, "layout.tsx"), "utf8");

describe("fonte do app", () => {
  // `next/font/google` baixa a fonte no build; uma falha dessa ida já derrubou o CI
  it("vem do repositório, não do Google", () => {
    expect(layout).not.toContain("next/font/google");
    expect(layout).toContain("./fonts/sora-latin.woff2");
  });

  it("o arquivo existe e é um woff2", () => {
    const file = resolve(app, "fonts/sora-latin.woff2");
    expect(statSync(file).size).toBeGreaterThan(10_000);
    expect(readFileSync(file).subarray(0, 4).toString("latin1")).toBe("wOF2");
  });
});
