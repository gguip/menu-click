import { useSearchParams } from "react-router";
import type { OrderListQuery } from "../../api/orders.ts";
import type { Period } from "../../api/types.ts";

export const PERIODS: readonly { value: Period; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last7days", label: "Últimos 7 dias" },
  { value: "thisMonth", label: "Este mês" },
];

export type SortChoice = "recent" | "value";

/**
 * Período e intervalo são mutuamente exclusivos: quando um está ligado, o
 * outro é `null`. A API responde 400 aos dois juntos, e a UI nunca os deixa
 * ligados ao mesmo tempo (correção do handoff).
 */
export type OrderFilters = {
  period: Period | null;
  from: string | null;
  to: string | null;
  tableId: string | null;
  sort: SortChoice;
};

export const DEFAULT_FILTERS: OrderFilters = {
  period: "today",
  from: null,
  to: null,
  tableId: null,
  sort: "recent",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPeriod(value: string | null): value is Period {
  return PERIODS.some((period) => period.value === value);
}

export function parseFilters(params: URLSearchParams): OrderFilters {
  const from = params.get("from");
  const to = params.get("to");
  const tableId = params.get("tableId") || null;
  const sort: SortChoice = params.get("sort") === "value" ? "value" : "recent";
  if (from && to && DATE.test(from) && DATE.test(to)) {
    return { period: null, from, to, tableId, sort };
  }
  const period = params.get("period");
  return { period: isPeriod(period) ? period : "today", from: null, to: null, tableId, sort };
}

export function isRange(filters: OrderFilters): boolean {
  return filters.from !== null && filters.to !== null;
}

export function filtersToParams(filters: OrderFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.from !== null && filters.to !== null) {
    params.set("from", filters.from);
    params.set("to", filters.to);
  } else if (filters.period !== null && filters.period !== "today") {
    params.set("period", filters.period);
  }
  if (filters.tableId !== null) params.set("tableId", filters.tableId);
  if (filters.sort === "value") params.set("sort", "value");
  return params;
}

export function withPeriod(filters: OrderFilters, period: Period): OrderFilters {
  return { ...filters, period, from: null, to: null };
}

export function withRange(filters: OrderFilters, from: string, to: string): OrderFilters {
  return { ...filters, period: null, from, to };
}

export function toListQuery(filters: OrderFilters): OrderListQuery {
  const range =
    filters.from !== null && filters.to !== null
      ? { from: filters.from, to: filters.to }
      : { period: filters.period ?? "today" };
  return {
    ...range,
    tableId: filters.tableId ?? undefined,
    sort: filters.sort === "value" ? "totalInCents" : "createdAt",
    order: "desc",
  };
}

/** "2026-09-12" + "2026-09-17" → "12/09 – 17/09". */
export function formatRangeLabel(from: string, to: string): string {
  const short = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  return `${short(from)} – ${short(to)}`;
}

/** Os filtros moram na URL: sobrevivem ao recarregar e dá para mandar o link. */
export function useOrderFilters(): [OrderFilters, (next: OrderFilters) => void] {
  const [params, setParams] = useSearchParams();
  return [parseFilters(params), (next) => setParams(filtersToParams(next))];
}
