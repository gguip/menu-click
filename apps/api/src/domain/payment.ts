/**
 * As formas de pagamento. Só tipos e a lista, mais o tradutor de flags.
 *
 * Todas são **na entrega**: o sistema não cobra, ele registra o que foi
 * combinado. Pagamento online exigiria gateway, webhook e conciliação, e é
 * outra PR inteira.
 */
export const PAYMENT_METHODS = [
  "cash",
  "card_on_delivery",
  "pix",
  "meal_voucher",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** As flags do restaurante, do jeito que o banco as guarda. */
export type AcceptedPaymentFlags = {
  acceptsCash: boolean;
  acceptsCardOnDelivery: boolean;
  acceptsPix: boolean;
  acceptsMealVoucher: boolean;
};

/**
 * Traduz as quatro flags na lista que o cliente escolhe.
 *
 * O cardápio recebe a lista pronta, não as flags: quatro booleanos são o
 * formato de quem edita, e uma lista é o formato de quem escolhe. A ordem é a
 * de `PAYMENT_METHODS`, para a tela não mudar sozinha entre requisições.
 */
export function acceptedPaymentMethods(
  flags: AcceptedPaymentFlags,
): PaymentMethod[] {
  const porForma: Record<PaymentMethod, boolean> = {
    cash: flags.acceptsCash,
    card_on_delivery: flags.acceptsCardOnDelivery,
    pix: flags.acceptsPix,
    meal_voucher: flags.acceptsMealVoucher,
  };
  return PAYMENT_METHODS.filter((forma) => porForma[forma]);
}
