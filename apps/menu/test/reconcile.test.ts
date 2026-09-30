import { describe, expect, it } from "vitest";
import { type CartLine, lineKey, reconcileCart } from "../src/lib/cart.ts";
import { makeMenu } from "./fixtures.ts";

const menu = makeMenu();

const line = (over: Partial<CartLine> = {}): CartLine => ({
  key: lineKey("p-marg", {}, null),
  productId: "p-marg",
  name: "Margherita",
  unitPriceInCents: 5200,
  quantity: 1,
  options: [],
  note: null,
  ...over,
});

// I3 da revisão final: o carrinho fica guardado sem prazo e o cardápio em
// cache muda; linha que o servidor recusaria sai antes de a pessoa tentar
describe("carrinho contra o cardápio de agora", () => {
  it("carrinho em dia não muda", () => {
    const lines = [line(), line({ key: lineKey("p-marg", { "g-bo": ["o-cat"] }, null), unitPriceInCents: 6000, options: [{ optionId: "o-cat", name: "Catupiry" }] })];
    expect(reconcileCart(lines, menu)).toEqual({ lines, changed: false });
  });

  it("refaz o preço pelo cardápio", () => {
    const result = reconcileCart([line({ unitPriceInCents: 4000 })], menu);
    expect(result.changed).toBe(true);
    expect(result.lines[0].unitPriceInCents).toBe(5200);
  });

  it("tira produto que saiu do cardápio ou ficou indisponível", () => {
    const gone = line({ productId: "p-sumiu", key: "p-sumiu|note:" });
    const off = line({ productId: "p-quatro", name: "Quatro queijos", key: "p-quatro|note:", unitPriceInCents: 5800 });
    expect(reconcileCart([gone, off, line()], menu)).toEqual({ lines: [line()], changed: true });
  });

  it("tira linha com opção que o produto não tem mais, ou que ficou fora das regras do grupo", () => {
    const oldOption = line({ options: [{ optionId: "o-velha", name: "Bacon" }], key: lineKey("p-marg", { g: ["o-velha"] }, null) });
    // meio a meio exige 2 sabores; uma linha com 1 seria recusada pela API
    const short = line({ productId: "p-meio", name: "Meio a meio", options: [{ optionId: "s-marg", name: "Margherita" }], key: lineKey("p-meio", { "g-sab": ["s-marg"] }, null) });
    expect(reconcileCart([oldOption, short], menu)).toEqual({ lines: [], changed: true });
  });

  it("descarta o que não tem forma de linha (versão velha, storage adulterado)", () => {
    const junk = [null, 42, { productId: "p-marg" }, { ...line(), options: "Catupiry" }, { ...line(), quantity: 0 }];
    expect(reconcileCart([...junk, line()], menu)).toEqual({ lines: [line()], changed: true });
  });
});
