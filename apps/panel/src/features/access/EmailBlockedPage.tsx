import { Button, PasswordInput, TextInput } from "@mantine/core";
import { IconArrowUpRight } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Navigate } from "react-router";
import { changeEmail, resendVerification } from "../../api/auth.ts";
import { ApiError, describeError } from "../../api/client.ts";
import { LoadFailure, NeutralScreen } from "../../auth/ScreenStates.tsx";
import { useLogout } from "../../auth/useLogout.ts";
import { meQueryKey, useMe } from "../../auth/useMe.ts";
import { formatCountdown } from "../../lib/time.ts";
import { useCountdown } from "../../lib/useCountdown.ts";
import { Notice } from "../../ui/Notice.tsx";
import access from "./access.module.css";
import classes from "./EmailBlockedPage.module.css";

const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL;

/**
 * O 429 se explica pela contagem no botão, e só enquanto ela corre: o texto
 * "aguarde" ao lado de um botão já liberado se contradiz.
 */
function isRateLimit(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

/**
 * Sem rail e sem header: o painel está bloqueado, e mostrar a navegação
 * desabilitada só frustra. Endereço errado se corrige aqui mesmo, com a senha
 * da conta — a API só aceita a troca enquanto a loja não foi verificada.
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

  const queryClient = useQueryClient();
  // Contagem própria: o teto da correção é outro, e travar o reenvio por causa
  // dela esconderia o botão que ainda funciona.
  const correctionCountdown = useCountdown();
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  // Ref, e não `correction.isPending`: duas submissões no mesmo tique (clique
  // duplo) leem o mesmo render, e as duas veriam `isPending` falso.
  const submitting = useRef(false);

  const correction = useMutation({
    mutationFn: () => changeEmail(currentPassword, newEmail.trim()),
    onSuccess: async () => {
      setNewEmail("");
      setCurrentPassword("");
      // o reenvio aceito antes era para o endereço antigo
      setSent(false);
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      if (error.status === 429) {
        correctionCountdown.start(error.retryAfterSeconds ?? 60);
      }
      // 409 pode ser a loja já verificada em outra aba: reler o `me` tira a
      // pessoa desta tela, em vez de deixá-la presa numa recusa
      if (error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: meQueryKey });
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  if (me.isPending) return <NeutralScreen />;
  if (me.isError) return <LoadFailure onRetry={() => void me.refetch()} />;
  if (me.data.emailVerified) return <Navigate to="/pedidos" replace />;

  const locked = countdown.seconds > 0;
  const correctionLocked = correctionCountdown.seconds > 0;

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
          {resend.isError && !isRateLimit(resend.error) && (
            <p role="alert" className={access.error}>
              {describeError(resend.error)}
            </p>
          )}
        </section>

        <section className={classes.wrong}>
          <strong>O endereço está errado?</strong>
          <p>
            Corrija aqui: informe o endereço certo e a senha da conta. O link de confirmação vai
            para o endereço novo, e o anterior deixa de valer.
          </p>
          <form
            className={classes.form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              // submissão repetida (clique duplo, Enter duas vezes) não sai
              if (submitting.current || correctionLocked) return;
              const missing = newEmail.trim() === "" || currentPassword === "";
              setIncomplete(missing);
              if (missing) return;
              submitting.current = true;
              correction.mutate();
            }}
          >
            <TextInput
              label="E-mail correto"
              type="email"
              autoComplete="email"
              value={newEmail}
              disabled={correction.isPending}
              onChange={(event) => setNewEmail(event.currentTarget.value)}
            />
            <PasswordInput
              label="Senha atual"
              autoComplete="current-password"
              value={currentPassword}
              disabled={correction.isPending}
              onChange={(event) => setCurrentPassword(event.currentTarget.value)}
            />
            {incomplete && (
              <p role="alert" className={access.error}>
                Informe o e-mail correto e a senha atual.
              </p>
            )}
            {correction.isError && !incomplete && !isRateLimit(correction.error) && (
              <p role="alert" className={access.error}>
                {describeError(correction.error)}
              </p>
            )}
            {correction.isSuccess && !incomplete && (
              <p className={access.success}>
                E-mail corrigido. Enviamos o link de confirmação para o endereço novo.
              </p>
            )}
            <div className={classes.actions}>
              <Button type="submit" disabled={correctionLocked} loading={correction.isPending}>
                {correctionLocked
                  ? `Tentar de novo em ${formatCountdown(correctionCountdown.seconds)}`
                  : "Corrigir e-mail"}
              </Button>
            </div>
          </form>
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
