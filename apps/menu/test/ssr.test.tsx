import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { makeMenu } from "./fixtures.ts";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : [path];
  });
}

// I1 da revisão final: a página inteira ficava num `Suspense` por causa do
// `useSearchParams`, e o HTML do ISR saía vazio até o JavaScript carregar
describe("HTML do servidor", () => {
  afterEach(() => vi.useRealTimers());

  it("a página não embrulha o cardápio em Suspense nem usa useSearchParams", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/[slug]/page.tsx"), "utf8");
    expect(page).not.toMatch(/Suspense/);
    for (const file of sources(resolve(process.cwd(), "src"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/useSearchParams/);
    }
  });

  it("sai com o cardápio de verdade", () => {
    const html = renderToString(<MenuApp menu={makeMenu()} />);
    expect(html).toContain("Cantina do Porto");
    expect(html).toContain("Margherita");
  });

  // o HTML do cache é hidratado noutra hora; "hoje/amanhã" no servidor
  // viraria erro de hidratação
  it("não depende do relógio", () => {
    const menu = makeMenu({ isOpen: false, closesAt: undefined, opensAt: "2026-09-22T21:00:00.000Z" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-09-21T15:00:00-03:00"));
    const monday = renderToString(<MenuApp menu={menu} />);
    vi.setSystemTime(Date.parse("2026-09-18T15:00:00-03:00"));
    const friday = renderToString(<MenuApp menu={menu} />);
    expect(monday).toBe(friday);
  });
});
