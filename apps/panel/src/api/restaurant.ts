import { apiRequest } from "./client.ts";
import type { Restaurant } from "./types.ts";

export function getRestaurant(id: string): Promise<Restaurant> {
  return apiRequest<Restaurant>(`/restaurants/${id}`);
}

export function updateRestaurant(id: string, patch: { acceptingOrders: boolean }): Promise<Restaurant> {
  return apiRequest<Restaurant>(`/restaurants/${id}`, { method: "PATCH", body: patch });
}
