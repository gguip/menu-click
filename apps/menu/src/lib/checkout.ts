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
