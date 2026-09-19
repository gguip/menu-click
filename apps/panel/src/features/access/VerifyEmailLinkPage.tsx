import { Button } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useSearchParams } from "react-router";
import { verifyEmail } from "../../api/auth.ts";
import { ApiError, describeError } from "../../api/client.ts";
import { readSession } from "../../api/session.ts";
import { meQueryKey } from "../../auth/useMe.ts";
import classes from "./access.module.css";
import { AuthLayout } from "./AuthLayout.tsx";

export function VerifyEmailLinkPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const queryClient = useQueryClient();
  const hasSession = readSession() !== null;

  // useQuery (e não useMutation) porque deduplica: no StrictMode o efeito
  // montaria duas vezes, e o segundo POST encontraria o token já usado.
  const verification = useQuery({
    queryKey: ["verify-email", token],
    queryFn: async () => {
      const result = await verifyEmail(token);
      // O /auth/me em cache ainda diz "não verificado"; sem apagá-lo, a
      // guarda mandaria de volta para o bloqueio.
      queryClient.removeQueries({ queryKey: meQueryKey });
      return result;
    },
    enabled: token !== "",
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (verification.isSuccess) {
    return <Navigate to={hasSession ? "/pedidos" : "/login?motivo=email-confirmado"} replace />;
  }

  const failed = token === "" || verification.isError;
  const rateLimited = verification.error instanceof ApiError && verification.error.status === 429;

  return (
    <AuthLayout>
      {!failed ? (
        <h1 className={classes.title}>Confirmando o e-mail…</h1>
      ) : rateLimited ? (
        <>
          <h1 className={classes.title}>Aguarde um instante</h1>
          <p className={classes.subtitle}>{describeError(verification.error)}</p>
        </>
      ) : (
        <>
          <h1 className={classes.title}>Este link não vale mais</h1>
          <p className={classes.subtitle}>
            O link de confirmação expirou ou já foi usado. Cada link vale uma vez, por 24 horas.
          </p>
          {hasSession ? (
            <Button component={Link} to="/confirme-seu-email" h={44}>
              Mandar um link novo
            </Button>
          ) : (
            <Button component={Link} to="/login" h={44}>
              Entrar
            </Button>
          )}
        </>
      )}
    </AuthLayout>
  );
}
