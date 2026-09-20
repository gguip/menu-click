import { Navigate, Outlet, useLocation } from "react-router";
import { readSession } from "../api/session.ts";
import { LoadFailure, NeutralScreen } from "./ScreenStates.tsx";
import { useMe } from "./useMe.ts";

export function RequireSession() {
  const location = useLocation();
  if (readSession() === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** Login, cadastro e "esqueci" não fazem sentido para quem já entrou. */
export function RedirectIfSession() {
  if (readSession() !== null) return <Navigate to="/pedidos" replace />;
  return <Outlet />;
}

/**
 * Loja que não provou o e-mail recebe 403 em TODA rota do painel. Quem decide
 * é o `emailVerified` do /auth/me — nunca a listagem GET /restaurants, que
 * responde 200 para a loja bloqueada (incoerência documentada da API).
 */
export function RequireVerified() {
  const me = useMe();
  if (me.isPending) return <NeutralScreen />;
  if (me.isError) return <LoadFailure onRetry={() => void me.refetch()} />;
  if (!me.data.emailVerified) return <Navigate to="/confirme-seu-email" replace />;
  return <Outlet />;
}
