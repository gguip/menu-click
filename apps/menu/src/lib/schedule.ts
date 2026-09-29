import type { MenuRestaurant, OpeningHour } from "./types.ts";

type Status = Pick<MenuRestaurant, "isOpen" | "acceptingOrders" | "closesAt" | "opensAt"> & { timezone?: string };

const DEFAULT_TZ = "America/Sao_Paulo";
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "18h", "23h30" — o formato do handoff. */
export function hourLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":");
  return m === "00" ? `${h}h` : `${h}h${m}`;
}

function localParts(iso: string | number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm: `${get("hour")}:${get("minute")}`,
    weekday: days.indexOf(get("weekday")),
  };
}

/** O chip do topo: pausa ganha de tudo, depois aberta, depois fechada. */
export function openChip(r: Status): { tone: "open" | "closed" | "paused"; text: string } {
  if (!r.acceptingOrders) return { tone: "paused", text: "Pedidos pausados" };
  if (r.isOpen) {
    return r.closesAt
      ? { tone: "open", text: `Aberto até ${hourLabel(localParts(r.closesAt, r.timezone ?? DEFAULT_TZ).hhmm)}` }
      : { tone: "open", text: "Aberto agora" };
  }
  return { tone: "closed", text: "Fechado agora" };
}

/**
 * "Fechado. Abre amanhã às 18h" — a grade é a saída, não o aviso. Sem relógio
 * (`null`: servidor e hidratação) não dá para dizer hoje/amanhã, e a manchete
 * não arrisca.
 */
export function closedHeadline(r: Status, nowMs: number | null): string {
  if (!r.opensAt || nowMs === null) return "Fechado agora";
  const tz = r.timezone ?? DEFAULT_TZ;
  const opens = localParts(r.opensAt, tz);
  const today = localParts(nowMs, tz);
  const tomorrow = localParts(nowMs + 24 * 60 * 60 * 1000, tz);
  const when =
    opens.date === today.date ? "hoje" : opens.date === tomorrow.date ? "amanhã" : WEEKDAYS[opens.weekday];
  return `Fechado. Abre ${when} às ${hourLabel(opens.hhmm)}`;
}

const DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** A grade da semana, da segunda ao domingo, juntando dias iguais seguidos. */
export function weekRows(hours: OpeningHour[]): { days: string; hours: string }[] {
  const text = (weekday: number) => {
    const ranges = hours
      .filter((h) => h.weekday === weekday)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
      .map((h) => `${hourLabel(h.opensAt)} – ${hourLabel(h.closesAt)}`);
    return ranges.length === 0 ? "Fechado" : ranges.join(", ");
  };
  const rows: { first: number; last: number; hours: string }[] = [];
  for (const weekday of WEEK_ORDER) {
    const value = text(weekday);
    const previous = rows[rows.length - 1];
    if (previous && previous.hours === value) previous.last = weekday;
    else rows.push({ first: weekday, last: weekday, hours: value });
  }
  return rows.map((row) => {
    const span = WEEK_ORDER.indexOf(row.last) - WEEK_ORDER.indexOf(row.first);
    const days =
      span === 0
        ? DAY_NAMES[row.first]
        : span === 1
          ? `${DAY_NAMES[row.first]} e ${DAY_NAMES[row.last].toLowerCase()}`
          : `${DAY_NAMES[row.first]} a ${DAY_NAMES[row.last].toLowerCase()}`;
    return { days, hours: row.hours };
  });
}
