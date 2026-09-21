import { describe, expect, it } from "vitest";
import {
  addNeighborhood,
  changedDeliveryPatch,
  DELIVERY_MODES,
  fromRestaurant,
  isDeliveryDirty,
  neighborhoodCountLabel,
  neighborhoodsChanged,
  normalizeNeighborhood,
  toArrangeHelp,
  validateDeliveryForm,
} from "../src/features/settings/delivery.ts";
import { makeRestaurant } from "./fixtures.ts";

describe("normalizeNeighborhood", () => {
  it("é a mesma chave da API: sem acento, sem caixa, sem espaço sobrando", () => {
    expect(normalizeNeighborhood("  Jardim   América ")).toBe("jardim america");
    expect(normalizeNeighborhood("Centro")).toBe(normalizeNeighborhood("centro "));
  });
});

describe("addNeighborhood", () => {
  const list = [{ name: "Vila Madalena", feeInCents: 800 }];

  it("acrescenta com o nome aparado e o frete em centavos", () => {
    expect(addNeighborhood(list, "  Pinheiros ", "7,50")).toEqual({
      list: [...list, { name: "Pinheiros", feeInCents: 750 }],
    });
  });

  it("frete zero é permitido: entrega grátis naquele bairro", () => {
    expect(addNeighborhood([], "Centro", "0")).toEqual({ list: [{ name: "Centro", feeInCents: 0 }] });
  });

  it("barra o repetido pela mesma comparação da API", () => {
    expect(addNeighborhood(list, "vila madalena ", "5,00")).toEqual({
      error: 'O bairro "vila madalena" já está na lista.',
    });
  });

  it("barra nome vazio e frete ilegível", () => {
    expect(addNeighborhood(list, "   ", "5,00")).toEqual({ error: "Informe o nome do bairro." });
    expect(addNeighborhood(list, "Centro", "cinco")).toEqual({
      error: "Informe o frete em reais, como 8,50 — ou 0 para entrega grátis.",
    });
  });
});

describe("neighborhoodsChanged", () => {
  it("não depende de ordem", () => {
    const a = [{ name: "Centro", feeInCents: 500 }, { name: "Pinheiros", feeInCents: 700 }];
    expect(neighborhoodsChanged(a, [...a].reverse())).toBe(false);
  });

  it("percebe frete, nome e tamanho diferentes", () => {
    const a = [{ name: "Centro", feeInCents: 500 }];
    expect(neighborhoodsChanged(a, [{ name: "Centro", feeInCents: 600 }])).toBe(true);
    expect(neighborhoodsChanged(a, [{ name: "centro", feeInCents: 500 }])).toBe(true);
    expect(neighborhoodsChanged(a, [])).toBe(true);
  });
});

describe("o formulário de entrega", () => {
  it("nasce do restaurante, com 'grátis acima de' vazio quando a promoção está desligada", () => {
    expect(fromRestaurant(makeRestaurant({ deliveryFixedFeeInCents: 900, minimumOrderInCents: 3000 }))).toEqual({
      mode: "fixed",
      fixedFee: "9,00",
      freeAbove: "",
      minimumOrder: "30,00",
      toArrange: false,
    });
    expect(fromRestaurant(makeRestaurant({ freeDeliveryAboveInCents: 5000 })).freeAbove).toBe("50,00");
  });

  it("sem mudança nenhuma, o PATCH sai vazio e a tela está limpa", () => {
    const restaurant = makeRestaurant();
    const form = fromRestaurant(restaurant);
    expect(changedDeliveryPatch(form, restaurant)).toEqual({});
    expect(isDeliveryDirty(form, restaurant, false)).toBe(false);
    expect(isDeliveryDirty(form, restaurant, true)).toBe(true);
  });

  it("o PATCH leva só o que mudou", () => {
    const restaurant = makeRestaurant();
    const form = { ...fromRestaurant(restaurant), mode: "neighborhood" as const, minimumOrder: "30,00" };
    expect(changedDeliveryPatch(form, restaurant)).toEqual({
      deliveryFeeMode: "neighborhood",
      minimumOrderInCents: 3000,
    });
  });

  it("'grátis acima de' esvaziado vai como null, nunca 0", () => {
    const restaurant = makeRestaurant({ freeDeliveryAboveInCents: 5000 });
    const form = { ...fromRestaurant(restaurant), freeAbove: "  " };
    expect(changedDeliveryPatch(form, restaurant)).toEqual({ freeDeliveryAboveInCents: null });
  });

  it("'8,5' e '8,50' são o mesmo valor", () => {
    const restaurant = makeRestaurant({ deliveryFixedFeeInCents: 850 });
    const form = { ...fromRestaurant(restaurant), fixedFee: "8,5" };
    expect(changedDeliveryPatch(form, restaurant)).toEqual({});
  });

  it("valida os valores em reais; a taxa fixa só no modo fixo", () => {
    const form = fromRestaurant(makeRestaurant());
    expect(validateDeliveryForm(form)).toBeNull();
    expect(validateDeliveryForm({ ...form, fixedFee: "abc" })).toBe("Informe a taxa fixa em reais, como 8,50.");
    expect(validateDeliveryForm({ ...form, mode: "neighborhood", fixedFee: "abc" })).toBeNull();
    expect(validateDeliveryForm({ ...form, freeAbove: "muito" })).toBe(
      "Informe o valor da entrega grátis em reais, como 50,00 — ou deixe em branco.",
    );
    expect(validateDeliveryForm({ ...form, minimumOrder: "" })).toBe(
      "Informe o pedido mínimo em reais, como 30,00 — ou 0 para sem mínimo.",
    );
  });

  it("texto inválido deixa a tela suja, para o Salvar mostrar o erro", () => {
    const restaurant = makeRestaurant();
    expect(isDeliveryDirty({ ...fromRestaurant(restaurant), minimumOrder: "x" }, restaurant, false)).toBe(true);
  });
});

describe("copy", () => {
  it("contagem de bairros no singular e no plural", () => {
    expect(neighborhoodCountLabel(1)).toBe("1 bairro");
    expect(neighborhoodCountLabel(3)).toBe("3 bairros");
  });

  it("por distância vem desabilitado", () => {
    expect(DELIVERY_MODES.map((mode) => [mode.label, mode.disabled])).toEqual([
      ["Por bairro", false],
      ["Taxa fixa", false],
      ["Por distância", true],
    ]);
  });

  it("a ajuda do 'a combinar' muda com o estado", () => {
    expect(toArrangeHelp(true)).toContain("o pedido entra com");
    expect(toArrangeHelp(false)).toContain("é recusado na hora");
  });
});
