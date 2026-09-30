import { describe, expect, it, vi } from "vitest";
import { addLine, bump, cartStorageKey, lineKey, loadCart, saveCart, subtotal, toOrderItems } from "../src/lib/cart.ts";
import type { CartLine } from "../src/lib/cart.ts";

const line = (over: Partial<CartLine> = {}): CartLine => ({
  key: lineKey("p1", { g: ["b"] }, null),
  productId: "p1",
  name: "Margherita",
  unitPriceInCents: 5800,
  quantity: 1,
  options: [{ optionId: "b", name: "Bacon" }],
  note: null,
  ...over,
});

describe("carrinho", () => {
  it("mesma seleção em ordem diferente e mesma observação é a mesma linha", () => {
    expect(lineKey("p1", { g: ["a", "b"] }, "sem cebola")).toBe(lineKey("p1", { g: ["b", "a"] }, "sem cebola"));
    expect(lineKey("p1", {}, "sem cebola")).not.toBe(lineKey("p1", {}, "com cebola"));
  });

  it("observação só com espaços é nenhuma (Review Focus 2)", () => {
    expect(lineKey("p1", {}, "   ")).toBe(lineKey("p1", {}, null));
  });

  it("junta linhas iguais, e zero remove", () => {
    let lines = addLine([], line());
    lines = addLine(lines, line({ quantity: 2 }));
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
    expect(subtotal(lines)).toBe(3 * 5800);
    expect(bump(lines, lines[0].key, -3)).toEqual([]);
  });

  it("vira itens do pedido, com opções e observação", () => {
    expect(toOrderItems([line({ note: "sem cebola", quantity: 2 })])).toEqual([
      { productId: "p1", quantity: 2, options: [{ optionId: "b", quantity: 1 }], note: "sem cebola" },
    ]);
    expect(toOrderItems([line({ options: [] })])).toEqual([{ productId: "p1", quantity: 1 }]);
  });

  it("persiste por loja e por mesa", () => {
    expect(cartStorageKey("cantina", "a7f3")).toBe("cart:cantina:a7f3");
    expect(cartStorageKey("cantina", null)).toBe("cart:cantina:link");
    saveCart("cart:cantina:a7f3", [line()]);
    expect(loadCart("cart:cantina:a7f3")).toHaveLength(1);
    expect(loadCart("cart:cantina:link")).toEqual([]);
  });

  it("storage indisponível: vazio e sem erro (Review Focus 3)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(loadCart("cart:x:link")).toEqual([]);
    expect(() => saveCart("cart:x:link", [line()])).not.toThrow();
    vi.restoreAllMocks();
  });
});
