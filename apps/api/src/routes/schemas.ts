import { SLUG_MAX_LENGTH } from "../domain/slug.ts";
import { SELECTABLE_DELIVERY_FEE_MODES } from "../domain/delivery.ts";

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

// ===================== Restaurante =====================
// Ficam aqui (e não em `routes/restaurants.ts`) porque o cadastro
// (`POST /auth/register`) cria o restaurante junto com o primeiro usuário e
// precisa exatamente do mesmo contrato de entrada e de saída (F11).

/**
 * Nome IANA do fuso. O `pattern` só barra o obviamente errado (espaço, caixa
 * alta solta); saber se o fuso **existe** é com o sistema operacional, e essa
 * checagem mora no serviço, que responde 400.
 */
const timezoneSchema = {
  type: "string",
  pattern: "^[A-Za-z][A-Za-z0-9+_-]*(?:/[A-Za-z0-9+_-]+)*$",
  maxLength: 64,
};

export const createRestaurantBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "cuisineType",
    "address",
    "isDelivery",
    "isTakeaway",
    "isQrcode",
  ],
  properties: {
    name: { type: "string", minLength: 1 },
    // opcional: sem ele o serviço deriva do nome. O `pattern` é o mesmo do
    // `isSlug` do domínio — o que entra aqui vira URL pública.
    slug: {
      type: "string",
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      maxLength: SLUG_MAX_LENGTH,
    },
    cuisineType: { type: "string", minLength: 1 },
    logoUrl: { type: "string", format: "uri" },
    address: addressSchema,
    isDelivery: { type: "boolean" },
    // simétrico ao isDelivery: sem ele, todo restaurante aceitaria retirada
    isTakeaway: { type: "boolean" },
    isQrcode: { type: "boolean" },
    // opcional: sem ele vale o default da coluna (America/Sao_Paulo)
    timezone: timezoneSchema,
    // as quatro formas de pagamento: opcionais, sem elas vale o default da
    // coluna (true nas três primeiras, false no vale-refeição)
    acceptsCash: { type: "boolean" },
    acceptsCardOnDelivery: { type: "boolean" },
    acceptsPix: { type: "boolean" },
    acceptsMealVoucher: { type: "boolean" },
  },
};

export const updateRestaurantBodySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1 },
    cuisineType: { type: "string", minLength: 1 },
    logoUrl: { type: "string", format: "uri" },
    address: addressSchema,
    isDelivery: { type: "boolean" },
    // simétrico ao isDelivery: sem ele, todo restaurante aceitaria retirada
    isTakeaway: { type: "boolean" },
    isQrcode: { type: "boolean" },
    // editável, ao contrário do slug: mudar o fuso não quebra QR code impresso
    timezone: timezoneSchema,
    // a pausa manual. Só aparece aqui e na resposta, nunca no corpo de
    // criação: restaurante nasce aceitando pedidos, e oferecer o campo no
    // cadastro convidaria a criar uma loja já pausada.
    acceptingOrders: { type: "boolean" },
    // as quatro formas de pagamento: editáveis a qualquer momento
    acceptsCash: { type: "boolean" },
    acceptsCardOnDelivery: { type: "boolean" },
    acceptsPix: { type: "boolean" },
    acceptsMealVoucher: { type: "boolean" },
    // configurar frete é ato posterior ao cadastro, então só entra aqui —
    // nunca no corpo de criação. `enum` restrito a SELECTABLE_..., não ao
    // DELIVERY_FEE_MODES inteiro: o banco aceita `distance`, mas a Parte 1
    // não implementa (sem faixa de km ele não calcula nada).
    deliveryFeeMode: { type: "string", enum: [...SELECTABLE_DELIVERY_FEE_MODES] },
    deliveryFixedFeeInCents: { type: "integer", minimum: 0 },
    // nulo/ausente = a promoção "grátis acima de X" não existe
    // `nullable: true` (F12, não `anyOf`) para a promoção poder ser DESLIGADA.
    // Sem isto ela é de mão única: a loja que rodou "grátis acima de R$ 50"
    // não teria como voltar atrás, e a tentativa natural (`null`) só não
    // gravava 0 — "grátis acima de zero", sempre grátis — porque o validador
    // estrito passou a recusar. Aqui o `null` é a intenção, e escreve NULL.
    freeDeliveryAboveInCents: { type: "integer", minimum: 0, nullable: true },
    deliveryFeeToArrange: { type: "boolean" },
    // zero é "sem mínimo", então desligar não precisa de `nullable`
    minimumOrderInCents: { type: "integer", minimum: 0 },
  },
};

export const restaurantResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    slug: { type: "string" },
    name: { type: "string" },
    cuisineType: { type: "string" },
    logoUrl: { type: "string" },
    address: { type: "object", properties: addressProperties },
    isDelivery: { type: "boolean" },
    // simétrico ao isDelivery: sem ele, todo restaurante aceitaria retirada
    isTakeaway: { type: "boolean" },
    isQrcode: { type: "boolean" },
    timezone: { type: "string" },
    acceptingOrders: { type: "boolean" },
    acceptsCash: { type: "boolean" },
    acceptsCardOnDelivery: { type: "boolean" },
    acceptsPix: { type: "boolean" },
    acceptsMealVoucher: { type: "boolean" },
    // resposta usa a lista completa de modos: um restaurante já configurado
    // por fora (ou numa Parte 2 futura) pode estar em `distance`, e o
    // response schema não pode esconder o estado real do restaurante.
    deliveryFeeMode: { type: "string" },
    deliveryFixedFeeInCents: { type: "integer" },
    freeDeliveryAboveInCents: { type: "integer" },
    deliveryFeeToArrange: { type: "boolean" },
    minimumOrderInCents: { type: "integer" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

