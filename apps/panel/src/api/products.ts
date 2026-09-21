import { apiRequest } from "./client.ts";
import { type FetchAllResult, fetchAllPages } from "./pagination.ts";
import type { OptionGroup, Page, Product } from "./types.ts";

export type ProductListQuery = { search?: string; categoryId?: string; limit: number; offset: number };

export function listProducts(restaurantId: string, query: ProductListQuery): Promise<Page<Product>> {
  return apiRequest<Page<Product>>(`/restaurants/${restaurantId}/products`, { query });
}

/**
 * Todos os produtos, para a conta que a API não faz: em quantos produtos
 * cada grupo de opções é usado. Até 20 páginas de 100 — acima disso a
 * contagem vem marcada como `truncated`, e a tela diz "pelo menos".
 */
export function listAllProducts(restaurantId: string): Promise<FetchAllResult<Product>> {
  return fetchAllPages((offset) => listProducts(restaurantId, { limit: 100, offset }), 20);
}

export type CreateProductBody = {
  name: string;
  priceInCents: number;
  stock: number;
  categoryId?: string;
  description?: string;
  photoUrl?: string;
};

/**
 * `categoryId: null` tira da seção (a API usa `nullable`, F12). `photoUrl`
 * não tem como ser apagada — o campo é `format: uri` e não aceita null —, então
 * só vai quando preenchida (pendência de backend).
 */
export type UpdateProductBody = {
  name: string;
  priceInCents: number;
  stock: number;
  categoryId: string | null;
  description: string;
  photoUrl?: string;
};

export function getProduct(restaurantId: string, id: string): Promise<Product> {
  return apiRequest<Product>(`/restaurants/${restaurantId}/products/${id}`);
}

export function createProduct(restaurantId: string, body: CreateProductBody): Promise<Product> {
  return apiRequest<Product>(`/restaurants/${restaurantId}/products`, { method: "POST", body });
}

export function updateProduct(restaurantId: string, id: string, body: UpdateProductBody): Promise<Product> {
  return apiRequest<Product>(`/restaurants/${restaurantId}/products/${id}`, { method: "PATCH", body });
}

/** A ORDEM do array é a ordem em que o cliente vê os grupos. */
export function setProductOptionGroups(
  restaurantId: string,
  id: string,
  optionGroupIds: string[],
): Promise<{ optionGroups: OptionGroup[] }> {
  return apiRequest<{ optionGroups: OptionGroup[] }>(
    `/restaurants/${restaurantId}/products/${id}/option-groups`,
    { method: "PUT", body: { optionGroupIds } },
  );
}
