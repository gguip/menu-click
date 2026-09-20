import type { ReactNode } from "react";
import classes from "./AuthLayout.module.css";

export function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className={classes.page}>
      <main className={classes.main}>
        <div className={classes.column}>
          <p className={classes.brand}>Painel da loja</p>
          {children}
        </div>
      </main>
      {aside !== undefined && <aside className={classes.aside}>{aside}</aside>}
    </div>
  );
}
