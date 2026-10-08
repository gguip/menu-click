import { apiRequest } from "./client.ts";
import type { OptionGroup, Page, Product } from "./types.ts";

export type ProductListQuery = { search?: string; categoryId?: string; limit: number; offset: number };

export function listProducts(restaurantId: string, query: ProductListQuery): Promise<Page<Product>> {
  return apiRequest<Page<Product>>(`/restaurants/${restaurantId}/products`, { query });
}

export type CreateProductBody = {
  name: string;
  priceInCents: number;
  stock: number;
  categoryId?: string;
  description?: string;
};

/**
 * `categoryId: null` tira da seção (F12). `photoUrl` só vai quando a foto
 * mudou: `null` tira, e a URL é a `secure_url` que o Cloudinary devolveu — a
 * API recusa qualquer outra, inclusive a URL externa antiga reenviada.
 */
export type UpdateProductBody = {
  name: string;
  priceInCents: number;
  stock: number;
  categoryId: string | null;
  description: string;
  photoUrl?: string | null;
};

export function getProduct(restaurantId: string, id: string): Promise<Product> {
  return apiRequest<Product>(`/restaurants/${restaurantId}/products/${id}`);
}

export function createProduct(restaurantId: string, body: CreateProductBody): Promise<Product> {
  return apiRequest<Product>(`/restaurants/${restaurantId}/products`, { method: "POST", body });
}

export function updateProduct(
  restaurantId: string,
  id: string,
  body: Partial<UpdateProductBody>,
): Promise<Product> {
  return apiRequest<Product>(`/restaurants/${restaurantId}/products/${id}`, { method: "PATCH", body });
}

/**
 * Soft delete na API: pedidos antigos guardam cópia do nome e do preço, e os
 * vínculos com grupos de opções caem junto (na mesma transação).
 */
export function deleteProduct(restaurantId: string, id: string): Promise<void> {
  return apiRequest<void>(`/restaurants/${restaurantId}/products/${id}`, { method: "DELETE" });
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
