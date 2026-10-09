// apps/menu/src/lib/tracking.ts
import { API_URL } from "./api.ts";
import type { PaymentMethod } from "./types.ts";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "out_for_delivery"
  | "ready_for_pickup"
  | "completed"
  | "cancelled";

/** O pedido como o acompanhamento público devolve. */
export type TrackedOrder = {
  id: string;
  number: number;
  type: "delivery" | "takeaway";
  status: OrderStatus;
  totalInCents: number;
  deliveryFeeInCents: number | null;
  paymentMethod: PaymentMethod;
  items: {
    name: string;
    quantity: number;
    unitPriceInCents: number;
    options?: { name: string }[];
    note?: string | null;
  }[];
  statusHistory: { status: OrderStatus; at: string }[];
  estimate: { readyAt: string } | { from: string; to: string } | null;
  cancellationReason: string | null;
};

export function isFinished(status: OrderStatus): boolean {
  return status === "completed" || status === "cancelled";
}

const TRACKS: Record<TrackedOrder["type"], { status: OrderStatus; label: string }[]> = {
  delivery: [
    { status: "confirmed", label: "Pedido aceito" },
    { status: "preparing", label: "Preparando" },
    { status: "out_for_delivery", label: "Saiu para entrega" },
    { status: "completed", label: "Entregue" },
  ],
  takeaway: [
    { status: "confirmed", label: "Pedido aceito" },
    { status: "preparing", label: "Preparando" },
    { status: "ready_for_pickup", label: "Pronto para retirada" },
    { status: "completed", label: "Retirado" },
  ],
};

function hhmm(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

/**
 * As quatro etapas do handoff, com a hora de cada uma vinda do histórico (o
 * primeiro registro daquele status). Etapa sem registro fica sem hora — a tela
 * mostra "—", nunca estima.
 */
export function trackSteps(order: TrackedOrder, timezone: string) {
  const track = TRACKS[order.type];
  const reached = track.findIndex((step) => step.status === order.status);
  return track.map((step, index) => {
    const at = order.statusHistory.find((event) => event.status === step.status)?.at;
    return { label: step.label, time: at ? hhmm(at, timezone) : null, done: reached >= index };
  });
}

export function trackHeadline(order: TrackedOrder): string {
  if (order.status === "pending") return "Aguardando a loja confirmar";
  if (order.status === "cancelled") return "Pedido cancelado";
  return TRACKS[order.type].find((step) => step.status === order.status)?.label ?? "Pedido aceito";
}

/** Hora de parede, e não "em 25 min": não envelhece com a tela aberta. */
export function estimateText(order: TrackedOrder, timezone: string): string | null {
  const e = order.estimate;
  if (e === null) return null;
  if ("readyAt" in e) return `Pronto por volta de ${hhmm(e.readyAt, timezone)}`;
  return `Previsão de entrega: ${hhmm(e.from, timezone)} – ${hhmm(e.to, timezone)}`;
}

/** A leitura HTTP. 404 é "não existe para este token"; rede e 5xx lançam. */
export async function fetchTrackedOrder(orderId: string, token: string): Promise<TrackedOrder | "not-found"> {
  const res = await fetch(`${API_URL}/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (res.status === 404 || res.status === 400) return "not-found";
  if (!res.ok) throw new Error(`acompanhamento: ${res.status}`);
  return (await res.json()) as TrackedOrder;
}

export function trackingSocketUrl(orderId: string, token: string): string {
  return `${API_URL.replace(/^http/, "ws")}/orders/${encodeURIComponent(orderId)}/track?token=${encodeURIComponent(token)}`;
}

/**
 * Onde o pedido está na trilha: quantas etapas já foram alcançadas e qual
 * está acontecendo agora. Aguardando a loja, nenhuma foi alcançada e a que se
 * espera é a primeira; pedido terminado não tem etapa acontecendo.
 */
export function trackProgress(order: TrackedOrder): { done: number; current: number | null } {
  if (order.status === "cancelled") return { done: 0, current: null };
  const done = TRACKS[order.type].findIndex((step) => step.status === order.status) + 1;
  if (order.status === "completed") return { done, current: null };
  return { done, current: Math.max(0, done - 1) };
}
