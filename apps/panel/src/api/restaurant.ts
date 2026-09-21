import { apiRequest } from "./client.ts";
import type { Address, Restaurant } from "./types.ts";

/**
 * O que o painel edita HOJE no restaurante. Os campos de entrega
 * (`deliveryFeeMode`, `deliveryFixedFeeInCents`, `freeDeliveryAboveInCents`,
 * `deliveryFeeToArrange`, `minimumOrderInCents`) entram na parte 2b, com a
 * tela que os explica. O `slug` não está aqui porque a API não o aceita: é a
 * URL dentro do QR code impresso.
 */
export type RestaurantPatch = Partial<{
  name: string;
  cuisineType: string;
  logoUrl: string;
  address: Address;
  isDelivery: boolean;
  isTakeaway: boolean;
  isQrcode: boolean;
  timezone: string;
  acceptingOrders: boolean;
  acceptsCash: boolean;
  acceptsCardOnDelivery: boolean;
  acceptsPix: boolean;
  acceptsMealVoucher: boolean;
}>;

export function getRestaurant(id: string): Promise<Restaurant> {
  return apiRequest<Restaurant>(`/restaurants/${id}`);
}

export function updateRestaurant(id: string, patch: RestaurantPatch): Promise<Restaurant> {
  return apiRequest<Restaurant>(`/restaurants/${id}`, { method: "PATCH", body: patch });
}
