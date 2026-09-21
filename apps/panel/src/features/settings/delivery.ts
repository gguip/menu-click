import type { RestaurantPatch } from "../../api/restaurant.ts";
import type { DeliveryFeeMode, DeliveryNeighborhood, Restaurant } from "../../api/types.ts";
import { centsToInput, parseReaisToCents } from "../../lib/money.ts";

/**
 * A chave de igualdade de um bairro — a MESMA de `normalizeNeighborhood` em
 * `apps/api/src/domain/delivery.ts`: sem acento, sem caixa, sem espaço
 * sobrando. Se as duas divergirem, a tela deixa passar um repetido que a API
 * recusa com 409, ou barra um que ela aceitaria.
 */
export function normalizeNeighborhood(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function addNeighborhood(
  list: readonly DeliveryNeighborhood[],
  name: string,
  feeText: string,
): { list: DeliveryNeighborhood[] } | { error: string } {
  const trimmed = name.trim();
  const key = normalizeNeighborhood(trimmed);
  if (key === "") return { error: "Informe o nome do bairro." };
  const feeInCents = parseReaisToCents(feeText);
  if (feeInCents === null) return { error: "Informe o frete em reais, como 8,50 — ou 0 para entrega grátis." };
  if (list.some((item) => normalizeNeighborhood(item.name) === key)) {
    return { error: `O bairro "${trimmed}" já está na lista.` };
  }
  return { list: [...list, { name: trimmed, feeInCents }] };
}

function sortedForCompare(list: readonly DeliveryNeighborhood[]): string[] {
  return list
    .map((item) => `${normalizeNeighborhood(item.name)}\u0000${item.name}\u0000${item.feeInCents}`)
    .sort();
}

/** A API devolve a lista na ordem dela: comparar em ordem deixaria a tela suja depois de salvar. */
export function neighborhoodsChanged(
  a: readonly DeliveryNeighborhood[],
  b: readonly DeliveryNeighborhood[],
): boolean {
  if (a.length !== b.length) return true;
  const left = sortedForCompare(a);
  const right = sortedForCompare(b);
  return left.some((value, index) => value !== right[index]);
}

export function neighborhoodCountLabel(count: number): string {
  return count === 1 ? "1 bairro" : `${count} bairros`;
}

export type DeliveryForm = {
  mode: DeliveryFeeMode;
  fixedFee: string;
  /** Vazio = promoção desligada (vai como `null`). */
  freeAbove: string;
  minimumOrder: string;
  toArrange: boolean;
};

export function fromRestaurant(restaurant: Restaurant): DeliveryForm {
  return {
    mode: restaurant.deliveryFeeMode,
    fixedFee: centsToInput(restaurant.deliveryFixedFeeInCents),
    freeAbove:
      restaurant.freeDeliveryAboveInCents === undefined ? "" : centsToInput(restaurant.freeDeliveryAboveInCents),
    minimumOrder: centsToInput(restaurant.minimumOrderInCents),
    toArrange: restaurant.deliveryFeeToArrange,
  };
}

export function validateDeliveryForm(form: DeliveryForm): string | null {
  if (form.mode === "fixed" && parseReaisToCents(form.fixedFee) === null) {
    return "Informe a taxa fixa em reais, como 8,50.";
  }
  if (form.freeAbove.trim() !== "" && parseReaisToCents(form.freeAbove) === null) {
    return "Informe o valor da entrega grátis em reais, como 50,00 — ou deixe em branco.";
  }
  if (parseReaisToCents(form.minimumOrder) === null) {
    return "Informe o pedido mínimo em reais, como 30,00 — ou 0 para sem mínimo.";
  }
  return null;
}

/**
 * Só o que mudou, comparado com o cache. Texto que não é valor (que a
 * validação barra antes do salvar) fica de fora — nunca vira "0" por engano.
 */
export function changedDeliveryPatch(form: DeliveryForm, restaurant: Restaurant): RestaurantPatch {
  const patch: RestaurantPatch = {};
  if (form.mode !== restaurant.deliveryFeeMode && form.mode !== "distance") {
    patch.deliveryFeeMode = form.mode;
  }
  const fixed = parseReaisToCents(form.fixedFee);
  if (fixed !== null && fixed !== restaurant.deliveryFixedFeeInCents) {
    patch.deliveryFixedFeeInCents = fixed;
  }
  // Vazio DESLIGA: `null`, nunca 0 — zero seria "grátis acima de R$ 0".
  const savedFree = restaurant.freeDeliveryAboveInCents ?? null;
  const blank = form.freeAbove.trim() === "";
  const free = blank ? null : parseReaisToCents(form.freeAbove);
  if ((blank || free !== null) && free !== savedFree) {
    patch.freeDeliveryAboveInCents = free;
  }
  const minimum = parseReaisToCents(form.minimumOrder);
  if (minimum !== null && minimum !== restaurant.minimumOrderInCents) {
    patch.minimumOrderInCents = minimum;
  }
  if (form.toArrange !== restaurant.deliveryFeeToArrange) {
    patch.deliveryFeeToArrange = form.toArrange;
  }
  return patch;
}

export function isDeliveryDirty(form: DeliveryForm, restaurant: Restaurant, listChanged: boolean): boolean {
  return (
    listChanged ||
    validateDeliveryForm(form) !== null ||
    Object.keys(changedDeliveryPatch(form, restaurant)).length > 0
  );
}

/** Texto literal do protótipo do handoff. */
export const DELIVERY_MODES: readonly { value: DeliveryFeeMode; label: string; help: string; disabled: boolean }[] = [
  { value: "neighborhood", label: "Por bairro", help: "Uma lista de bairros, cada um com o seu preço", disabled: false },
  { value: "fixed", label: "Taxa fixa", help: "Um valor só para toda a área atendida", disabled: false },
  { value: "distance", label: "Por distância", help: "Ainda não disponível nesta versão", disabled: true },
];

export function toArrangeHelp(on: boolean): string {
  return on
    ? 'Quando o frete não pode ser calculado, o pedido entra com "frete a combinar" e o valor é acertado por telefone. O total do pedido chega sem o frete.'
    : "Quando o frete não pode ser calculado, o pedido de entrega é recusado na hora. Nenhum pedido entra com valor em aberto.";
}
