import { Button, Modal } from "@mantine/core";
import buttons from "./buttons.module.css";
import classes from "./ConfirmDialog.module.css";
import type { ConfirmCopy } from "./confirmCopy.ts";

export function ConfirmDialog({
  copy,
  busy = false,
  onConfirm,
  onClose,
}: {
  copy: ConfirmCopy | null;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={copy !== null}
      onClose={onClose}
      title={copy?.title}
      centered
      size={460}
      radius="md"
      classNames={{ title: classes.title, overlay: classes.overlay }}
    >
      {copy && (
        <div className={classes.body}>
          <p className={classes.text}>{copy.body}</p>
          {copy.warn && <p className={classes.warn}>{copy.warn}</p>}
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
