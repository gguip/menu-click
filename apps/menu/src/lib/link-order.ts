// apps/menu/src/lib/link-order.ts
import type { LinkOrderBody } from "./api.ts";
import { type CartLine, toOrderItems } from "./cart.ts";
import { formatZip } from "./checkout.ts";
import { formatCents } from "./money.ts";
import type { Address, MenuRestaurant, PaymentMethod } from "./types.ts";

/**
 * O pedido pelo link (sem `?mesa=`): entrega ou retirada. Regra pura — as
 * telas do finalizar só leem daqui.
 */
export type Modality = "delivery" | "takeaway";
export type LinkStep = "modality" | "details" | "address" | "payment";

/** A mensagem exata da API quando a cotação da criação recusa o endereço. */
export const NOT_SERVED_MESSAGE = "A loja não entrega neste endereço";

export function linkModalities(r: Pick<MenuRestaurant, "isDelivery" | "isTakeaway">): Modality[] {
  return [...(r.isDelivery ? ["delivery" as const] : []), ...(r.isTakeaway ? ["takeaway" as const] : [])];
}

/** Aberta (grade e pausa) e com ao menos uma das duas modalidades do link. */
export function canOrderByLink(r: Pick<MenuRestaurant, "isOpen" | "isDelivery" | "isTakeaway">): boolean {
  return r.isOpen && linkModalities(r).length > 0;
}

/** O aviso do carrinho: o mínimo vale só na entrega, então não trava nada aqui. */
export function minimumHint(r: Pick<MenuRestaurant, "isDelivery" | "minimumOrderInCents">, subtotal: number): string | null {
  if (!r.isDelivery || r.minimumOrderInCents <= 0 || subtotal >= r.minimumOrderInCents) return null;
  return `Para entrega, faltam ${formatCents(r.minimumOrderInCents - subtotal)} para o pedido mínimo`;
}

/** Por que a opção "Entrega" está desabilitada, ou `null`. */
export function deliveryBlock(r: Pick<MenuRestaurant, "minimumOrderInCents">, subtotal: number): string | null {
  return subtotal < r.minimumOrderInCents ? `Pedido mínimo para entrega: ${formatCents(r.minimumOrderInCents)}` : null;
}

/**
 * Os passos do finalizar. Modalidade só aparece quando há escolha; endereço,
 * só na entrega. Antes da escolha, conta o endereço se a entrega existe — o
 * "Passo X de Y" mostra o caminho mais longo e encolhe ao escolher retirada.
 */
export function linkSteps(available: Modality[], chosen: Modality | null): LinkStep[] {
  const modality = chosen ?? (available.includes("delivery") ? "delivery" : available[0] ?? null);
  return [
    ...(available.length > 1 ? (["modality"] as const) : []),
    "details",
    ...(modality === "delivery" ? (["address"] as const) : []),
    "payment",
  ];
}

const PAYMENT_ORDER: readonly PaymentMethod[] = ["cash", "card_on_delivery", "pix", "meal_voucher"];
const PAYMENT_LABELS: Record<Modality, Record<PaymentMethod, string>> = {
  delivery: { cash: "Dinheiro", card_on_delivery: "Cartão na entrega", pix: "Pix", meal_voucher: "Vale-refeição" },
  takeaway: { cash: "Dinheiro", card_on_delivery: "Cartão na retirada", pix: "Pix", meal_voucher: "Vale-refeição" },
};

export function linkPayments(accepted: PaymentMethod[], modality: Modality) {
  return PAYMENT_ORDER.filter((m) => accepted.includes(m)).map((method) => ({
    method,
    label: PAYMENT_LABELS[modality][method],
  }));
}

export type AddressForm = { neighborhood: string; street: string; number: string; complement: string; zip: string };
export const EMPTY_ADDRESS: AddressForm = { neighborhood: "", street: "", number: "", complement: "", zip: "" };

export function addressComplete(a: AddressForm): boolean {
  return (
    a.neighborhood.trim() !== "" &&
    a.street.trim() !== "" &&
    a.number.trim() !== "" &&
    a.zip.replace(/\D/g, "").length === 8
  );
}

/**
 * O endereço para a COTAÇÃO: o value object da API, sem complemento (a
 * cotação o recusaria). Cidade e UF vêm da loja — a entrega é local.
 */
export function toQuoteAddress(a: AddressForm, store: Address): Address {
  return {
    street: a.street.trim(),
    number: a.number.trim(),
    neighborhood: a.neighborhood.trim(),
    city: store.city,
    state: store.state,
    zipCode: formatZip(a.zip),
  };
}

/** O endereço do PEDIDO: o da cotação mais o complemento, quando há. */
export function toOrderAddress(a: AddressForm, store: Address): Address & { complement?: string } {
  const complement = a.complement.trim();
  return { ...toQuoteAddress(a, store), ...(complement === "" ? {} : { complement }) };
}

export type ChangeChoice = { exact: boolean; cents: number | null };

/** O troco é conferido contra o TOTAL — itens mais frete. */
export function changeError(total: number, change: ChangeChoice): string | null {
  if (change.exact) return null;
  if (change.cents === null) return "Informe o troco ou marque que tem o valor exato";
  return change.cents < total ? `O troco precisa ser no mínimo ${formatCents(total)}` : null;
}

export type LinkOrderDraft = {
  modality: Modality;
  name: string;
  phone: string;
  payment: PaymentMethod;
  change: ChangeChoice;
  address: AddressForm;
  lines: CartLine[];
};

/** O corpo do POST. O frete nunca vai: a API recalcula a cotação do zero. */
export function buildLinkOrderBody(d: LinkOrderDraft, store: Address): LinkOrderBody {
  return {
    type: d.modality,
    customer: { name: d.name.trim(), phone: d.phone },
    items: toOrderItems(d.lines),
    paymentMethod: d.payment,
    ...(d.payment === "cash" && !d.change.exact && d.change.cents !== null ? { changeForInCents: d.change.cents } : {}),
    ...(d.modality === "delivery" ? { deliveryAddress: toOrderAddress(d.address, store) } : {}),
  };
}
