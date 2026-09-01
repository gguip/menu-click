/**
 * O recorte de tempo do painel. Só tipos e a lista de nomes.
 *
 * Todo período aqui é resolvido **no fuso do restaurante** (ver `timezone.ts`),
 * nunca em UTC nem no fuso do servidor: "pedidos de hoje" tem que significar o
 * dia de quem está no salão, não o do processo que atende a requisição.
 */

/** Os atalhos que o painel oferece como botão. */
export const ORDER_PERIODS = [
  "today",
  "yesterday",
  "last7days",
  "thisMonth",
] as const;

export type OrderPeriod = (typeof ORDER_PERIODS)[number];

/**
 * O período pedido: ou um atalho nomeado, ou um intervalo de datas.
 *
 * São duas formas do mesmo conceito porque atendem a dois controles diferentes
 * na tela — os botões ("Hoje", "Ontem") e o seletor de datas. Misturar as duas
 * na mesma requisição é 400: não há resposta certa para "hoje, de 1 a 5 de
 * agosto".
 */
export type PeriodFilter =
  | { kind: "named"; name: OrderPeriod }
  /**
   * Datas locais (`YYYY-MM-DD`), não instantes. O intervalo é **fechado nos
   * dois lados**: `from=2026-09-01&to=2026-09-01` é aquele dia inteiro, que é
   * o que alguém quer dizer ao escolher a mesma data duas vezes num seletor.
   */
  | { kind: "range"; from?: string; to?: string };
