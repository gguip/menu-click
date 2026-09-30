import type { PaymentMethod } from "./types.ts";

export type DineInPayment = "cash" | "card_on_delivery" | "pix";

/** No salão paga-se no caixa, ao sair: sem troco, sem vale-refeição. */
export const DINE_IN_PAYMENTS: { method: DineInPayment; label: string }[] = [
  { method: "cash", label: "Dinheiro no caixa" },
  { method: "card_on_delivery", label: "Cartão no caixa" },
  { method: "pix", label: "Pix" },
];

export function dineInPayments(accepted: PaymentMethod[]) {
  return DINE_IN_PAYMENTS.filter((p) => accepted.includes(p.method));
}

export function checkoutBlock(form: { name: string; phone: string; payment: DineInPayment | null }): string | null {
  if (!form.name.trim()) return "Informe seu nome";
  if (form.phone.replace(/\D/g, "").length < 10) return "Informe um telefone válido";
  if (!form.payment) return "Escolha a forma de pagamento";
  return null;
}

/**
 * "(11) 98888-7777" enquanto a pessoa digita, com teto de 11 dígitos (DDD +
 * celular). O pedido vai com o telefone já mascarado: o cliente é identificado
 * pelo telefone, e um formato só evita que "11988887777" e "(11) 98888-7777"
 * virem duas pessoas.
 */
export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  // fixo tem 4+4; o hífen só vai para depois do 5º quando o 11º dígito chega
  const split = d.length === 11 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}
