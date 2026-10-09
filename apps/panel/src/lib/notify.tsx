import { notifications } from "@mantine/notifications";
import type { ReactNode } from "react";
import classes from "./notify.module.css";

const VISIBLE_MS = 5000;

const icon = (path: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);
const CHECK = icon("M5 12.5l4.5 4.5L19 7.5");
const BELL = icon("M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 21h4");

function show(title: string, message: string, symbol: ReactNode): void {
  notifications.show({
    title,
    message,
    icon: symbol,
    autoClose: VISIBLE_MS,
    classNames: {
      root: classes.root,
      icon: classes.icon,
      title: classes.title,
      description: classes.description,
      closeButton: classes.close,
    },
  });
}

/** O salvar de um formulário deu certo. Falha não passa por aqui: fica na tela. */
export function notifySaved(): void {
  show("Alterações salvas", "O que você mudou nesta tela foi gravado.", CHECK);
}

export function notifyNewOrder(title: string): void {
  show(title, "Chegou agora. Veja em Pedidos.", BELL);
}
