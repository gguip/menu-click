// apps/api/test/estimate.unit.test.ts
import { describe, expect, it } from "vitest";
import { estimateFor } from "../src/domain/estimate.ts";

const confirmed = [
  { status: "pending" as const, at: "2026-09-30T21:00:00.000Z" },
  { status: "confirmed" as const, at: "2026-09-30T21:02:00.000Z" },
];
const times = { prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 };

describe("previsão a partir da confirmação", () => {
  it("retirada: pronto em confirmado + preparo", () => {
    expect(estimateFor({ type: "takeaway", status: "preparing" }, confirmed, times)).toEqual({
      readyAt: "2026-09-30T21:27:00.000Z",
    });
  });

  it("entrega: a faixa a partir da confirmação", () => {
    expect(estimateFor({ type: "delivery", status: "out_for_delivery" }, confirmed, times)).toEqual({
      from: "2026-09-30T21:42:00.000Z",
      to: "2026-09-30T21:57:00.000Z",
    });
  });

  it("sem previsão: antes de confirmar, terminado, salão ou sem tempo configurado", () => {
    expect(estimateFor({ type: "takeaway", status: "pending" }, confirmed.slice(0, 1), times)).toBeNull();
    expect(estimateFor({ type: "takeaway", status: "completed" }, confirmed, times)).toBeNull();
    expect(estimateFor({ type: "delivery", status: "cancelled" }, confirmed, times)).toBeNull();
    expect(estimateFor({ type: "dine_in", status: "preparing" }, confirmed, times)).toBeNull();
    expect(estimateFor({ type: "takeaway", status: "preparing" }, confirmed, {})).toBeNull();
    expect(estimateFor({ type: "delivery", status: "preparing" }, confirmed, { prepTimeMinutes: 25 })).toBeNull();
  });

  // pedido anterior ao registro de status tem só a chegada: sem "confirmed", sem conta
  it("confirmado sem evento de confirmação: sem previsão", () => {
    expect(estimateFor({ type: "takeaway", status: "preparing" }, confirmed.slice(0, 1), times)).toBeNull();
  });
});
