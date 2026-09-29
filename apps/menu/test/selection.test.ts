import { describe, expect, it } from "vitest";
import {
  fromPrice,
  groupBadge,
  groupHint,
  itemUnitPrice,
  lockReason,
  missingGroup,
  optionPriceLabel,
  toggleOption,
} from "../src/lib/selection.ts";
import type { MenuOptionGroup, MenuProduct } from "../src/lib/types.ts";

const sabores: MenuOptionGroup = {
  id: "g-sab",
  name: "Sabores",
  minOptions: 2,
  maxOptions: 2,
  priceRule: "highest",
  options: [
    { id: "marg", name: "Margherita", priceInCents: 4500, maxQuantity: 1 },
    { id: "quatro", name: "Quatro queijos", priceInCents: 5000, maxQuantity: 1 },
    { id: "cala", name: "Calabresa", priceInCents: 4500, maxQuantity: 1 },
  ],
};
const borda: MenuOptionGroup = {
  id: "g-bo",
  name: "Borda",
  minOptions: 0,
  maxOptions: 1,
  priceRule: "sum",
  options: [
    { id: "cat", name: "Catupiry", priceInCents: 800, maxQuantity: 1 },
    { id: "ched", name: "Cheddar", priceInCents: 800, maxQuantity: 1 },
  ],
};
const pizza: MenuProduct = {
  id: "p2",
  name: "Meio a meio",
  priceInCents: 3000,
  available: true,
  optionGroupIds: ["g-sab", "g-bo"],
};

describe("seleção de opções", () => {
  it("marca, desmarca e respeita o teto; grupo de uma escolha troca a seleção", () => {
    let sel = toggleOption({}, sabores, "marg");
    sel = toggleOption(sel, sabores, "quatro");
    expect(toggleOption(sel, sabores, "cala")["g-sab"]).toEqual(["marg", "quatro"]); // teto
    expect(toggleOption(sel, sabores, "marg")["g-sab"]).toEqual(["quatro"]); // desmarca
    const b = toggleOption(toggleOption({}, borda, "cat"), borda, "ched");
    expect(b["g-bo"]).toEqual(["ched"]); // troca
  });

  it("o que falta é o primeiro obrigatório incompleto, e o botão diz", () => {
    const sel = toggleOption({}, sabores, "marg");
    expect(missingGroup([sabores, borda], sel)?.id).toBe("g-sab");
    expect(lockReason(sabores)).toBe("Escolha 2 em Sabores");
    expect(missingGroup([sabores, borda], toggleOption(sel, sabores, "cala"))).toBeNull();
  });

  it("dicas e contadores do grupo", () => {
    expect(groupHint(sabores)).toBe("Cobramos o sabor mais caro");
    expect(groupHint(borda)).toBe("Opcional");
    expect(groupHint({ ...borda, minOptions: 1 })).toBe("Obrigatório");
    expect(groupHint({ ...sabores, priceRule: "average" })).toBe("Cobramos a média dos sabores");
    expect(groupBadge(sabores, { "g-sab": ["marg"] })).toBe("1 de 2");
    expect(groupBadge(borda, {})).toBe("0/1");
  });

  it("rótulo de preço da opção muda com a regra", () => {
    expect(optionPriceLabel(borda, borda.options[0])).toBe("+ R$ 8,00");
    expect(optionPriceLabel(sabores, sabores.options[1])).toBe("até + R$ 50,00");
    expect(optionPriceLabel(borda, { ...borda.options[0], priceInCents: 0 })).toBe("");
  });

  it("total do item ao vivo sai do pacote de preço", () => {
    const sel = { "g-sab": ["marg", "quatro"], "g-bo": ["cat"] };
    expect(itemUnitPrice(pizza, [sabores, borda], sel)).toBe(3000 + 5000 + 800);
  });

  it("'a partir de' escolhe as opções mais baratas até o mínimo", () => {
    expect(fromPrice(pizza, [sabores, borda])).toEqual({ prefix: "a partir de", cents: 3000 + 4500 });
    expect(fromPrice({ ...pizza, optionGroupIds: ["g-bo"] }, [borda])).toEqual({ prefix: "", cents: 3000 });
  });
});
