import { notifications } from "@mantine/notifications";

const VISIBLE_MS = 4000;

/** O salvar de um formulário deu certo. Falha não passa por aqui: fica na tela. */
export function notifySaved(): void {
  notifications.show({ message: "Alterações salvas", autoClose: VISIBLE_MS, withCloseButton: false });
}

export function notifyNewOrder(title: string): void {
  notifications.show({ message: title, autoClose: VISIBLE_MS, withCloseButton: false });
}
