import { Button } from "@mantine/core";
import { IconArrowUpRight } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate } from "react-router";
import { resendVerification } from "../../api/auth.ts";
import { ApiError, describeError } from "../../api/client.ts";
import { LoadFailure, NeutralScreen } from "../../auth/ScreenStates.tsx";
import { useLogout } from "../../auth/useLogout.ts";
import { useMe } from "../../auth/useMe.ts";
import { formatCountdown } from "../../lib/time.ts";
import { useCountdown } from "../../lib/useCountdown.ts";
import { Notice } from "../../ui/Notice.tsx";
import access from "./access.module.css";
import classes from "./EmailBlockedPage.module.css";

const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL;

/**
 * Sem rail e sem header: o painel está bloqueado, e mostrar a navegação
 * desabilitada só frustra. Endereço errado não tem saída pela API (S30 em
 * aberto) — a tela diz isso, em vez de fingir que há um botão.
 */
export function EmailBlockedPage() {
  const me = useMe();
  const countdown = useCountdown();
  const [sent, setSent] = useState(false);
  const logoutMutation = useLogout();

  const resend = useMutation({
    mutationFn: resendVerification,
    onSuccess: () => setSent(true),
    onError: (error) => {
      setSent(false);
      // teto de 3 por minuto por usuário; o Retry-After diz quanto falta
      if (error instanceof ApiError && error.status === 429) {
        countdown.start(error.retryAfterSeconds ?? 60);
      }
    },
  });

  if (me.isPending) return <NeutralScreen />;
  if (me.isError) return <LoadFailure onRetry={() => void me.refetch()} />;
  if (me.data.emailVerified) return <Navigate to="/pedidos" replace />;

  const locked = countdown.seconds > 0;

  return (
    <div className={classes.page}>
      <div className={classes.column}>
        <span className={access.eyebrowWarn}>Painel bloqueado</span>
        <h1 className={classes.title}>Confirme o e-mail da loja</h1>
        <p className={classes.lead}>
          Enviamos um link de confirmação para o endereço abaixo. Até ele ser aberto, nenhuma tela do
          painel carrega — nem os pedidos.
        </p>

        <section className={classes.card}>
          <span className={classes.label}>Endereço cadastrado</span>
          <strong className={classes.email}>{me.data.email}</strong>
          <Button
            variant="default"
            disabled={locked}
            loading={resend.isPending}
            onClick={() => resend.mutate()}
          >
            {locked ? `Reenviar em ${formatCountdown(countdown.seconds)}` : "Não recebi, reenviar"}
          </Button>
          {locked && (
            <Notice tone="warn">
              Aguarde um instante: são no máximo 3 reenvios por minuto. O último link continua valendo.
            </Notice>
          )}
          {sent && !locked && (
            <p className={access.success}>Link reenviado. Confira também a caixa de spam.</p>
          )}
          {resend.isError && !locked && (
            <p role="alert" className={access.error}>
              {describeError(resend.error)}
            </p>
          )}
        </section>

        <section className={classes.wrong}>
          <strong>O endereço está errado?</strong>
          <p>
            Não é possível trocar o e-mail pelo painel. Duas saídas: falar com o suporte, ou aguardar
            7 dias — nesse prazo o cadastro é liberado automaticamente e você entra sem confirmar.
          </p>
          <div className={classes.actions}>
            {SUPPORT_URL && (
              <Button
                component="a"
                href={SUPPORT_URL}
                target="_blank"
                rel="noreferrer"
                variant="default"
                rightSection={<IconArrowUpRight size={16} />}
              >
                Falar com o suporte
              </Button>
            )}
            <Button
              variant="subtle"
              loading={logoutMutation.isPending}
              onClick={() => logoutMutation.mutate()}
            >
              Sair da conta
            </Button>
          </div>
        </section>

        <p className={classes.footer}>
          Já confirmou em outra aba?{" "}
          <button type="button" className={access.link} onClick={() => void me.refetch()}>
            Verificar de novo
          </button>
        </p>
      </div>
    </div>
  );
}
