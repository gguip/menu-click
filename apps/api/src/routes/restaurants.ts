import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

// ajv e ajv-formats são pacotes CJS com `export default`. Sob NodeNext +
// verbatimModuleSyntax o import default não fica construível no type-check,
// então carregamos via require (CJS no runtime) e tipamos pelo próprio módulo.
const nodeRequire = createRequire(import.meta.url);
const Ajv = nodeRequire("ajv") as typeof import("ajv")["default"];
const addFormats = nodeRequire(
  "ajv-formats",
) as typeof import("ajv-formats")["default"];

/**
 * Validador estrito usado SÓ nas rotas de produtos (sub-escopo abaixo).
 * Diferença para o padrão do Fastify: `coerceTypes: false`, então uma string
 * como "1500" NÃO é convertida em número — é rejeitada com 400. Isso garante
 * que `priceInCents` só aceite inteiro de verdade. Mantemos `removeAdditional`,
 * `useDefaults` e os formats (uri) para o comportamento ficar igual ao resto.
 */
const strictAjv = new Ajv({
  coerceTypes: false,
  useDefaults: true,
  removeAdditional: true,
  allErrors: false,
});
addFormats(strictAjv);

// ===================== Tipos =====================

/** Endereço de um restaurante. */
type Address = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

/**
 * Campos que o cliente envia para criar um restaurante.
 * `id`, `createdAt` e `updatedAt` NÃO entram aqui — são gerados pelo servidor.
 */
type CreateRestaurantInput = {
  name: string;
  cuisineType: string;
  logoUrl?: string;
  address: Address;
  isDelivery: boolean;
  isQrcode: boolean;
};

/** Edição parcial: qualquer subconjunto dos campos de criação. */
type UpdateRestaurantInput = Partial<CreateRestaurantInput>;

/** Restaurante completo, como é guardado e devolvido na resposta. */
type Restaurant = CreateRestaurantInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Campos que o cliente envia para criar um produto.
 * `restaurantId` vem da rota; `id`/`createdAt`/`updatedAt` são do servidor.
 */
type CreateProductInput = {
  name: string;
  category: string;
  priceInCents: number; // inteiro (centavos) — nunca float
  description?: string;
  photoUrl?: string;
};

/** Edição parcial de produto. */
type UpdateProductInput = Partial<CreateProductInput>;

/** Produto completo, como é guardado e devolvido na resposta. */
type Product = CreateProductInput & {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
};

// ===================== Stores em memória =====================
// Temporários, até plugarmos um banco. Persistem enquanto o processo viver.

const restaurants: Restaurant[] = [];
const products: Product[] = [];

// ===================== JSON Schemas =====================
// Validação da entrada (F9) e serialização da saída (F10).

const addressProperties = {
  street: { type: "string", minLength: 1 },
  number: { type: "string", minLength: 1 },
  neighborhood: { type: "string", minLength: 1 },
  city: { type: "string", minLength: 1 },
  state: { type: "string", minLength: 1 },
  zipCode: { type: "string", minLength: 1 },
};

// Endereço é um "value object": quando enviado, vem completo.
const addressSchema = {
  type: "object",
  additionalProperties: false,
  required: ["street", "number", "neighborhood", "city", "state", "zipCode"],
  properties: addressProperties,
};

const createRestaurantBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "cuisineType", "address", "isDelivery", "isQrcode"],
  properties: {
    name: { type: "string", minLength: 1 },
    cuisineType: { type: "string", minLength: 1 },
    logoUrl: { type: "string", format: "uri" },
    address: addressSchema,
    isDelivery: { type: "boolean" },
    isQrcode: { type: "boolean" },
  },
};

const updateRestaurantBodySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1 },
    cuisineType: { type: "string", minLength: 1 },
    logoUrl: { type: "string", format: "uri" },
    address: addressSchema,
    isDelivery: { type: "boolean" },
    isQrcode: { type: "boolean" },
  },
};

const restaurantResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    cuisineType: { type: "string" },
    logoUrl: { type: "string" },
    address: { type: "object", properties: addressProperties },
    isDelivery: { type: "boolean" },
    isQrcode: { type: "boolean" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const restaurantListResponseSchema = {
  type: "array",
  items: restaurantResponseSchema,
};

// ---- Produtos ----

const createProductBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "category", "priceInCents"],
  properties: {
    name: { type: "string", minLength: 1 },
    category: { type: "string", minLength: 1 },
    priceInCents: { type: "integer", minimum: 0 },
    description: { type: "string" },
    photoUrl: { type: "string", format: "uri" },
  },
};

const updateProductBodySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1 },
    category: { type: "string", minLength: 1 },
    priceInCents: { type: "integer", minimum: 0 },
    description: { type: "string" },
    photoUrl: { type: "string", format: "uri" },
  },
};

const productResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    restaurantId: { type: "string" },
    name: { type: "string" },
    category: { type: "string" },
    priceInCents: { type: "integer" },
    description: { type: "string" },
    photoUrl: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const productListResponseSchema = {
  type: "array",
  items: productResponseSchema,
};

// ---- Params compartilhados ----

const idParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
};

const restaurantIdParamsSchema = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: { type: "string" } },
};

const productParamsSchema = {
  type: "object",
  required: ["restaurantId", "id"],
  properties: {
    restaurantId: { type: "string" },
    id: { type: "string" },
  },
};

const notFoundResponseSchema = {
  type: "object",
  properties: {
    statusCode: { type: "integer" },
    error: { type: "string" },
    message: { type: "string" },
  },
};

// ===================== Helpers de 404 =====================

function restaurantNotFound(reply: FastifyReply, id: string) {
  reply.code(404);
  return {
    statusCode: 404,
    error: "Not Found",
    message: `Restaurante com id "${id}" não encontrado`,
  };
}

function productNotFound(reply: FastifyReply, id: string) {
  reply.code(404);
  return {
    statusCode: 404,
    error: "Not Found",
    message: `Produto com id "${id}" não encontrado`,
  };
}

// ===================== Rotas =====================

