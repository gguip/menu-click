import { apiRequest } from "./client.ts";
import type { Page, Product } from "./types.ts";

export type ProductListQuery = { search?: string; categoryId?: string; limit: number; offset: number };

export function listProducts(restaurantId: string, query: ProductListQuery): Promise<Page<Product>> {
  return apiRequest<Page<Product>>(`/restaurants/${restaurantId}/products`, { query });
}
