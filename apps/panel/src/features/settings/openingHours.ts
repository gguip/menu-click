import type { OpeningHour } from "../../api/types.ts";

export type Range = { opensAt: string; closesAt: string };
export type Day = { weekday: number; label: string; ranges: Range[] };

/**
 * A API numera `0 = domingo` (é o `dow` do Postgres) e a tela mostra a semana
 * começando na segunda, como o handoff. A conversão mora AQUI, num lugar só.
 */
export const WEEK: readonly { weekday: number; label: string }[] = [
  { weekday: 1, label: "Segunda" },
  { weekday: 2, label: "Terça" },
  { weekday: 3, label: "Quarta" },
  { weekday: 4, label: "Quinta" },
  { weekday: 5, label: "Sexta" },
  { weekday: 6, label: "Sábado" },
  { weekday: 0, label: "Domingo" },
];

export function fromApi(hours: readonly OpeningHour[]): Day[] {
  return WEEK.map((day) => ({
    weekday: day.weekday,
    label: day.label,
    ranges: hours
      .filter((hour) => hour.weekday === day.weekday)
      .map((hour) => ({ opensAt: hour.opensAt, closesAt: hour.closesAt })),
  }));
}

/** Dia sem faixa some do corpo: é assim que ele fica fechado. */
export function toApi(days: readonly Day[]): { weekday: number; opensAt: string; closesAt: string }[] {
  return days.flatMap((day) =>
    day.ranges.map((range) => ({
      weekday: day.weekday,
      opensAt: range.opensAt,
      closesAt: range.closesAt,
    })),
  );
}

function sortedApi(days: readonly Day[]) {
  return toApi(days)
    .slice()
    .sort(
      (a, b) =>
        a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt) || a.closesAt.localeCompare(b.closesAt),
    );
}

/**
 * Compara duas grades sem depender de ordem: a API devolve as faixas
 * ordenadas por `opens_at`, mas o estado da tela nasce na ordem em que a
 * pessoa acrescentou. Os dois lados passam pela mesma normalização
 * (`toApi` + a mesma ordenação) antes de comparar.
 */
export function sameGrade(a: readonly Day[], b: readonly Day[]): boolean {
  return JSON.stringify(sortedApi(a)) === JSON.stringify(sortedApi(b));
}

function mapDay(days: readonly Day[], weekday: number, change: (ranges: Range[]) => Range[]): Day[] {
  return days.map((day) => (day.weekday === weekday ? { ...day, ranges: change([...day.ranges]) } : day));
}

export function addRange(days: readonly Day[], weekday: number): Day[] {
  return mapDay(days, weekday, (ranges) => [...ranges, { opensAt: "", closesAt: "" }]);
}

export function removeRange(days: readonly Day[], weekday: number, index: number): Day[] {
  return mapDay(days, weekday, (ranges) => ranges.filter((_range, position) => position !== index));
}

export function setRangeTime(
  days: readonly Day[],
  weekday: number,
  index: number,
  field: "opensAt" | "closesAt",
  value: string,
): Day[] {
  return mapDay(days, weekday, (ranges) =>
    ranges.map((range, position) => (position === index ? { ...range, [field]: value } : range)),
  );
}

/** `18:00–02:00` é a pizzaria que atende até as duas: normal, não erro. */
export function crossesMidnight(range: Range): boolean {
  if (range.opensAt === "" || range.closesAt === "") return false;
  return range.closesAt < range.opensAt;
}

export function daySummary(day: Day): string {
  if (day.ranges.length === 0) return "Fechado";
  return day.ranges.length === 1 ? "Aberto" : `${day.ranges.length} faixas`;
}

/**
 * Só o que a API recusa. O banco tem UM check (`opens_at <> closes_at`);
 * sobreposição entre faixas do mesmo dia ela aceita, então a tela não a
 * proíbe — regra fantasma é pior que regra nenhuma.
 */
export function validate(days: readonly Day[]): string | null {
  for (const day of days) {
    const name = day.label.toLocaleLowerCase("pt-BR");
    for (const range of day.ranges) {
      if (range.opensAt === "" || range.closesAt === "") {
        return `Preencha as duas horas da faixa de ${name}.`;
      }
      if (range.opensAt === range.closesAt) {
        return `A faixa de ${name} começa e termina no mesmo horário.`;
      }
    }
  }
  return null;
}
