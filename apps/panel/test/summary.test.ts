import { describe, expect, it } from "vitest";
import {
  arrivedCount,
  bigNumbers,
  parsePeriod,
  READING_NOTES,
  statusRows,
  syncLabel,
} from "../src/features/summary/summary.ts";
import { makeSummary } from "./fixtures.ts";

const counts = {
  pending: 2,
  confirmed: 1,
  preparing: 1,
  ready_for_pickup: 0,
  out_for_delivery: 1,
  completed: 4,
  cancelled: 1,
};

describe("contagens", () => {
  it("'chegaram' é a soma de todos os status", () => {
    expect(arrivedCount(counts)).toBe(10);
  });

  it("cinco linhas agrupadas como no protótipo, com a fatia do total", () => {
    expect(statusRows(counts)).toEqual([
      { label: "Novos", count: 2, share: 0.2, tone: "new" },
      { label: "Em preparo", count: 2, share: 0.2, tone: "preparing" },
      { label: "Prontos / em rota", count: 1, share: 0.1, tone: "ready" },
      { label: "Concluídos", count: 4, share: 0.4, tone: "done" },
      { label: "Cancelados", count: 1, share: 0.1, tone: "cancelled" },
    ]);
  });

  it("período vazio: barras zeradas, sem divisão por zero", () => {
    expect(statusRows({}).every((row) => row.count === 0 && row.share === 0)).toBe(true);
  });
});

describe("os três números", () => {
  it("texto literal do protótipo, no plural", () => {
    const numbers = bigNumbers(
      makeSummary({ counts, revenueInCents: 45000, revenueOrderCount: 6, averageTicketInCents: 7500 }),
    );
    expect(numbers.map((number) => [number.label, number.sub])).toEqual([
      ["Faturamento", "de 6 pedidos aceitos — inclui o frete cobrado"],
      ["Pedidos aceitos", "10 chegaram no período"],
      ["Ticket médio", "faturamento ÷ pedidos aceitos"],
    ]);
    expect(numbers[0].value).toMatch(/450,00/);
    expect(numbers[1].value).toBe("6");
    expect(numbers[2].value).toMatch(/75,00/);
  });

  it("singular com um pedido só", () => {
    const numbers = bigNumbers(
      makeSummary({ counts: { ...makeSummary().counts, completed: 1 }, revenueOrderCount: 1 }),
    );
    expect(numbers[0].sub).toBe("de 1 pedido aceito — inclui o frete cobrado");
    expect(numbers[1].sub).toBe("1 chegou no período");
  });
});

describe("etiqueta de atualização", () => {
  it("'Fechamento parcial' só nos períodos que incluem hoje", () => {
    const now = 1_000_000;
    expect(syncLabel("today", now - 6000, now)).toBe("Fechamento parcial · atualizado há 6 s");
    expect(syncLabel("last7days", now - 6000, now)).toBe("Fechamento parcial · atualizado há 6 s");
    expect(syncLabel("thisMonth", now - 6000, now)).toBe("Fechamento parcial · atualizado há 6 s");
    expect(syncLabel("yesterday", now - 6000, now)).toBe("atualizado há 6 s");
  });
});

describe("parsePeriod", () => {
  it("aceita os quatro e cai em hoje no resto", () => {
    expect(parsePeriod("yesterday")).toBe("yesterday");
    expect(parsePeriod("thisMonth")).toBe("thisMonth");
    expect(parsePeriod(null)).toBe("today");
    expect(parsePeriod("amanha")).toBe("today");
  });
});

describe("notas", () => {
  it("as três notas literais do protótipo", () => {
    expect(READING_NOTES.map((note) => note.head)).toEqual([
      "Faturamento conta de aceito em diante.",
      "O frete entra no faturamento.",
      "O ticket médio mistura comida e frete.",
    ]);
  });
});
