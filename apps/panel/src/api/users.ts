import { apiRequest } from "./client.ts";
import type { RestaurantUser, UserRole } from "./types.ts";

/**
 * A listagem de usuários é a ÚNICA do painel que não é paginada: a API
 * responde `{ data }` cru, sem `limit`/`offset`/`total`. Por isso não passa
 * por `fetchAllPages` — não há página seguinte para buscar.
 */
export function listUsers(restaurantId: string): Promise<RestaurantUser[]> {
  return apiRequest<{ data: RestaurantUser[] }>(`/restaurants/${restaurantId}/users`).then(
    (result) => result.data,
  );
}

/**
 * A senha vai no convite porque o projeto não manda e-mail de convite: quem
 * convida entrega a senha provisória à pessoa, que troca depois no menu da
 * conta.
 */
export type InviteBody = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};

export function inviteUser(restaurantId: string, body: InviteBody): Promise<RestaurantUser> {
  return apiRequest<RestaurantUser>(`/restaurants/${restaurantId}/users`, { method: "POST", body });
}

export function deleteUser(restaurantId: string, id: string): Promise<void> {
  return apiRequest<void>(`/restaurants/${restaurantId}/users/${id}`, { method: "DELETE" });
}
