// apps/api/src/domain/estimate.ts
import type { OrderStatus, OrderStatusEvent, OrderType } from "./order.ts";

/** Retirada: a hora em que fica pronto. Entrega: a faixa de chegada. */
export type Estimate = { readyAt: string } | { from: string; to: string };

export type EstimateTimes = {
  prepTimeMinutes?: number;
  deliveryTimeMinMinutes?: number;
  deliveryTimeMaxMinutes?: number;
};

const MINUTE_MS = 60_000;
const FINISHED: readonly OrderStatus[] = ["completed", "cancelled"];

/**
 * A previsão conta a partir de quando a LOJA ACEITOU (o evento `confirmed`),
 * não de quando o pedido chegou: um pedido esquecido dez minutos em "Novos"
 * não pode prometer que já está quase pronto. Antes da confirmação, depois do
 * fim, no salão, sem o evento (pedido anterior ao histórico) ou sem tempo
 * configurado: `null` — a tela não inventa hora.
 *
 * Os tempos são os de AGORA, não congelados no pedido: previsão é estimativa,
 * e a loja que muda o tempo no meio do almoço quer que ele valha já.
 */
export function estimateFor(
  order: { type: OrderType; status: OrderStatus },
  history: OrderStatusEvent[],
  times: EstimateTimes,
): Estimate | null {
  if (FINISHED.includes(order.status)) return null;
  const confirmedAt = history.find((event) => event.status === "confirmed")?.at;
  if (confirmedAt === undefined) return null;
  const base = Date.parse(confirmedAt);
  const plus = (minutes: number) => new Date(base + minutes * MINUTE_MS).toISOString();

  if (order.type === "takeaway" && times.prepTimeMinutes !== undefined) {
    return { readyAt: plus(times.prepTimeMinutes) };
  }
  if (
    order.type === "delivery" &&
    times.deliveryTimeMinMinutes !== undefined &&
    times.deliveryTimeMaxMinutes !== undefined
  ) {
    return { from: plus(times.deliveryTimeMinMinutes), to: plus(times.deliveryTimeMaxMinutes) };
  }
  return null;
}
