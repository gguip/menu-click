import type { Page } from "./types.ts";

export type FetchAllResult<T> = {
  items: T[];
  /**
   * `true` quando o teto de páginas foi atingido com pedido ainda restando —
   * a listagem parou antes do fim, e quem chama precisa dizer isso em vez de
   * devolver uma lista curta em silêncio (o mesmo defeito que a paginação
   * completa existe para evitar, só que na outra ponta).
   */
  truncated: boolean;
};

/**
 * Busca todas as páginas de uma listagem. O teto de páginas é rede de
 * segurança contra um `total` que nunca fecha, não um limite de negócio —
 * mas quando ele é atingido de verdade, isso vira `truncated: true` em vez de
 * sumir calado.
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number) => Promise<Page<T>>,
  maxPages = 10,
): Promise<FetchAllResult<T>> {
  const items: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(items.length);
    items.push(...result.data);
    if (result.data.length === 0 || items.length >= result.total) {
      return { items, truncated: false };
    }
  }
  return { items, truncated: true };
}
