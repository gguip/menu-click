import type { OrdersSummary, OrderStatus, Period } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import { formatSecondsAgo } from "../../lib/time.ts";

export type StatusTone = "new" | "preparing" | "ready" | "done" | "cancelled";

export type StatusRow = { label: string; count: number; share: number; tone: StatusTone };

/**
 * As cinco linhas do protótipo, agrupadas como as colunas do kanban (mais
 * Cancelados à parte). A barra é a fatia do total que CHEGOU no período.
 */
const ROWS: readonly { label: string; statuses: readonly OrderStatus[]; tone: StatusTone }[] = [
  { label: "Novos", statuses: ["pending"], tone: "new" },
  { label: "Em preparo", statuses: ["confirmed", "preparing"], tone: "preparing" },
  { label: "Prontos / em rota", statuses: ["ready_for_pickup", "out_for_delivery"], tone: "ready" },
  { label: "Concluídos", statuses: ["completed"], tone: "done" },
  { label: "Cancelados", statuses: ["cancelled"], tone: "cancelled" },
];

export function arrivedCount(counts: Partial<Record<OrderStatus, number>>): number {
  return Object.values(counts).reduce<number>((total, count) => total + (count ?? 0), 0);
}

export function statusRows(counts: Partial<Record<OrderStatus, number>>): StatusRow[] {
  const total = arrivedCount(counts);
  return ROWS.map((row) => {
    const count = row.statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
    return { label: row.label, count, share: total === 0 ? 0 : count / total, tone: row.tone };
  });
}

/** Texto literal do protótipo; o singular é o único acréscimo. */
export function bigNumbers(summary: OrdersSummary): { label: string; value: string; sub: string }[] {
  const accepted = summary.revenueOrderCount;
  const arrived = arrivedCount(summary.counts);
  return [
    {
      label: "Faturamento",
      value: formatCents(summary.revenueInCents),
      sub: `de ${accepted} ${accepted === 1 ? "pedido aceito" : "pedidos aceitos"} — inclui o frete cobrado`,
    },
    {
      label: "Pedidos aceitos",
      value: String(accepted),
      sub: arrived === 1 ? "1 chegou no período" : `${arrived} chegaram no período`,
    },
    { label: "Ticket médio", value: formatCents(summary.averageTicketInCents), sub: "faturamento ÷ pedidos aceitos" },
  ];
}

/** "Parcial" só enquanto o período ainda está correndo: Ontem já fechou. */
export function syncLabel(period: Period, updatedAtMs: number, nowMs: number): string {
  const updated = `atualizado ${formatSecondsAgo(updatedAtMs, nowMs)}`;
  return period === "yesterday" ? updated : `Fechamento parcial · ${updated}`;
}

const PERIOD_VALUES: readonly Period[] = ["today", "yesterday", "last7days", "thisMonth"];

export function parsePeriod(value: string | null): Period {
  return PERIOD_VALUES.find((period) => period === value) ?? "today";
}

/** "Como ler estes números" — texto literal do protótipo. */
export const READING_NOTES: readonly { head: string; body: string }[] = [
  {
    head: "Faturamento conta de aceito em diante.",
    body: "Pedido novo ainda não é venda e cancelado deixou de ser. São as vendas do período, não tudo que chegou.",
  },
  {
    head: "O frete entra no faturamento.",
    body: "R$ 30 de comida + R$ 15 de entrega aparecem como R$ 45. Está certo para faturamento bruto.",
  },
  {
    head: "O ticket médio mistura comida e frete.",
    body: "Por isso ele não serve para decidir preço de cardápio — para isso, olhe o preço dos produtos.",
  },
];
