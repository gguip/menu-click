import { apiRequest } from "./client.ts";
import type { DeliveryNeighborhood } from "./types.ts";

export async function listNeighborhoods(restaurantId: string): Promise<DeliveryNeighborhood[]> {
  const result = await apiRequest<{ neighborhoods: DeliveryNeighborhood[] }>(
    `/restaurants/${restaurantId}/delivery-neighborhoods`,
  );
  return result.neighborhoods;
}

/**
 * Substitui a lista inteira: bairro que não vier some. Lista vazia é válida
 * e limpa a configuração — o que, no modo por bairro, faz a loja recusar
 * entrega (não é frete grátis).
 */
export async function putNeighborhoods(
  restaurantId: string,
  neighborhoods: DeliveryNeighborhood[],
): Promise<DeliveryNeighborhood[]> {
  const result = await apiRequest<{ neighborhoods: DeliveryNeighborhood[] }>(
    `/restaurants/${restaurantId}/delivery-neighborhoods`,
    { method: "PUT", body: { neighborhoods } },
  );
  return result.neighborhoods;
}
