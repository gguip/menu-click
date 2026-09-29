import type { Restaurant } from "../../api/types.ts";

/**
 * O texto do topo do rail. O painel FORMATA o que a API calculou (no fuso da
 * loja); nenhuma regra de faixa mora aqui. Pausa ganha de tudo: é a condição
 * que a pessoa escolheu agora.
 */
export function storeStatusLabel(
  restaurant: Pick<Restaurant, "acceptingOrders" | "openingStatus" | "timezone">,
  nowMs: number,
): { text: string; noSchedule: boolean } {
  if (!restaurant.acceptingOrders) return { text: "Pausada agora", noSchedule: false };
  const status = restaurant.openingStatus;
  if (status === undefined) return { text: "Aceitando pedidos", noSchedule: false };

  const clock = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: restaurant.timezone }).format(
      new Date(iso),
    );
  const day = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: restaurant.timezone }).format(new Date(ms));
  const weekday = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: restaurant.timezone })
      .format(new Date(iso))
      .replace(".", "");

  if (status.isOpen) {
    return { text: status.closesAt ? `Aberta · fecha ${clock(status.closesAt)}` : "Aberta", noSchedule: false };
  }
  if (status.opensAt === undefined) return { text: "Fechada · sem horário cadastrado", noSchedule: true };
  const sameDay = day(Date.parse(status.opensAt)) === day(nowMs);
  return {
    text: sameDay
      ? `Fechada · abre ${clock(status.opensAt)}`
      : `Fechada · abre ${weekday(status.opensAt)} ${clock(status.opensAt)}`,
    noSchedule: false,
  };
}

/** A resposta do PATCH não traz `openingStatus`: guardá-la crua apagaria o status do rail. */
export function keepOpeningStatus(previous: Restaurant | undefined, next: Restaurant): Restaurant {
  return next.openingStatus === undefined && previous?.openingStatus !== undefined
    ? { ...next, openingStatus: previous.openingStatus }
    : next;
}
