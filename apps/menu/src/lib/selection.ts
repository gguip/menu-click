import { unitPrice } from "@menuclick/pricing";
import { formatCents } from "./money.ts";
import type { MenuOption, MenuOptionGroup, MenuProduct } from "./types.ts";

/** Grupo → ids escolhidos. Uma unidade por opção na parte 1. */
export type Selection = Record<string, string[]>;

export function toggleOption(sel: Selection, group: MenuOptionGroup, optionId: string): Selection {
  const current = sel[group.id] ?? [];
  let next: string[];
  if (current.includes(optionId)) next = current.filter((id) => id !== optionId);
  else if (current.length < group.maxOptions) next = [...current, optionId];
  else if (group.maxOptions === 1) next = [optionId];
  else next = current;
  return { ...sel, [group.id]: next };
}

export function missingGroup(groups: MenuOptionGroup[], sel: Selection): MenuOptionGroup | null {
  return groups.find((g) => g.minOptions > 0 && (sel[g.id] ?? []).length < g.minOptions) ?? null;
}

/** O botão travado diz o que falta — nunca só apagado. */
export function lockReason(group: MenuOptionGroup): string {
  return `Escolha ${group.minOptions} em ${group.name}`;
}

export function groupHint(group: MenuOptionGroup): string {
  if (group.priceRule === "highest") return "Cobramos o sabor mais caro";
  if (group.priceRule === "average") return "Cobramos a média dos sabores";
  return group.minOptions > 0 ? "Obrigatório" : "Opcional";
}

export function groupBadge(group: MenuOptionGroup, sel: Selection): string {
  const count = (sel[group.id] ?? []).length;
  return group.minOptions > 0 ? `${count} de ${group.maxOptions}` : `${count}/${group.maxOptions}`;
}

export function optionPriceLabel(group: MenuOptionGroup, option: MenuOption): string {
  if (option.priceInCents === 0) return "";
  return group.priceRule === "highest" ? `até + ${formatCents(option.priceInCents)}` : `+ ${formatCents(option.priceInCents)}`;
}

export function productGroups(product: MenuProduct, groups: MenuOptionGroup[]): MenuOptionGroup[] {
  return product.optionGroupIds
    .map((id) => groups.find((g) => g.id === id))
    .filter((g): g is MenuOptionGroup => g !== undefined);
}

/** O preço de uma unidade, pelo MESMO código que a API usa para cobrar. */
export function itemUnitPrice(product: MenuProduct, groups: MenuOptionGroup[], sel: Selection): number {
  return unitPrice(
    product.priceInCents,
    productGroups(product, groups).map((group) => ({
      priceRule: group.priceRule,
      choices: (sel[group.id] ?? [])
        .map((id) => group.options.find((o) => o.id === id))
        .filter((o): o is MenuOption => o !== undefined)
        .map((o) => ({ priceInCents: o.priceInCents, quantity: 1 })),
    })),
  );
}

/** "a partir de": as opções mais baratas até o mínimo de cada grupo obrigatório. */
export function fromPrice(product: MenuProduct, groups: MenuOptionGroup[]): { prefix: string; cents: number } {
  const required = productGroups(product, groups).filter((g) => g.minOptions > 0);
  if (required.length === 0) return { prefix: "", cents: product.priceInCents };
  const cheapest: Selection = {};
  for (const group of required) {
    cheapest[group.id] = [...group.options]
      .sort((a, b) => a.priceInCents - b.priceInCents)
      .slice(0, group.minOptions)
      .map((o) => o.id);
  }
  return { prefix: "a partir de", cents: itemUnitPrice(product, groups, cheapest) };
}
