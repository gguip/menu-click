import { Button, PasswordInput, TextInput } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { login } from "../../api/auth.ts";
import { describeError } from "../../api/client.ts";
import { saveSession } from "../../api/session.ts";
import { Notice } from "../../ui/Notice.tsx";
import classes from "./access.module.css";
import { AuthLayout } from "./AuthLayout.tsx";

// `?motivo=` explica por que a pessoa caiu no login.
const NOTICES: Record<string, { tone: "warn" | "accent"; title: string; body: string }> = {
  "sessao-expirada": {
    tone: "warn",
    title: "Sua sessão expirou",
    body: "Entre de novo para continuar. Nada do que estava na tela foi enviado; os pedidos seguem registrados no servidor.",
  },
  "email-confirmado": { tone: "accent", title: "E-mail confirmado", body: "Entre para abrir o painel." },
  "senha-trocada": { tone: "accent", title: "Senha trocada", body: "Entre com a nova senha." },
  "conta-criada": {
    tone: "accent",
    title: "Loja criada",
    body: "Entre com o e-mail e a senha que você cadastrou.",
  },
  "loja-removida": {
    tone: "warn",
    title: "Restaurante removido",
    body: "A loja e o cardápio público saíram do ar. Se isso foi engano, fale com o suporte.",
  },
};

function LoginAside() {
  return (
    <>
      <span className={classes.eyebrow}>Antes de abrir</span>
      <p className={classes.asideLead}>
        Se o e-mail da loja ainda não foi confirmado, o painel inteiro fica bloqueado.
      </p>
      <p className={classes.asideBody}>
        Depois de entrar, o app checa a verificação antes de tentar carregar pedidos — e leva direto
        para a tela de confirmação, sem erro genérico.
      </p>
    </>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => login(email.trim(), password),
    onSuccess: (session) => {
      saveSession(session);
      // nada de uma sessão anterior pode aparecer na nova
      queryClient.clear();
      navigate("/pedidos", { replace: true });
    },
  });

  const notice = NOTICES[params.get("motivo") ?? ""];

  return (
    <AuthLayout aside={<LoginAside />}>
      <h1 className={classes.title}>Entrar</h1>
      <p className={classes.subtitle}>Acesso do dono e da equipe do restaurante.</p>
      {notice && (
        <Notice tone={notice.tone} title={notice.title}>
          {notice.body}
        </Notice>
      )}
      <form
        className={classes.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim() === "" || password === "") {
            setLocalError("Preencha e-mail e senha.");
            return;
          }
          setLocalError(null);
          mutation.mutate();
        }}
      >
        <TextInput
          label="E-mail"
          type="email"
          size="md"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <PasswordInput
          label="Senha"
          size="md"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        {localError && (
          <p role="alert" className={classes.error}>
            {localError}
          </p>
        )}
        {mutation.isError && (
          <p role="alert" className={classes.error}>
            {describeError(mutation.error)}
          </p>
        )}
        <Button type="submit" fullWidth h={46} fz={15} loading={mutation.isPending}>
          Entrar
        </Button>
      </form>
      <div className={classes.links}>
        <Link to="/esqueci-senha">Esqueci a senha</Link>
        <Link to="/cadastro">Criar conta da loja</Link>
      </div>
    </AuthLayout>
  );
}
