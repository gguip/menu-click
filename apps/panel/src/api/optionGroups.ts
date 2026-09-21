import { apiRequest } from "./client.ts";
import { fetchAllPages } from "./pagination.ts";
import type { Option, OptionGroup, Page, PriceRule } from "./types.ts";

export function listAllOptionGroups(restaurantId: string): Promise<OptionGroup[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<OptionGroup>>(`/restaurants/${restaurantId}/option-groups`, {
      query: { limit: 100, offset },
    }),
  ).then((result) => result.items);
}

export type OptionGroupBody = {
  name: string;
  minOptions: number;
  maxOptions: number;
  priceRule: PriceRule;
};

export function createOptionGroup(restaurantId: string, body: OptionGroupBody): Promise<OptionGroup> {
  return apiRequest<OptionGroup>(`/restaurants/${restaurantId}/option-groups`, { method: "POST", body });
}

export function updateOptionGroup(
  restaurantId: string,
  id: string,
  patch: Partial<OptionGroupBody>,
): Promise<OptionGroup> {
  return apiRequest<OptionGroup>(`/restaurants/${restaurantId}/option-groups/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

/**
 * A API remove o grupo, as opções dele E o vínculo com todo produto que o
 * usava, na mesma transação e sem avisar — por isso a tela confirma dizendo
 * quantos produtos perdem o grupo.
 */
export function deleteOptionGroup(restaurantId: string, id: string): Promise<void> {
  return apiRequest<void>(`/restaurants/${restaurantId}/option-groups/${id}`, { method: "DELETE" });
}

export type OptionBody = {
  name: string;
  priceInCents: number;
  maxQuantity: number;
  available: boolean;
};

/** Opção nasce disponível: o `available` só se mexe depois, pelo interruptor. */
export type NewOptionBody = Pick<OptionBody, "name" | "priceInCents" | "maxQuantity">;

function optionsPath(restaurantId: string, groupId: string): string {
  return `/restaurants/${restaurantId}/option-groups/${groupId}/options`;
}

export function createOption(restaurantId: string, groupId: string, body: NewOptionBody): Promise<Option> {
  return apiRequest<Option>(optionsPath(restaurantId, groupId), { method: "POST", body });
}

export function updateOption(
  restaurantId: string,
  groupId: string,
  id: string,
  patch: Partial<OptionBody>,
): Promise<Option> {
  return apiRequest<Option>(`${optionsPath(restaurantId, groupId)}/${id}`, { method: "PATCH", body: patch });
}

export function deleteOption(restaurantId: string, groupId: string, id: string): Promise<void> {
  return apiRequest<void>(`${optionsPath(restaurantId, groupId)}/${id}`, { method: "DELETE" });
}
