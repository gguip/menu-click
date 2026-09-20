import { apiRequest } from "./client.ts";
import { fetchAllPages } from "./pagination.ts";
import type { Page, Table } from "./types.ts";

export function listAllTables(restaurantId: string): Promise<Table[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<Table>>(`/restaurants/${restaurantId}/tables`, { query: { limit: 100, offset } }),
  );
}
