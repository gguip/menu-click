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

// ===================== Paginação =====================

/** Página padrão quando o cliente não pede tamanho. */
export const DEFAULT_LIMIT = 20;
/** Teto de itens por página — impede varredura da tabela numa requisição só. */
export const MAX_LIMIT = 100;

/**
 * Querystring de paginação, compartilhada pelas listagens.
 *
 * `useDefaults` do Ajv preenche `limit`/`offset` quando o cliente não manda,
 * então o handler sempre recebe os dois já resolvidos — não há `?? 20` espalhado
 * pelas rotas. Fora da faixa é 400, não silenciosamente ajustado: um `limit=500`
 * atendido como 100 mentiria sobre o que foi devolvido.
 */
export const paginationQuerystringSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_LIMIT,
      default: DEFAULT_LIMIT,
    },
    offset: { type: "integer", minimum: 0, default: 0 },
  },
};

/**
 * Envelope de listagem: os itens da página mais o suficiente para o cliente
 * saber onde está. `total` é o total de registros **vivos** (soft delete não
 * conta), não o tamanho de `data`.
 */
export function pageResponseSchema(itemSchema: object) {
  return {
    type: "object",
    properties: {
      data: { type: "array", items: itemSchema },
      limit: { type: "integer" },
      offset: { type: "integer" },
      total: { type: "integer" },
    },
  };
}

// ===================== Endereço =====================

/**
 * Campos de um endereço. Compartilhado por restaurantes (endereço da loja) e
 * pedidos (endereço de entrega congelado) — declarar duas vezes seria duas
 * verdades para o mesmo value object (F11).
 */
export const addressProperties = {
  street: { type: "string", minLength: 1 },
  number: { type: "string", minLength: 1 },
  neighborhood: { type: "string", minLength: 1 },
  city: { type: "string", minLength: 1 },
  state: { type: "string", minLength: 1 },
  zipCode: { type: "string", minLength: 1 },
};

/** Endereço como entrada: value object, então quando vem, vem completo. */
export const addressSchema = {
  type: "object",
  additionalProperties: false,
  required: ["street", "number", "neighborhood", "city", "state", "zipCode"],
  properties: addressProperties,
};
