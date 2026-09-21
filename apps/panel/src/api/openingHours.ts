import { apiRequest } from "./client.ts";
import type { OpeningHour } from "./types.ts";

type Payload = { openingHours: OpeningHour[] };

export function getOpeningHours(restaurantId: string): Promise<OpeningHour[]> {
  return apiRequest<Payload>(`/restaurants/${restaurantId}/opening-hours`).then(
    (payload) => payload.openingHours,
  );
}

/** O `PUT` SUBSTITUI a grade inteira: o que não vier some. */
export function putOpeningHours(
  restaurantId: string,
  openingHours: { weekday: number; opensAt: string; closesAt: string }[],
): Promise<OpeningHour[]> {
  return apiRequest<Payload>(`/restaurants/${restaurantId}/opening-hours`, {
    method: "PUT",
    body: { openingHours },
  }).then((payload) => payload.openingHours);
}
