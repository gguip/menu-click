import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserRole } from "../../api/types.ts";
import {
  changeUserRole,
  deleteUser,
  type InviteBody,
  inviteUser,
  listUsers,
} from "../../api/users.ts";

export function usersQueryKey(restaurantId: string) {
  return ["users", restaurantId] as const;
}

export function useUsersList(restaurantId: string, enabled: boolean) {
  return useQuery({
    queryKey: usersQueryKey(restaurantId),
    queryFn: () => listUsers(restaurantId),
    // Quem é equipe recebe 403 nas quatro rotas: pedir a lista só para mostrar
    // o erro seria gastar uma requisição para chegar a uma tela que já sabemos
    // que não existe para essa pessoa.
    enabled,
  });
}

function useInvalidateUsers(restaurantId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: usersQueryKey(restaurantId) });
}

export function useInviteUser(restaurantId: string) {
  const invalidate = useInvalidateUsers(restaurantId);
  return useMutation({
    mutationFn: (body: InviteBody) => inviteUser(restaurantId, body),
    onSuccess: invalidate,
  });
}

/** Uma instância por linha: o observer desanexa a cada `mutate()`. */
export function useRemoveUser(restaurantId: string, userId: string) {
  const invalidate = useInvalidateUsers(restaurantId);
  return useMutation({
    mutationFn: () => deleteUser(restaurantId, userId),
    onSuccess: invalidate,
  });
}

/** Uma instância por linha, como a remoção. */
export function useChangeUserRole(restaurantId: string, userId: string) {
  const invalidate = useInvalidateUsers(restaurantId);
  return useMutation({
    mutationFn: (role: UserRole) => changeUserRole(restaurantId, userId, role),
    onSuccess: invalidate,
  });
}
