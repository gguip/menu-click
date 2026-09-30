// apps/menu/test/tracking.test.ts
import { describe, expect, it } from "vitest";
import { estimateText, type TrackedOrder, trackHeadline, trackSteps } from "../src/lib/tracking.ts";

const TZ = "America/Sao_Paulo";

function order(over: Partial<TrackedOrder> = {}): TrackedOrder {
  return {
    id: "o1",
    number: 42,
    type: "delivery",
    status: "preparing",
    totalInCents: 6100,
    deliveryFeeInCents: 900,
    paymentMethod: "pix",
    items: [],
    statusHistory: [
      { status: "pending", at: "2026-09-30T21:00:00.000Z" },
      { status: "confirmed", at: "2026-09-30T21:02:00.000Z" },
      { status: "preparing", at: "2026-09-30T21:05:00.000Z" },
    ],
    estimate: { from: "2026-09-30T21:42:00.000Z", to: "2026-09-30T21:57:00.000Z" },
    cancellationReason: null,
    ...over,
  };
}

describe("acompanhamento", () => {
  it("trilha da entrega com a hora de cada etapa, no fuso da loja", () => {
    expect(trackSteps(order(), TZ)).toEqual([
      { label: "Pedido aceito", time: "18:02", done: true },
      { label: "Preparando", time: "18:05", done: true },
      { label: "Saiu para entrega", time: null, done: false },
      { label: "Entregue", time: null, done: false },
    ]);
  });

  it("trilha da retirada", () => {
    expect(trackSteps(order({ type: "takeaway", status: "ready_for_pickup" }), TZ).map((s) => [s.label, s.done])).toEqual([
      ["Pedido aceito", true],
      ["Preparando", true],
      ["Pronto para retirada", true],
      ["Retirado", false],
    ]);
  });

  it("manchete: aguardando, a etapa atual, cancelado", () => {
    expect(trackHeadline(order({ status: "pending" }))).toBe("Aguardando a loja confirmar");
    expect(trackHeadline(order({ status: "out_for_delivery" }))).toBe("Saiu para entrega");
    expect(trackHeadline(order({ status: "cancelled" }))).toBe("Pedido cancelado");
  });

  it("previsão por modalidade, e nada quando a API não prevê", () => {
    expect(estimateText(order(), TZ)).toBe("Previsão de entrega: 18:42 – 18:57");
    expect(estimateText(order({ type: "takeaway", estimate: { readyAt: "2026-09-30T21:27:00.000Z" } }), TZ)).toBe(
      "Pronto por volta de 18:27",
    );
    expect(estimateText(order({ estimate: null }), TZ)).toBeNull();
  });
});
