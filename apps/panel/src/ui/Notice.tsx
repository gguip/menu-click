import type { ReactNode } from "react";
import classes from "./Notice.module.css";

export function Notice({
  tone,
  title,
  children,
}: {
  tone: "warn" | "accent" | "danger";
  title?: string;
  children?: ReactNode;
}) {
  return (
    // "alert" só para o tone destrutivo (FIX 8): é o único que representa
    // falha de verdade, e "alert" interrompe leitor de tela — usar em todo
    // Notice faria o aviso de "grátis acima de X" interromper alguém do
    // mesmo jeito que "não foi possível carregar os pedidos".
    <div role={tone === "danger" ? "alert" : "status"} className={`${classes.notice} ${classes[tone]}`}>
      {title && <strong className={classes.title}>{title}</strong>}
      {children !== undefined && <div className={classes.body}>{children}</div>}
    </div>
  );
}
