import type { FastifyInstance } from "fastify";
import { createRequire } from "node:module";
import type {
  CreateProductInput,
  UpdateProductInput,
} from "../domain/product.ts";
import type { Pagination } from "../domain/pagination.ts";
import * as productsService from "../services/products.ts";
import {
  errorResponseSchema,
  pageResponseSchema,
  paginationQuerystringSchema,
} from "./schemas.ts";

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

/**
 * Validador para params e querystring — aqui a coerção é obrigatória, não
 * opcional: tudo que vem na URL chega como string, então `?limit=20` seria
 * rejeitado por `type: "integer"` se usássemos o validador estrito. Mesmas
 * opções do default do Fastify.
 */
const coercingAjv = new Ajv({
  coerceTypes: "array",
  useDefaults: true,
  removeAdditional: true,
  allErrors: false,
});
addFormats(coercingAjv);

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
    stock: { type: "integer", minimum: 0 },
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
    stock: { type: "integer", minimum: 0 },
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
    stock: { type: "integer" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const productPageResponseSchema = pageResponseSchema(productResponseSchema);

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
  // O estrito vale só para o corpo (é lá que "4890" não pode virar 4890); o
  // resto usa o coercitivo, porque URL não tem tipo.
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === "body" ? strictAjv : coercingAjv).compile(schema as object),
  );

  // Criar produto no restaurante
  app.post<{ Params: { restaurantId: string }; Body: CreateProductInput }>(
    "/restaurants/:restaurantId/products",
    {
      schema: {
        tags: ["Produtos"],
        operationId: "createProduct",
        summary: "Adiciona um produto ao cardápio",
        description:
          "`priceInCents` é inteiro em centavos, e string não é aceita: o validador desta rota não faz coerção, então `\"4890\"` é 400 e não 4890. `stock` é o estoque inicial (ausente = 0).",
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

  // Listar produtos do restaurante (sem produtos → 200 com data vazia)
  app.get<{ Params: { restaurantId: string }; Querystring: Pagination }>(
    "/restaurants/:restaurantId/products",
    {
      schema: {
        tags: ["Produtos"],
        operationId: "listProducts",
        summary: "Cardápio, do lado de quem edita",
        description:
          "Ao contrário do cardápio público, esta listagem traz o `stock` exato.",
        params: restaurantIdParamsSchema,
        querystring: paginationQuerystringSchema,
        response: {
          200: productPageResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      return productsService.listByRestaurant(
        request.params.restaurantId,
        request.query,
      );
    },
  );

  // Buscar produto específico (escopado pelo restaurante da URL)
  app.get<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/products/:id",
    {
      schema: {
        tags: ["Produtos"],
        operationId: "getProduct",
        summary: "Detalhe do produto",
        description:
          "Escopado pelo restaurante da URL: produto de outro restaurante é 404, mesmo com o id certo.",
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
        tags: ["Produtos"],
        operationId: "updateProduct",
        summary: "Edita o produto",
        description:
          "É por aqui que se repõe estoque (`stock`). Dar baixa, não: só a confirmação de pedido tira unidade.",
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
        tags: ["Produtos"],
        operationId: "deleteProduct",
        summary: "Tira o produto do cardápio",
        description:
          "Soft delete. Pedidos que já continham o produto seguem intactos, porque eles guardam uma cópia do nome e do preço.",
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
