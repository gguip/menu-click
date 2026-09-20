import { apiRequest } from "./client.ts";
import type { DeliveryNeighborhood } from "./types.ts";

export async function listNeighborhoods(restaurantId: string): Promise<DeliveryNeighborhood[]> {
  const result = await apiRequest<{ neighborhoods: DeliveryNeighborhood[] }>(
    `/restaurants/${restaurantId}/delivery-neighborhoods`,
  );
  return result.neighborhoods;
}
