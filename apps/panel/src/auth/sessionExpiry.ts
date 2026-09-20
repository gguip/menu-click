import type { QueryClient } from "@tanstack/react-query";
import { onUnauthorized } from "../api/client.ts";

type Navigator = { navigate: (to: string) => unknown };

/**
 * 401 em qualquer resposta autenticada: o cliente HTTP já limpou a sessão;
 * aqui o cache some (dados de uma sessão não vazam para a próxima) e a tela
 * vai para o login com o aviso "Sua sessão expirou".
 */
export function installSessionExpiry(queryClient: QueryClient, router: Navigator): () => void {
  onUnauthorized(() => {
    queryClient.clear();
    void router.navigate("/login?motivo=sessao-expirada");
  });
  return () => onUnauthorized(null);
}
