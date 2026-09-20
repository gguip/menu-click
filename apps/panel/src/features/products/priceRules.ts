import type { PriceRule } from "../../api/types.ts";

/**
 * Texto FIXO do handoff, com exemplo em reais. De propósito não é um cálculo
 * com as opções reais: o front não duplica a regra de `unitPrice()` da API.
 */
export const PRICE_RULES: Record<PriceRule, { name: string; help: string; example: string }> = {
  sum: {
    name: "Somar",
    help: "soma o preço de tudo que foi escolhido",
    example: "Bacon +R$ 6,00 e Ovo +R$ 3,00 → R$ 9,00",
  },
  highest: {
    name: "Mais caro",
    help: "cobra só a opção mais cara das escolhidas",
    example: "Margherita R$ 62 + Calabresa R$ 72 → R$ 72,00",
  },
  average: {
    name: "Média",
    help: "cobra a média das opções escolhidas",
    example: "Margherita R$ 62 + Calabresa R$ 72 → R$ 67,00",
  },
};
