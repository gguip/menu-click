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
    <div role="status" className={`${classes.notice} ${classes[tone]}`}>
      {title && <strong className={classes.title}>{title}</strong>}
      {children !== undefined && <div className={classes.body}>{children}</div>}
    </div>
  );
}
