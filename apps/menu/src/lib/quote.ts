// apps/menu/src/lib/quote.ts
import { API_URL } from "./api.ts";
import { formatCents } from "./money.ts";
import type { Address } from "./types.ts";

/**
 * A cotação informa; a criação decide (a API recalcula no POST). Por isso
 * erro de cotação não é exceção: é um estado que a tela mostra com "Tentar de
 * novo".
 */
export type Quote =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "fee"; cents: number }
  | { kind: "free" }
  | { kind: "arrange" }
  | { kind: "none" }
  | { kind: "error" };

export async function fetchQuote(slug: string, address: Address, subtotalInCents: number): Promise<Quote> {
  try {
    const res = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}/delivery-quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, subtotalInCents }),
    });
    if (!res.ok) return { kind: "error" };
    const q = (await res.json()) as { deliversTo: boolean; feeInCents: number | null; isFree: boolean; toArrange: boolean };
    if (!q.deliversTo) return { kind: "none" };
    if (q.toArrange) return { kind: "arrange" };
    if (q.isFree) return { kind: "free" };
    return typeof q.feeInCents === "number" ? { kind: "fee", cents: q.feeInCents } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/** O que somar ao total: o frete, `0` no grátis, `null` quando não há valor. */
export function quoteFee(q: Quote): number | null {
  if (q.kind === "fee") return q.cents;
  if (q.kind === "free") return 0;
  return null;
}

export function quoteText(q: Quote): string | null {
  switch (q.kind) {
    case "fee":
      return `Entrega: ${formatCents(q.cents)}`;
    case "free":
      return "Entrega grátis neste pedido";
    case "arrange":
      return "A loja combina a entrega com você";
    case "none":
      return "Esta loja não entrega no seu bairro";
    default:
      return null;
  }
}

/** Por que o passo do endereço não avança, ou `null`. */
export function quoteBlocksAdvance(q: Quote): string | null {
  switch (q.kind) {
    case "idle":
      return "Preencha o endereço";
    case "loading":
      return "Calculando a entrega…";
    case "error":
      return "Tente calcular a entrega de novo";
    case "none":
      return "Esta loja não entrega no seu bairro";
    default:
      return null;
  }
}

/**
 * Só a última promessa entregue vale. Trocar o bairro com uma cotação ainda no
 * ar dispara outra; se a velha chegar depois, ela não pode sobrescrever o
 * frete da nova.
 */
export function latestOnly() {
  let last = 0;
  return <T>(promise: Promise<T>): Promise<{ current: true; value: T } | { current: false }> => {
    const id = ++last;
    return promise.then((value) => (id === last ? { current: true as const, value } : { current: false as const }));
  };
}
