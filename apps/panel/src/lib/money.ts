const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos inteiros → "R$ 1.234,56" (com espaço inseparável). */
export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

// "1.234,56" (milhar com ponto) ou "1234,56" (sem milhar); até 2 decimais.
const REAIS = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/;

/**
 * O que a pessoa digitou → centavos. Faz a conta em string para não passar
 * por float: 0,29 em float é 0.28999…, e um arredondamento mal feito some
 * com um centavo do preço.
 */
export function parseReaisToCents(input: string): number | null {
  const text = input.trim().replace(/^R\$\s*/, "");
  if (!REAIS.test(text)) return null;
  const [integer, fraction = ""] = text.replace(/\./g, "").split(",");
  return Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Centavos → texto para um campo editável ("1234,56", sem milhar). */
export function centsToInput(cents: number): string {
  const reais = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `${reais},${rest}`;
}
