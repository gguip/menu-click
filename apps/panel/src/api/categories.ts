import { apiRequest } from "./client.ts";
import { fetchAllPages } from "./pagination.ts";
import type { Category, Page, Product } from "./types.ts";

/** Ordem da refeição (`position`); empate desfeito pelo nome, como na API. */
export function sortCategories(categories: readonly Category[]): Category[] {
  return [...categories].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"),
  );
}

export async function listAllCategories(restaurantId: string): Promise<Category[]> {
  const all = await fetchAllPages((offset) =>
    apiRequest<Page<Category>>(`/restaurants/${restaurantId}/categories`, { query: { limit: 100, offset } }),
  );
  return sortCategories(all);
}

export function createCategory(restaurantId: string, name: string): Promise<Category> {
  return apiRequest<Category>(`/restaurants/${restaurantId}/categories`, { method: "POST", body: { name } });
}

export function renameCategory(restaurantId: string, id: string, name: string): Promise<Category> {
  return apiRequest<Category>(`/restaurants/${restaurantId}/categories/${id}`, {
    method: "PATCH",
    body: { name },
  });
}

export function moveCategory(restaurantId: string, id: string, position: number): Promise<Category> {
  return apiRequest<Category>(`/restaurants/${restaurantId}/categories/${id}`, {
    method: "PATCH",
    body: { position },
  });
}

export function deleteCategory(restaurantId: string, id: string): Promise<void> {
  return apiRequest<void>(`/restaurants/${restaurantId}/categories/${id}`, { method: "DELETE" });
}

/**
 * "N produtos" da seção. A categoria não traz contagem (pendência de backend
 * da spec): sai do `total` de uma listagem de produtos com `limit=1`.
 */
export async function countProductsInCategory(restaurantId: string, categoryId: string): Promise<number> {
  const page = await apiRequest<Page<Product>>(`/restaurants/${restaurantId}/products`, {
    query: { categoryId, limit: 1 },
  });
  return page.total;
}
