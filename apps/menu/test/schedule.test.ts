import { describe, expect, it } from "vitest";
import { closedHeadline, openChip, weekRows } from "../src/lib/schedule.ts";

const TZ = "America/Sao_Paulo";
const base = { timezone: TZ, isOpen: true, acceptingOrders: true };
// segunda 2026-09-21, 15:00 em São Paulo
const now = Date.parse("2026-09-21T15:00:00-03:00");

describe("horário na tela", () => {
  it("aberta com fechamento: 'Aberto até 23h' (e 23h30 quando há minutos)", () => {
    expect(openChip({ ...base, closesAt: "2026-09-22T02:00:00.000Z" })).toEqual({ tone: "open", text: "Aberto até 23h" });
    expect(openChip({ ...base, closesAt: "2026-09-22T02:30:00.000Z" }).text).toBe("Aberto até 23h30");
  });

  it("aberta direto: 'Aberto agora'", () => {
    expect(openChip(base)).toEqual({ tone: "open", text: "Aberto agora" });
  });

  it("pausada vence o horário (Review Focus 4)", () => {
    expect(openChip({ ...base, isOpen: false, acceptingOrders: false, closesAt: "2026-09-22T02:00:00.000Z" }))
      .toEqual({ tone: "paused", text: "Pedidos pausados" });
  });

  it("fechada: 'Fechado agora'", () => {
    expect(openChip({ ...base, isOpen: false, opensAt: "2026-09-21T21:00:00.000Z" })).toEqual({
      tone: "closed",
      text: "Fechado agora",
    });
  });

  it("manchete de fechada: hoje, amanhã, ou o dia", () => {
    const closed = { ...base, isOpen: false };
    expect(closedHeadline({ ...closed, opensAt: "2026-09-21T21:00:00.000Z" }, now)).toBe("Fechado. Abre hoje às 18h");
    expect(closedHeadline({ ...closed, opensAt: "2026-09-22T21:00:00.000Z" }, now)).toBe("Fechado. Abre amanhã às 18h");
    expect(closedHeadline({ ...closed, opensAt: "2026-09-25T21:00:00.000Z" }, now)).toBe("Fechado. Abre sexta às 18h");
    expect(closedHeadline(closed, now)).toBe("Fechado agora");
  });

  it("grade da semana começa na segunda e junta dias iguais seguidos", () => {
    const rows = weekRows([
      { weekday: 2, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 3, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 4, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 5, opensAt: "18:00", closesAt: "00:30" },
      { weekday: 6, opensAt: "18:00", closesAt: "00:30" },
      { weekday: 0, opensAt: "12:00", closesAt: "22:00" },
    ]);
    expect(rows).toEqual([
      { days: "Segunda", hours: "Fechado" },
      { days: "Terça a quinta", hours: "18h – 23h" },
      { days: "Sexta e sábado", hours: "18h – 00h30" },
      { days: "Domingo", hours: "12h – 22h" },
    ]);
  });
});
