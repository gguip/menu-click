import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  filtersToParams,
  formatRangeLabel,
  isRange,
  parseFilters,
  toListQuery,
  withPeriod,
  withRange,
} from "../src/features/orders/orderFilters.ts";

describe("filtros de pedidos", () => {
  it("sem nada na URL: hoje, mais recentes, todas as mesas", () => {
    expect(parseFilters(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
  });

  it("intervalo vence o período — os dois nunca vão juntos", () => {
    const filters = parseFilters(new URLSearchParams("period=yesterday&from=2026-09-12&to=2026-09-17"));
    expect(filters.period).toBeNull();
    expect(isRange(filters)).toBe(true);
    expect(toListQuery(filters)).toEqual({
      from: "2026-09-12",
      to: "2026-09-17",
      tableId: undefined,
      sort: "createdAt",
      order: "desc",
    });
  });

  it("período inválido vira hoje", () => {
    expect(parseFilters(new URLSearchParams("period=ontem")).period).toBe("today");
  });

  it("escolher um desliga o outro", () => {
    const range = withRange(DEFAULT_FILTERS, "2026-09-12", "2026-09-17");
    expect(range.period).toBeNull();
    const back = withPeriod(range, "yesterday");
    expect(back).toMatchObject({ period: "yesterday", from: null, to: null });
  });

  it("a URL só carrega o que difere do padrão", () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("");
    expect(
      filtersToParams({ ...DEFAULT_FILTERS, period: "thisMonth", tableId: "t7", sort: "value" }).toString(),
    ).toBe("period=thisMonth&tableId=t7&sort=value");
  });

  it("'Maior valor' ordena por total", () => {
    expect(toListQuery({ ...DEFAULT_FILTERS, sort: "value" })).toMatchObject({
      period: "today",
      sort: "totalInCents",
      order: "desc",
    });
  });

  it("rótulo do intervalo", () => {
    expect(formatRangeLabel("2026-09-12", "2026-09-17")).toBe("12/09 – 17/09");
  });
});
