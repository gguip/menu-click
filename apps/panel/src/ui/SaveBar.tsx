import { Button } from "@mantine/core";
import { Link } from "react-router";
import classes from "./SaveBar.module.css";

/**
 * Barra fixa de salvar. Em telas que são uma página só (Horário, Dados da
 * loja) cancelar DESCARTA as alterações; no formulário de produto ele volta
 * para a listagem — daí o cancelamento ser link ou botão.
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
  return (
    <div className={classes.saveBar}>
      {dirty && <span className={classes.dirty}>Alterações não salvas</span>}
      {"to" in cancel ? (
        <Button component={Link} to={cancel.to} variant="default">
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
    </div>
  );
}
