// apps/panel/src/features/settings/times.ts
import type { RestaurantPatch } from "../../api/restaurant.ts";
import type { Restaurant } from "../../api/types.ts";

/** Os tempos como a tela os edita: texto, e vazio é "sem previsão". */
export type TimesForm = { prep: string; min: string; max: string };

type Times = Pick<Restaurant, "prepTimeMinutes" | "deliveryTimeMinMinutes" | "deliveryTimeMaxMinutes">;

const text = (value: number | undefined) => (value === undefined ? "" : String(value));

export function timesFromRestaurant(r: Times): TimesForm {
  return { prep: text(r.prepTimeMinutes), min: text(r.deliveryTimeMinMinutes), max: text(r.deliveryTimeMaxMinutes) };
}

/** `null` = vazio; `NaN` = inválido. */
function minutes(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

const valid = (n: number | null) => n === null || (n >= 1 && n <= 240);

/** A mesma regra da API, para o erro aparecer antes de salvar. */
export function validateTimes(form: TimesForm): string | null {
  const [prep, min, max] = [minutes(form.prep), minutes(form.min), minutes(form.max)];
  if (![prep, min, max].every(valid)) return "Use minutos entre 1 e 240.";
  if ((min === null) !== (max === null)) return "Preencha os dois tempos da entrega, ou deixe os dois vazios.";
  if (min !== null && max !== null && min > max) return "O tempo mínimo da entrega não pode passar do máximo.";
  return null;
}

/** Só o que mudou. A faixa de entrega vai sempre em par — a API exige. */
export function timesPatch(form: TimesForm, initial: TimesForm): RestaurantPatch {
  const patch: RestaurantPatch = {};
  if (form.prep.trim() !== initial.prep) patch.prepTimeMinutes = minutes(form.prep);
  if (form.min.trim() !== initial.min || form.max.trim() !== initial.max) {
    patch.deliveryTimeMinMinutes = minutes(form.min);
    patch.deliveryTimeMaxMinutes = minutes(form.max);
  }
  return patch;
}
