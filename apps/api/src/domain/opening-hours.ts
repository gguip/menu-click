/**
 * O horário de funcionamento — as faixas em que o restaurante aceita pedido.
 * Só tipos, mais a lista de dias.
 *
 * Um dia pode ter várias faixas (a pausa entre almoço e jantar), e **dia sem
 * faixa é dia fechado**: a ausência é a informação, e uma flag de "fechado"
 * permitiria o estado incoerente de "fechado, das 11 às 15".
 */

/**
 * 0 = domingo … 6 = sábado.
 *
 * A numeração é a do `extract(dow from ...)` do Postgres, e não a do
 * JavaScript por acaso — as duas coincidem, mas quem manda aqui é o banco,
 * porque é lá que "está aberto agora?" é calculado.
 */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** Uma faixa como o cliente a envia. Horas em `HH:MM`, no fuso do restaurante. */
export type OpeningHourInput = {
  weekday: Weekday;
  opensAt: string;
  closesAt: string;
};

/**
 * Uma faixa como está guardada.
 *
 * `closesAt` menor que `opensAt` significa que a faixa **atravessa a
 * meia-noite** — 18:00–02:00 é a pizzaria que atende até as duas. Não é erro
 * de digitação, e é por isso que só a igualdade entre as duas é proibida.
 */
export type OpeningHour = OpeningHourInput & {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
};
