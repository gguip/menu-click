import { Button, Modal } from "@mantine/core";
import type { ReactNode } from "react";
import buttons from "./buttons.module.css";
import classes from "./ConfirmDialog.module.css";
import type { ConfirmCopy } from "./confirmCopy.ts";

export function ConfirmDialog({
  copy,
  busy = false,
  onConfirm,
  onClose,
  children,
}: {
  copy: ConfirmCopy | null;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Campo extra entre o texto e os botões (o motivo do cancelamento). */
  children?: ReactNode;
}) {
  return (
    <Modal
      opened={copy !== null}
      onClose={onClose}
      title={copy?.title}
      centered
      size={460}
      radius="md"
      // Enquanto `busy` (mutação em voo), o modal não fecha por nenhum
      // caminho — Esc, clique fora ou X abririam uma segunda confirmação
      // em cima de uma chamada que já está a caminho.
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      withCloseButton={!busy}
      classNames={{ title: classes.title, overlay: classes.overlay }}
    >
      {copy && (
        <div className={classes.body}>
          <p className={classes.text}>{copy.body}</p>
          {copy.warn && <p className={classes.warn}>{copy.warn}</p>}
          {children}
          <div className={classes.actions}>
            <Button variant="default" h={40} disabled={busy} onClick={onClose}>
              Voltar
            </Button>
            <Button
              h={40}
              className={copy.tone === "danger" ? buttons.danger : undefined}
              loading={busy}
              onClick={onConfirm}
            >
              {copy.cta}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
