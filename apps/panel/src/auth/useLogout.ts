import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { logout } from "../api/auth.ts";
import { clearSession } from "../api/session.ts";

/** Sair: avisa a API (que revoga a sessão) e limpa tudo local, dê a API certo ou não. */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      try {
        await logout();
      } catch {
        // sem rede ou sessão já morta: a sessão local morre de qualquer jeito
      }
    },
    onSettled: () => {
      clearSession();
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });
}
