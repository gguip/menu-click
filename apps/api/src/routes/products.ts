import type { FastifyInstance } from "fastify";
import { createRequire } from "node:module";
import type {
  CreateProductInput,
  UpdateProductInput,
} from "../domain/product.ts";
import * as productsService from "../services/products.ts";
import { errorResponseSchema } from "./schemas.ts";

/**
 * Rotas de produtos — camada HTTP (controller), aninhadas em restaurantes.
 *
 * Só HTTP: schema, params/body, chamada ao serviço e status code. A checagem de
 * "o restaurante existe?" é regra de negócio e mora no serviço; aqui ela chega
 * como `NotFoundError` e o error handler central responde 404.
 */

// ajv e ajv-formats são pacotes CJS com `export default`. Sob NodeNext +
// verbatimModuleSyntax o import default não fica construível no type-check,
// então carregamos via require (CJS no runtime) e tipamos pelo próprio módulo.
const nodeRequire = createRequire(import.meta.url);
const Ajv = nodeRequire("ajv") as typeof import("ajv")["default"];
const addFormats = nodeRequire(
  "ajv-formats",
) as typeof import("ajv-formats")["default"];

/**
 * Validador estrito usado SÓ neste escopo de rotas.
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

// ===================== JSON Schemas =====================

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

// ===================== Rotas =====================

/** Plugin encapsulado: o validador estrito abaixo não vaza para as irmãs (F2). */
export async function productRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(({ schema }) => strictAjv.compile(schema as object));

  // Criar produto no restaurante
  app.post<{ Params: { restaurantId: string }; Body: CreateProductInput }>(
    "/restaurants/:restaurantId/products",
    {
      schema: {
        params: restaurantIdParamsSchema,
        body: createProductBodySchema,
        response: { 201: productResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const product = await productsService.create(
        request.params.restaurantId,
        request.body,
      );
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
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      return productsService.listByRestaurant(request.params.restaurantId);
    },
  );

  // Buscar produto específico (escopado pelo restaurante da URL)
  app.get<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/products/:id",
    {
      schema: {
        params: productParamsSchema,
        response: { 200: productResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      const { restaurantId, id } = request.params;
      return productsService.getById(restaurantId, id);
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
        response: { 200: productResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      const { restaurantId, id } = request.params;
      return productsService.update(restaurantId, id, request.body);
    },
  );

  // Remover produto
  app.delete<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/products/:id",
    {
      schema: {
        params: productParamsSchema,
        response: { 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { restaurantId, id } = request.params;
      await productsService.remove(restaurantId, id);
      return reply.code(204).send();
    },
  );
}
