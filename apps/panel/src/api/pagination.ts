import type { Page } from "./types.ts";

/**
 * Busca todas as páginas de uma listagem. O teto de páginas é rede de
 * segurança contra um `total` que nunca fecha, não um limite de negócio.
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number) => Promise<Page<T>>,
  maxPages = 10,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(items.length);
    items.push(...result.data);
    if (result.data.length === 0 || items.length >= result.total) break;
  }
  return items;
}
