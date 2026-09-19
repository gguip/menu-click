import { Button } from "@mantine/core";
import classes from "./ScreenStates.module.css";

/** Enquanto a sessão carrega: nada — sem skeleton pulsante (handoff). */
export function NeutralScreen() {
  return <div className={classes.neutral} aria-busy="true" />;
}

export function LoadFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={classes.failure}>
      <p>Não foi possível carregar o painel.</p>
      <Button variant="default" onClick={onRetry}>
        Tentar de novo
      </Button>
    </div>
  );
}
