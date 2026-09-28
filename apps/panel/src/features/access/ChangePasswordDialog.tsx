import { Button, Modal, PasswordInput } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { changePassword } from "../../api/auth.ts";
import { ApiError, describeError } from "../../api/client.ts";
import classes from "./ChangePasswordDialog.module.css";
import { checkPassword } from "./password.ts";

function localProblem(current: string, next: string, repeat: string): string | null {
  if (current === "") return "Informe a senha atual.";
  const problem = checkPassword(next);
  if (problem !== null) return problem;
  if (next !== repeat) return "As duas senhas não conferem.";
  if (next === current) return "A nova senha é igual à atual.";
  return null;
}

/**
 * A senha provisória do convite promete "ela troca depois, no menu da conta":
 * é aqui. A API exige a senha atual mesmo com sessão (S31) e, ao trocar,
 * derruba as OUTRAS sessões — a tela diz isso, senão o efeito é invisível.
 */
export function ChangePasswordDialog({
  email,
  opened,
  onClose,
}: {
  email: string;
  opened: boolean;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: () => changePassword(current, next) });
  const busy = mutation.isPending;

  // 401 desta rota é a senha atual errada, e o erro vai no campo dela.
  const wrongCurrent =
    mutation.error instanceof ApiError && mutation.error.status === 401 ? mutation.error.message : null;

  function close() {
    setCurrent("");
    setNext("");
    setRepeat("");
    setLocalError(null);
    mutation.reset();
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={close}
      title="Trocar senha"
      centered
      size={460}
      radius="md"
      // Mesma trava do ConfirmDialog: com a troca em voo, nada fecha o modal.
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      withCloseButton={!busy}
      classNames={{ title: classes.title, overlay: classes.overlay }}
    >
      {mutation.isSuccess ? (
        <div className={classes.body}>
          <p className={classes.done}>Senha trocada.</p>
          <p className={classes.text}>
            As outras sessões desta conta foram encerradas; este aparelho continua conectado.
          </p>
          <div className={classes.actions}>
            <Button h={40} onClick={close}>
              Fechar
            </Button>
          </div>
        </div>
      ) : (
        <form
          className={classes.body}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const problem = localProblem(current, next, repeat);
            setLocalError(problem);
            if (problem === null) mutation.mutate();
          }}
        >
          {/* O gerenciador de senhas precisa saber de QUAL conta é a senha nova. */}
          <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
          <PasswordInput
            label="Senha atual"
            autoComplete="current-password"
            value={current}
            disabled={busy}
            error={wrongCurrent}
            onChange={(event) => setCurrent(event.currentTarget.value)}
          />
          <PasswordInput
            label="Nova senha"
            autoComplete="new-password"
            value={next}
            disabled={busy}
            onChange={(event) => setNext(event.currentTarget.value)}
          />
          <PasswordInput
            label="Repita a nova senha"
            autoComplete="new-password"
            value={repeat}
            disabled={busy}
            onChange={(event) => setRepeat(event.currentTarget.value)}
          />
          {localError && (
            <p role="alert" className={classes.error}>
              {localError}
            </p>
          )}
          {mutation.isError && wrongCurrent === null && (
            <p role="alert" className={classes.error}>
              {describeError(mutation.error)}
            </p>
          )}
          <div className={classes.actions}>
            <Button variant="default" h={40} disabled={busy} onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" h={40} loading={busy}>
              Salvar nova senha
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
