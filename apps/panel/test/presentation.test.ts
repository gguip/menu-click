import { describe, expect, it } from "vitest";
import {
  formatPhone,
  freightLine,
  groupOptions,
  isUrgent,
  itemsSubtotal,
  paymentLabel,
  stageLabel,
  typeLabel,
  whereLabel,
} from "../src/features/orders/presentation.ts";
import { makeOrder } from "./fixtures.ts";

const NOW = Date.parse("2026-09-19T23:00:00.000Z");

describe("apresentação do pedido", () => {
  it("modalidade e estágio", () => {
    expect(typeLabel("delivery")).toBe("Entrega");
    expect(typeLabel("takeaway")).toBe("Retirada");
    expect(typeLabel("dine_in")).toBe("Salão");
    expect(stageLabel("out_for_delivery")).toBe("Saiu para entrega");
    expect(stageLabel("ready_for_pickup")).toBe("Pronto para retirada");
    expect(stageLabel("preparing")).toBeNull();
  });

  it("pagamento, com troco ou sem", () => {
    expect(paymentLabel({ paymentMethod: "pix" })).toBe("Pix");
    expect(paymentLabel({ paymentMethod: "card_on_delivery" })).toBe("Cartão na entrega");
    expect(paymentLabel({ paymentMethod: "meal_voucher" })).toBe("Vale-refeição");
    expect(paymentLabel({ paymentMethod: "cash", changeForInCents: 5000 })).toBe(
      "Dinheiro · troco para R$ 50,00",
    );
    // ausência de troco no dinheiro = o cliente tem o valor exato
    expect(paymentLabel({ paymentMethod: "cash" })).toBe("Dinheiro · sem troco");
  });

  it("onde o pedido vai", () => {
    expect(whereLabel(makeOrder({ type: "delivery" }))).toBe("Rua Harmonia, 45 — Vila Madalena, São Paulo");
    expect(whereLabel(makeOrder({ type: "takeaway", deliveryAddress: null }))).toBe("Retirada no balcão");
    expect(
      whereLabel(makeOrder({ type: "dine_in", deliveryAddress: null, table: { id: "t", label: "Mesa 7" } })),
    ).toBe("Mesa 7");
    // adesivo antigo, sem hash: pedido de salão sem mesa é legítimo
    expect(whereLabel(makeOrder({ type: "dine_in", deliveryAddress: null, table: null }))).toBe(
      "Salão · sem mesa",
    );
  });

  it("frete em três formas, e ausente fora de entrega", () => {
    expect(freightLine(makeOrder({ type: "delivery", deliveryFeeInCents: 900 }))).toEqual({
      label: "Frete",
      value: "R$ 9,00",
    });
    expect(freightLine(makeOrder({ type: "delivery", deliveryFeeInCents: 0 }))).toEqual({
      label: "Entrega grátis",
      value: "R$ 0,00",
    });
    expect(freightLine(makeOrder({ type: "delivery", deliveryFeeInCents: null }))).toEqual({
      label: "Frete a combinar",
      value: "a combinar",
    });
    expect(freightLine(makeOrder({ type: "takeaway", deliveryFeeInCents: null }))).toBeNull();
  });

  it("itens = total menos frete (a conta precisa fechar)", () => {
    expect(itemsSubtotal(makeOrder({ totalInCents: 10100, deliveryFeeInCents: 900 }))).toBe(9200);
    expect(itemsSubtotal(makeOrder({ totalInCents: 5000, deliveryFeeInCents: null }))).toBe(5000);
  });

  it("agrupa as opções por grupo, na ordem em que vieram", () => {
    expect(
      groupOptions([
        { optionId: "1", groupName: "Sabores", name: "Calabresa", priceInCents: 0, quantity: 1 },
        { optionId: "2", groupName: "Borda", name: "Catupiry", priceInCents: 0, quantity: 1 },
        { optionId: "3", groupName: "Sabores", name: "Portuguesa", priceInCents: 0, quantity: 2 },
      ]),
    ).toEqual([
      { groupName: "Sabores", text: "Calabresa, 2× Portuguesa" },
      { groupName: "Borda", text: "Catupiry" },
    ]);
  });

  it("urgente: novo, ou aberto há mais de 25 min", () => {
    expect(isUrgent(makeOrder({ status: "pending", createdAt: "2026-09-19T22:59:00.000Z" }), NOW)).toBe(true);
    expect(isUrgent(makeOrder({ status: "preparing", createdAt: "2026-09-19T22:40:00.000Z" }), NOW)).toBe(false);
    expect(isUrgent(makeOrder({ status: "preparing", createdAt: "2026-09-19T22:30:00.000Z" }), NOW)).toBe(true);
    expect(isUrgent(makeOrder({ status: "completed", createdAt: "2026-09-19T20:00:00.000Z" }), NOW)).toBe(false);
  });

  it("telefone brasileiro legível", () => {
    expect(formatPhone("11987654321")).toBe("(11) 98765-4321");
    expect(formatPhone("1187654321")).toBe("(11) 8765-4321");
    expect(formatPhone("+55 11 9")).toBe("+55 11 9");
  });
});
