import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "../api/auth.ts";
import type { Me } from "../api/types.ts";

export const meQueryKey = ["me"] as const;

export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: fetchMe, staleTime: 60_000 });
}

/** O usuário da sessão. Só dentro das rotas guardadas por `RequireVerified`. */
export function useSessionUser(): Me {
  const { data } = useMe();
  if (data === undefined) {
    throw new Error("useSessionUser só funciona dentro das rotas guardadas por RequireVerified");
  }
  return data;
}
