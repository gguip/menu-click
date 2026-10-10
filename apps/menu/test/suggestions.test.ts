import { describe, expect, it } from "vitest";
import type { CartLine } from "@/lib/cart.ts";
import { needsChoice, suggestionsFor } from "@/lib/suggestions.ts";
import type { MenuProduct } from "@/lib/types.ts";
import { makeMenu } from "./fixtures.ts";

function product(id: string, overrides: Partial<MenuProduct> = {}): MenuProduct {
  return { id, name: id, priceInCents: 600, available: true, optionGroupIds: [], suggested: true, ...overrides };
}

function line(productId: string, key = productId): CartLine {
  return { key, productId, name: productId, unitPriceInCents: 600, quantity: 1, options: [], note: null };
}

describe("sugestões do carrinho", () => {
  it("só entra o que a loja marcou, na ordem do cardápio", () => {
    const products = [product("a"), product("b", { suggested: false }), product("c"), product("d", { suggested: undefined })];
    expect(suggestionsFor(products, []).map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("produto indisponível não é sugerido", () => {
    expect(suggestionsFor([product("a", { available: false }), product("b")], []).map((p) => p.id)).toEqual(["b"]);
  });

  it("o que já está no carrinho não é sugerido, com quaisquer opções", () => {
    const products = [product("a"), product("b")];
    expect(suggestionsFor(products, [line("a", "a|opt-1|note:")]).map((p) => p.id)).toEqual(["b"]);
  });

  it("corta em 6", () => {
    const products = Array.from({ length: 9 }, (_, index) => product(`p${index}`));
    expect(suggestionsFor(products, []).map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });

  it("sem nada marcado, não há sugestão", () => {
    expect(suggestionsFor([product("a", { suggested: false })], [])).toEqual([]);
  });
});

describe("o toque na sugestão", () => {
  const menu = makeMenu();
  const byId = (id: string) => menu.sections.flatMap((s) => s.products).find((p) => p.id === id)!;

  it("grupo obrigatório pede a tela do produto", () => {
    // "Meio a meio" exige 2 sabores
    expect(needsChoice(byId("p-meio"), menu.optionGroups)).toBe(true);
  });

  it("grupo opcional não impede o toque direto", () => {
    // "Margherita" só tem a borda, que é opcional
    expect(needsChoice(byId("p-marg"), menu.optionGroups)).toBe(false);
  });

  it("produto sem grupo entra direto", () => {
    expect(needsChoice(byId("p-agua"), menu.optionGroups)).toBe(false);
  });
});
