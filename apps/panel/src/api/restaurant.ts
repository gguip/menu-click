import { apiRequest } from "./client.ts";
import type { Address, Restaurant } from "./types.ts";

/**
 * O que o painel edita no restaurante. O `slug` não está aqui porque a API
 * não o aceita: é a URL dentro do QR code impresso. `deliveryFeeMode` só
 * aceita os dois modos que a API deixa escolher (`distance` ainda não tem
 * como calcular nada). `freeDeliveryAboveInCents: null` DESLIGA a promoção —
 * zero seria "grátis acima de R$ 0", sempre grátis.
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
  deliveryFeeMode: "neighborhood" | "fixed";
  deliveryFixedFeeInCents: number;
  freeDeliveryAboveInCents: number | null;
  deliveryFeeToArrange: boolean;
  minimumOrderInCents: number;
}>;

export function getRestaurant(id: string): Promise<Restaurant> {
  return apiRequest<Restaurant>(`/restaurants/${id}`);
}

export function updateRestaurant(id: string, patch: RestaurantPatch): Promise<Restaurant> {
  return apiRequest<Restaurant>(`/restaurants/${id}`, { method: "PATCH", body: patch });
}

/** Soft delete no servidor: cardápio, mesas e grade saem junto. Não tem volta pelo painel. */
export function deleteRestaurant(id: string): Promise<void> {
  return apiRequest<void>(`/restaurants/${id}`, { method: "DELETE" });
}
