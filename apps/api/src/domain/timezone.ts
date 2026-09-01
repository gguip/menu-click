/**
 * O fuso do restaurante — o que decide onde começa o "hoje" do painel.
 *
 * É nome IANA (`America/Sao_Paulo`), não offset fixo (`-03:00`), e a diferença
 * não é cosmética: offset não sabe de horário de verão, e o Brasil já mudou o
 * dele por município. Quem sabe disso é o banco de fusos do sistema — o mesmo
 * que o Postgres consulta no `at time zone`.
 */

/** O fuso de quem não informa nada. Decisão de produto: o projeto é brasileiro. */
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/**
 * `true` se o fuso é conhecido pelo sistema.
 *
 * A checagem é tentar construir um formatador e ver se ele reclama, e não
 * comparar com `Intl.supportedValuesOf("timeZone")`, de propósito: aquela lista
 * traz só os nomes canônicos, e recusaria apelidos legítimos como
 * `Brazil/East`, que o Postgres aceita. Recusar um fuso que o banco entende
 * deixaria os dois lados discordando sobre o que existe.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    // RangeError: "Invalid time zone specified"
    return false;
  }
}
