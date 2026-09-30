// apps/menu/test/link-order.test.ts
import { describe, expect, it } from "vitest";
import {
  addressComplete,
  buildLinkOrderBody,
  canOrderByLink,
  changeError,
  deliveryBlock,
  EMPTY_ADDRESS,
  linkModalities,
  linkPayments,
  linkSteps,
  minimumHint,
  toQuoteAddress,
} from "../src/lib/link-order.ts";
import { makeRestaurant } from "./fixtures.ts";

const store = makeRestaurant().address;
const ADDRESS = { neighborhood: "Centro", street: "Rua A", number: "10", complement: "apto 2", zip: "01304-001" };

describe("pedido pelo link", () => {
  it("modalidades: só as que a loja aceita; sem nenhuma, só navegar", () => {
    expect(linkModalities(makeRestaurant())).toEqual(["delivery", "takeaway"]);
    expect(linkModalities(makeRestaurant({ isDelivery: false }))).toEqual(["takeaway"]);
    expect(canOrderByLink(makeRestaurant({ isDelivery: false, isTakeaway: false }))).toBe(false);
    expect(canOrderByLink(makeRestaurant({ isOpen: false }))).toBe(false);
    expect(canOrderByLink(makeRestaurant())).toBe(true);
  });

  it("mínimo: aviso no carrinho e bloqueio só da entrega", () => {
    const r = makeRestaurant({ minimumOrderInCents: 3000 });
    expect(minimumHint(r, 2200)).toBe("Para entrega, faltam R$ 8,00 para o pedido mínimo");
    expect(minimumHint(r, 3000)).toBeNull();
    expect(minimumHint(makeRestaurant({ minimumOrderInCents: 3000, isDelivery: false }), 2200)).toBeNull();
    expect(deliveryBlock(r, 2200)).toBe("Pedido mínimo para entrega: R$ 30,00");
    expect(deliveryBlock(r, 3000)).toBeNull();
  });

  it("passos: modalidade só com duas opções; endereço só na entrega", () => {
    expect(linkSteps(["delivery", "takeaway"], null)).toEqual(["modality", "details", "address", "payment"]);
    expect(linkSteps(["delivery", "takeaway"], "takeaway")).toEqual(["modality", "details", "payment"]);
    expect(linkSteps(["takeaway"], null)).toEqual(["details", "payment"]);
    expect(linkSteps(["delivery"], null)).toEqual(["details", "address", "payment"]);
  });

  it("formas de pagamento com o texto de cada modalidade", () => {
    expect(linkPayments(["cash", "card_on_delivery", "pix", "meal_voucher"], "delivery").map((p) => p.label)).toEqual([
      "Dinheiro",
      "Cartão na entrega",
      "Pix",
      "Vale-refeição",
    ]);
    expect(linkPayments(["card_on_delivery", "pix"], "takeaway").map((p) => p.label)).toEqual(["Cartão na retirada", "Pix"]);
  });

  it("endereço completo exige bairro, rua, número e CEP de 8 dígitos; a cotação não leva complemento", () => {
    expect(addressComplete(EMPTY_ADDRESS)).toBe(false);
    expect(addressComplete({ ...ADDRESS, zip: "01304" })).toBe(false);
    expect(addressComplete({ ...ADDRESS, complement: "" })).toBe(true);
    expect(toQuoteAddress(ADDRESS, store)).toEqual({
      street: "Rua A",
      number: "10",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01304-001",
    });
  });

  // Review Focus 2: o troco é conferido contra o TOTAL com frete
  it("troco menor que o total com frete é recusado", () => {
    expect(changeError(5400, { exact: false, cents: 5000 })).toBe("O troco precisa ser no mínimo R$ 54,00");
    expect(changeError(5400, { exact: false, cents: 5400 })).toBeNull();
    expect(changeError(5400, { exact: true, cents: null })).toBeNull();
    expect(changeError(5400, { exact: false, cents: null })).toBe("Informe o troco ou marque que tem o valor exato");
  });

  it("monta o corpo por modalidade: endereço só na entrega, troco só no dinheiro, frete nunca", () => {
    const lines = [{ key: "k", productId: "p1", name: "X", unitPriceInCents: 1000, quantity: 2, options: [], note: null }];
    const base = { name: " Ana ", phone: "(11) 98888-7777", lines };
    expect(
      buildLinkOrderBody({ ...base, modality: "delivery", payment: "cash", change: { exact: false, cents: 5000 }, address: ADDRESS }, store),
    ).toEqual({
      type: "delivery",
      customer: { name: "Ana", phone: "(11) 98888-7777" },
      items: [{ productId: "p1", quantity: 2 }],
      paymentMethod: "cash",
      changeForInCents: 5000,
      deliveryAddress: { ...toQuoteAddress(ADDRESS, store), complement: "apto 2" },
    });
    expect(
      buildLinkOrderBody({ ...base, modality: "takeaway", payment: "pix", change: { exact: false, cents: 5000 }, address: ADDRESS }, store),
    ).toEqual({
      type: "takeaway",
      customer: { name: "Ana", phone: "(11) 98888-7777" },
      items: [{ productId: "p1", quantity: 2 }],
      paymentMethod: "pix",
    });
  });
});
