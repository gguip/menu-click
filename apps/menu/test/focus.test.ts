import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CSS fora de @layer ganha de qualquer camada, e os utilitários do Tailwind
// moram em @layer utilities: o contorno global de foco solto passava por cima
// do `focus:outline-none` dos campos e desenhava um segundo anel dentro do deles
describe("foco", () => {
  it("o contorno global de foco mora em @layer base, abaixo dos utilitários", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const base = css.match(/@layer base\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    expect(base).toMatch(/:focus-visible\s*{/);
    const outside = css.replace(/@layer base\s*{[\s\S]*?\n}/, "");
    expect(outside).not.toMatch(/:focus-visible\s*{/);
  });
});
