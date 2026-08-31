/**
 * Tipos de paginação compartilhados pelas três camadas — só tipos, sem runtime
 * (os limites numéricos são contrato HTTP e moram em `routes/schemas.ts`).
 */

/** O que a rota já resolveu a partir da querystring. */
export type Pagination = {
  limit: number;
  offset: number;
};

/** Uma página de resultados, como a API responde. */
export type Page<T> = {
  data: T[];
  limit: number;
  offset: number;
  total: number;
};