/** Rotas do domínio de restaurantes (plugin encapsulado — F2/F4). */
export async function restaurantRoutes(app: FastifyInstance) {
  // Criar
  app.post<{ Body: CreateRestaurantInput }>(
    "/restaurants",
    {
      schema: {
        body: createRestaurantBodySchema,
        response: { 201: restaurantResponseSchema },
      },
    },
    async (request, reply) => {
      const now = new Date().toISOString();
      const restaurant: Restaurant = {
        ...request.body,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      restaurants.push(restaurant);
      reply.code(201);
      return restaurant;
    },
  );

  // Listar todos (array vazio é resposta válida → 200)
  app.get(
    "/restaurants",
    { schema: { response: { 200: restaurantListResponseSchema } } },
    async () => restaurants,
  );

  // Buscar por id
  app.get<{ Params: { id: string } }>(
    "/restaurants/:id",
    {
      schema: {
        params: idParamsSchema,
        response: { 200: restaurantResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const restaurant = restaurants.find((r) => r.id === id);
      if (!restaurant) return restaurantNotFound(reply, id);
      return restaurant;
    },
  );

  // Edição parcial
  app.patch<{ Params: { id: string }; Body: UpdateRestaurantInput }>(
    "/restaurants/:id",
    {
      schema: {
        params: idParamsSchema,
        body: updateRestaurantBodySchema,
        response: { 200: restaurantResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const index = restaurants.findIndex((r) => r.id === id);
      if (index === -1) return restaurantNotFound(reply, id);

      const existing = restaurants[index];
      const updated: Restaurant = {
        ...existing,
        ...request.body,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      restaurants[index] = updated;
      return updated;
    },
  );

  // Remover (cascata: apaga os produtos do restaurante junto)
  app.delete<{ Params: { id: string } }>(
    "/restaurants/:id",
    {
      schema: {
        params: idParamsSchema,
        response: { 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const index = restaurants.findIndex((r) => r.id === id);
      if (index === -1) return restaurantNotFound(reply, id);

      // cascata: remove os produtos que pertencem a este restaurante
      const kept = products.filter((p) => p.restaurantId !== id);
      products.length = 0;
      products.push(...kept);

      restaurants.splice(index, 1);
      return reply.code(204).send();
    },
  );

  // Sub-escopo de produtos, com validador estrito (coercion off) para
  // rejeitar string/float em priceInCents sem afetar as rotas acima.
  await app.register(productRoutes);
}

/** Rotas aninhadas de produtos (escopo com validação estrita). */
async function productRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(({ schema }) => strictAjv.compile(schema as object));

  // Criar produto no restaurante
  app.post<{ Params: { restaurantId: string }; Body: CreateProductInput }>(
    "/restaurants/:restaurantId/products",
    {
      schema: {
        params: restaurantIdParamsSchema,
        body: createProductBodySchema,
        response: { 201: productResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { restaurantId } = request.params;
      if (!restaurants.some((r) => r.id === restaurantId)) {
        return restaurantNotFound(reply, restaurantId);
      }

      const now = new Date().toISOString();
      const product: Product = {
        ...request.body,
        id: randomUUID(),
        restaurantId,
        createdAt: now,
        updatedAt: now,
      };
      products.push(product);
      reply.code(201);
      return product;
    },
  );

  // Listar produtos do restaurante (sem produtos → 200 [])
  app.get<{ Params: { restaurantId: string } }>(
    "/restaurants/:restaurantId/products",
    {
      schema: {
        params: restaurantIdParamsSchema,
        response: {
          200: productListResponseSchema,
          404: notFoundResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { restaurantId } = request.params;
      if (!restaurants.some((r) => r.id === restaurantId)) {
        return restaurantNotFound(reply, restaurantId);
      }
      return products.filter((p) => p.restaurantId === restaurantId);
    },
  );

  // Buscar produto específico (escopado pelo restaurante da URL)
  app.get<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/products/:id",
    {
      schema: {
        params: productParamsSchema,
        response: { 200: productResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { restaurantId, id } = request.params;
      if (!restaurants.some((r) => r.id === restaurantId)) {
        return restaurantNotFound(reply, restaurantId);
      }
      const product = products.find(
        (p) => p.id === id && p.restaurantId === restaurantId,
      );
      if (!product) return productNotFound(reply, id);
      return product;
    },
  );

  // Edição parcial (protege id/createdAt/restaurantId, renova updatedAt)
  app.patch<{
    Params: { restaurantId: string; id: string };
    Body: UpdateProductInput;
  }>(
    "/restaurants/:restaurantId/products/:id",
    {
      schema: {
        params: productParamsSchema,
        body: updateProductBodySchema,
        response: { 200: productResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { restaurantId, id } = request.params;
      if (!restaurants.some((r) => r.id === restaurantId)) {
        return restaurantNotFound(reply, restaurantId);
      }
      const index = products.findIndex(
        (p) => p.id === id && p.restaurantId === restaurantId,
      );
      if (index === -1) return productNotFound(reply, id);

      const existing = products[index];
      const updated: Product = {
        ...existing,
        ...request.body,
        id: existing.id,
        restaurantId: existing.restaurantId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      products[index] = updated;
      return updated;
    },
  );

  // Remover produto
  app.delete<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/products/:id",
    {
      schema: {
        params: productParamsSchema,
        response: { 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { restaurantId, id } = request.params;
      if (!restaurants.some((r) => r.id === restaurantId)) {
        return restaurantNotFound(reply, restaurantId);
      }
      const index = products.findIndex(
        (p) => p.id === id && p.restaurantId === restaurantId,
      );
      if (index === -1) return productNotFound(reply, id);

      products.splice(index, 1);
      return reply.code(204).send();
    },
  );
}
