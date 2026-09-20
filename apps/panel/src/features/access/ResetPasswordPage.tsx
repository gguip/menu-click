import { Button, PasswordInput } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { resetPassword } from "../../api/auth.ts";
import { ApiError, describeError } from "../../api/client.ts";
import { Notice } from "../../ui/Notice.tsx";
import classes from "./access.module.css";
import { AuthLayout } from "./AuthLayout.tsx";
import { checkPassword } from "./password.ts";

const EXPIRED = "Link expirado ou já usado: peça outro na etapa 1. Cada link vale uma vez.";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => resetPassword(token, password),
    // A API não devolve sessão no reset, de propósito (S30), e a página só
    // conhece o token: quem recuperou entra pelo login. Por isso o CTA é
    // "Salvar nova senha", e não o "Salvar e entrar" do handoff.
    onSuccess: () => navigate("/login?motivo=senha-trocada", { replace: true }),
  });

  // Com as regras de senha conferidas na tela, 400 do servidor só pode ser o
  // link: vencido, já usado ou inexistente.
  const linkDead =
    token === "" || (mutation.error instanceof ApiError && mutation.error.status === 400);

  return (
    <AuthLayout>
      <span className={classes.eyebrow}>Etapa 2 — pelo link do e-mail</span>
      <h1 className={classes.title}>Definir nova senha</h1>
      <p className={classes.subtitle}>
        O link carrega o código de uso único. Abrindo daqui, a tela já sabe de quem é a conta.
      </p>
      {linkDead && <Notice tone="warn">{EXPIRED}</Notice>}
      <form
        className={classes.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const problem =
            checkPassword(password) ?? (password !== repeat ? "As duas senhas não conferem." : null);
          setLocalError(problem);
          if (problem === null && token !== "") mutation.mutate();
        }}
      >
        <PasswordInput
          label="Nova senha"
          size="md"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <PasswordInput
          label="Repita a nova senha"
          size="md"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.currentTarget.value)}
        />
        {localError && (
          <p role="alert" className={classes.error}>
            {localError}
          </p>
        )}
        {mutation.isError && !linkDead && (
          <p role="alert" className={classes.error}>
            {describeError(mutation.error)}
          </p>
        )}
        <Button type="submit" fullWidth h={44} fz={15} loading={mutation.isPending}>
          Salvar nova senha
        </Button>
      </form>
      <div className={classes.links}>
        <Link to="/esqueci-senha">Pedir outro link</Link>
      </div>
    </AuthLayout>
  );
}
