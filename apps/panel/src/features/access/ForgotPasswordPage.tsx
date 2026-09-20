import { Button, TextInput } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { forgotPassword } from "../../api/auth.ts";
import { ApiError, describeError } from "../../api/client.ts";
import { Notice } from "../../ui/Notice.tsx";
import classes from "./access.module.css";
import { AuthLayout } from "./AuthLayout.tsx";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const mutation = useMutation({ mutationFn: () => forgotPassword(email.trim()) });

  return (
    <AuthLayout>
      <span className={classes.eyebrow}>Etapa 1</span>
      <h1 className={classes.title}>Esqueci a senha</h1>
      <p className={classes.subtitle}>
        Informe o e-mail da conta. A resposta é sempre a mesma, exista a conta ou não — é assim de
        propósito, para não revelar quem tem cadastro.
      </p>
      <form
        className={classes.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim() !== "") mutation.mutate();
        }}
      >
        <TextInput
          label="E-mail"
          type="email"
          size="md"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        {mutation.isSuccess && (
          <Notice tone="accent">
            Se existir uma conta com esse e-mail, o link de redefinição chega em alguns minutos.
            Confira o spam.
          </Notice>
        )}
        {mutation.isError && (
          <p role="alert" className={classes.error}>
            {/* 400 aqui só pode ser formato de e-mail: a API responde 202
                para qualquer endereço bem formado. */}
            {mutation.error instanceof ApiError && mutation.error.status === 400
              ? "Confira o e-mail digitado."
              : describeError(mutation.error)}
          </p>
        )}
        <Button type="submit" fullWidth h={44} fz={15} loading={mutation.isPending}>
          Enviar link
        </Button>
      </form>
      <div className={classes.links}>
        <Link to="/login">Voltar para o login</Link>
      </div>
    </AuthLayout>
  );
}
