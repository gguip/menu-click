import { Button } from "@mantine/core";
import { useEffect } from "react";
import { Link, useBlocker } from "react-router";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import classes from "./SaveBar.module.css";
import { LEAVE_WITHOUT_ASKING, leavesWithoutAsking } from "./unsavedChanges.ts";

/**
 * Barra fixa de salvar. Em telas que são uma página só (Horário, Dados da
 * loja) cancelar DESCARTA as alterações; no formulário de produto ele volta
 * para a listagem — daí o cancelamento ser link ou botão.
 *
 * Com `dirty`, sair da tela pergunta antes: troca de rota pelo `useBlocker`, e
 * recarregar ou fechar a aba pelo `beforeunload` (o texto desse é do
 * navegador). Saída marcada com `LEAVE_WITHOUT_ASKING` passa direto.
 */
export function SaveBar({
  dirty,
  busy = false,
  saveLabel,
  onSave,
  cancel,
}: {
  dirty: boolean;
  busy?: boolean;
  saveLabel: string;
  onSave: () => void;
  cancel: { to: string } | { onClick: () => void };
}) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      currentLocation.pathname !== nextLocation.pathname &&
      !leavesWithoutAsking(nextLocation.state),
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div className={classes.saveBar}>
      {dirty && <span className={classes.dirty}>Alterações não salvas</span>}
      {busy ? (
        // salvando: cancelar desfaria a tela, e o salvar chegaria do mesmo jeito
        <Button variant="default" disabled>
          Cancelar
        </Button>
      ) : "to" in cancel ? (
        <Button component={Link} to={cancel.to} state={LEAVE_WITHOUT_ASKING} variant="default">
          Cancelar
        </Button>
      ) : (
        <Button variant="default" onClick={cancel.onClick}>
          Cancelar
        </Button>
      )}
      <Button loading={busy} onClick={onSave}>
        {saveLabel}
      </Button>
      <ConfirmDialog
        copy={
          blocker.state === "blocked"
            ? {
                title: "Sair sem salvar?",
                body: "As alterações desta tela ainda não foram salvas.",
                cta: "Sair sem salvar",
                tone: "danger",
              }
            : null
        }
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
    </div>
  );
}
