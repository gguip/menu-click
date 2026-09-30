import type { OrderItemBody } from "./api.ts";
import { itemUnitPrice, productGroups, type Selection } from "./selection.ts";
import type { Menu } from "./types.ts";

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
/** Sem validar: quem lê passa por `reconcileCart`. */
export function loadCart(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
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

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const l = value as Record<string, unknown>;
  return (
    typeof l.key === "string" &&
    typeof l.productId === "string" &&
    typeof l.name === "string" &&
    typeof l.unitPriceInCents === "number" &&
    Number.isInteger(l.quantity) &&
    (l.quantity as number) > 0 &&
    (l.note === null || typeof l.note === "string") &&
    Array.isArray(l.options) &&
    l.options.every(
      (o: unknown) =>
        typeof o === "object" && o !== null && typeof (o as Record<string, unknown>).optionId === "string",
    )
  );
}

/**
 * O carrinho guardado contra o cardápio de agora. O `localStorage` não tem
 * prazo e o cardápio muda: produto que saiu ou ficou indisponível, opção que
 * sumiu e escolha fora das regras do grupo saem (a API recusaria o pedido
 * inteiro por uma linha), e o preço é refeito pela mesma conta da tela do
 * produto. Linha sem a forma de linha — versão velha, storage adulterado — sai
 * também, em vez de derrubar a página a cada visita. `changed` diz se a pessoa
 * precisa ser avisada.
 */
export function reconcileCart(saved: unknown[], menu: Menu): { lines: CartLine[]; changed: boolean } {
  const products = new Map(menu.sections.flatMap((s) => s.products).map((p) => [p.id, p]));
  let lines: CartLine[] = [];
  let changed = false;

  for (const raw of saved) {
    const product = isCartLine(raw) ? products.get(raw.productId) : undefined;
    if (!isCartLine(raw) || !product || !product.available) {
      changed = true;
      continue;
    }
    const groups = productGroups(product, menu.optionGroups);
    const selection: Selection = {};
    const options: CartLine["options"] = [];
    let valid = true;
    for (const { optionId } of raw.options) {
      const group = groups.find((g) => g.options.some((o) => o.id === optionId));
      if (!group) {
        valid = false;
        break;
      }
      selection[group.id] = [...(selection[group.id] ?? []), optionId];
      options.push({ optionId, name: group.options.find((o) => o.id === optionId)?.name ?? "" });
    }
    valid &&= groups.every((g) => {
      const chosen = (selection[g.id] ?? []).length;
      return chosen >= g.minOptions && chosen <= g.maxOptions;
    });
    if (!valid) {
      changed = true;
      continue;
    }
    const unitPriceInCents = itemUnitPrice(product, menu.optionGroups, selection);
    if (unitPriceInCents !== raw.unitPriceInCents) changed = true;
    lines = addLine(lines, {
      key: lineKey(product.id, selection, raw.note),
      productId: product.id,
      name: product.name,
      unitPriceInCents,
      quantity: raw.quantity,
      options,
      note: normalizeNote(raw.note),
    });
  }
  return { lines, changed };
}
