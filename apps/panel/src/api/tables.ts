import { apiRequest } from "./client.ts";
import { fetchAllPages } from "./pagination.ts";
import type { Page, Table } from "./types.ts";

export function listAllTables(restaurantId: string): Promise<Table[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<Table>>(`/restaurants/${restaurantId}/tables`, { query: { limit: 100, offset } }),
  ).then((result) => result.items);
}

export function createTable(restaurantId: string, label: string): Promise<Table> {
  return apiRequest<Table>(`/restaurants/${restaurantId}/tables`, { method: "POST", body: { label } });
}

/**
 * Só o rótulo. O `PATCH` da API não toca no hash de propósito — é isso que a
 * nota do topo da tela promete: renomear a mesa não mata o adesivo colado
 * nela.
 */
export function renameTable(restaurantId: string, id: string, label: string): Promise<Table> {
  return apiRequest<Table>(`/restaurants/${restaurantId}/tables/${id}`, {
    method: "PATCH",
    body: { label },
  });
}

/**
 * Rota própria porque o efeito é próprio: o adesivo que está na mesa para de
 * funcionar no mesmo instante. Devolve a mesa com `hash` e `qrUrl` novos.
 */
export function rotateTableHash(restaurantId: string, id: string): Promise<Table> {
  return apiRequest<Table>(`/restaurants/${restaurantId}/tables/${id}/rotate-hash`, { method: "POST" });
}

export function deleteTable(restaurantId: string, id: string): Promise<void> {
  return apiRequest<void>(`/restaurants/${restaurantId}/tables/${id}`, { method: "DELETE" });
}
