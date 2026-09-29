import type { OrderItemBody } from "./api.ts";
import type { Selection } from "./selection.ts";

export type CartLine = {
  key: string;
  productId: string;
  name: string;
  unitPriceInCents: number;
  quantity: number;
  options: { optionId: string; name: string }[];
  note: string | null;
};

export function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Mesma fusão da API: produto + opções (sem ordem) + observação. */
export function lineKey(productId: string, sel: Selection, note: string | null): string {
  const options = Object.values(sel).flat().sort();
  return [productId, ...options, `note:${normalizeNote(note) ?? ""}`].join("|");
}

export function addLine(lines: CartLine[], line: CartLine): CartLine[] {
  const hit = lines.find((l) => l.key === line.key);
  if (!hit) return [...lines, line];
  return lines.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + line.quantity } : l));
}

export function bump(lines: CartLine[], key: string, delta: number): CartLine[] {
  return lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0);
}

export function subtotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceInCents * l.quantity, 0);
}

export function optionsText(line: CartLine): string {
  return line.options.length === 0 ? "Sem complementos" : line.options.map((o) => o.name).join(" · ");
}

export function toOrderItems(lines: CartLine[]): OrderItemBody[] {
  return lines.map((l) => ({
    productId: l.productId,
    quantity: l.quantity,
    ...(l.options.length > 0 ? { options: l.options.map((o) => ({ optionId: o.optionId, quantity: 1 })) } : {}),
    ...(l.note ? { note: l.note } : {}),
  }));
}

export function cartStorageKey(slug: string, tableHash: string | null): string {
  return `cart:${slug}:${tableHash ?? "link"}`;
}

/** Aba anônima ou storage bloqueado: carrinho só em memória, nunca erro. */
export function loadCart(key: string): CartLine[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function saveCart(key: string, lines: CartLine[]): void {
  try {
    if (lines.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(lines));
  } catch {
    // sem storage: segue em memória
  }
}
