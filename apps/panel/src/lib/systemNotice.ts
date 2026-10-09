/**
 * O aviso do sistema operacional: aparece com o painel atrás de outra janela,
 * que é como ele passa o dia. Só existe com o painel aberto em alguma aba —
 * não há service worker nem push de servidor.
 */
export type NoticePermission = NotificationPermission | "unsupported";

export function noticePermission(): NoticePermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Chamar DENTRO de um clique: o navegador recusa o pedido sem gesto. */
export async function requestNoticePermission(): Promise<NoticePermission> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Devolve se o aviso saiu. Clicar nele traz a janela do painel para a frente. */
export function showSystemNotice(title: string, onClick?: () => void): boolean {
  if (noticePermission() !== "granted") return false;
  try {
    const notice = new Notification(title);
    notice.onclick = () => {
      window.focus();
      notice.close();
      onClick?.();
    };
    return true;
  } catch {
    // o Chrome do Android só aceita aviso por service worker, e estoura aqui
    return false;
  }
}
