/**
 * Schema de resposta de erro, compartilhado pelas rotas.
 *
 * Todo corpo de erro da API tem esta forma — é o que o error handler central do
 * `app.ts` envia para 404/409 e para o 500 genérico. Declarar isso em
 * `schema.response` não é só performance: o `fast-json-stringify` só serializa
 * os campos aqui listados, então nada extra vaza junto (S10/F10).
 */
export const errorResponseSchema = {
  type: "object",
  properties: {
    statusCode: { type: "integer" },
    error: { type: "string" },
    message: { type: "string" },
  },
};
