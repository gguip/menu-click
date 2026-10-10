import type { CartLine } from "./cart.ts";
import { productGroups } from "./selection.ts";
import type { MenuOptionGroup, MenuProduct } from "./types.ts";

/** Quantas sugestões cabem na faixa do carrinho. */
export const SUGGESTION_LIMIT = 6;

/**
 * O que oferecer em "Que tal adicionar?": o que a loja marcou, que dá para
 * pedir agora e que ainda não está no carrinho — na ordem do cardápio.
 *
 * Sai sempre do cardápio de agora, nunca do carrinho guardado: produto que
 * esgotou ou deixou de ser sugerido some sozinho.
 */
export function suggestionsFor(
  products: MenuProduct[],
  lines: CartLine[],
  limit: number = SUGGESTION_LIMIT,
): MenuProduct[] {
  const inCart = new Set(lines.map((line) => line.productId));
  return products
    .filter((product) => product.suggested === true && product.available && !inCart.has(product.id))
    .slice(0, limit);
}

/**
 * Produto com grupo obrigatório não entra com um toque: a pessoa precisa
 * escolher (tamanho, sabor) na tela do produto. Grupo opcional não impede.
 */
export function needsChoice(product: MenuProduct, groups: MenuOptionGroup[]): boolean {
  return productGroups(product, groups).some((group) => group.minOptions > 0);
}
