import type { FastifyInstance } from "fastify";
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "../domain/category.ts";
import type { Pagination } from "../domain/pagination.ts";
import * as categoriesService from "../services/categories.ts";
import { installRouteValidators } from "./validators.ts";
import {
  errorResponseSchema,
  pageResponseSchema,
  paginationQuerystringSchema,
} from "./schemas.ts";

/**
 * Rotas de categorias — camada HTTP (controller), aninhadas em restaurantes.
 *
 * Só HTTP: schema, params/body, chamada ao serviço e status code. Nome repetido
 * e categoria de outro restaurante são regra de negócio e moram no serviço;
 * aqui chegam como `ConflictError`/`NotFoundError` e viram 409/404 no error
 * handler central.
 */

// ===================== JSON Schemas =====================

/** Nome curto de propósito: é rótulo de seção do cardápio, não descrição. */
const CATEGORY_NAME_MAX_LENGTH = 60;

const categoryNameSchema = {
  type: "string",
  minLength: 1,
  maxLength: CATEGORY_NAME_MAX_LENGTH,
};

/**
 * Posição é inteiro >= 0. O validador desta rota não coage, então `"3"` é 400 —
 * mesma disciplina do `priceInCents`.
 */
const categoryPositionSchema = { type: "integer", minimum: 0 };

const createCategoryBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: categoryNameSchema,
    position: categoryPositionSchema,
  },
};

const updateCategoryBodySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: categoryNameSchema,
    position: categoryPositionSchema,
  },
};

const categoryResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    restaurantId: { type: "string" },
    name: { type: "string" },
    position: { type: "integer" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const categoryPageResponseSchema = pageResponseSchema(categoryResponseSchema);

const restaurantIdParamsSchema = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: { type: "string" } },
};

const categoryParamsSchema = {
  type: "object",
  required: ["restaurantId", "id"],
  properties: {
    restaurantId: { type: "string" },
    id: { type: "string" },
  },
};

// ===================== Rotas =====================

/** Plugin encapsulado: os validadores não vazam para as rotas irmãs (F2). */
export async function categoryRoutes(app: FastifyInstance) {
  installRouteValidators(app);

  app.post<{ Params: { restaurantId: string }; Body: CreateCategoryInput }>(
    "/restaurants/:restaurantId/categories",
    {
      schema: {
        tags: ["Categorias"],
        operationId: "createCategory",
        summary: "Cria uma seção do cardápio",
        description:
          'Sem `position`, a categoria vai para o fim do cardápio. O nome é único dentro do restaurante e **não diferencia maiúscula**: com "Bebidas" já criada, "bebidas" é 409.',
        params: restaurantIdParamsSchema,
        body: createCategoryBodySchema,
        response: {
          201: categoryResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const category = await categoriesService.create(
        request.params.restaurantId,
        request.body,
      );
      reply.code(201);
      return category;
    },
  );

  app.get<{ Params: { restaurantId: string }; Querystring: Pagination }>(
    "/restaurants/:restaurantId/categories",
    {
      schema: {
        tags: ["Categorias"],
        operationId: "listCategories",
        summary: "As seções do cardápio, na ordem",
        description:
          "Ordenadas por `position` (o desempate é o nome), que é a ordem em que aparecem no cardápio público — não a alfabética.",
        params: restaurantIdParamsSchema,
        querystring: paginationQuerystringSchema,
        response: {
          200: categoryPageResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      return categoriesService.listByRestaurant(
        request.params.restaurantId,
        request.query,
      );
    },
  );

  app.get<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/categories/:id",
    {
      schema: {
        tags: ["Categorias"],
        operationId: "getCategory",
        summary: "Detalhe da categoria",
        description:
          "Escopado pelo restaurante da URL: categoria de outro restaurante é 404, mesmo com o id certo.",
        params: categoryParamsSchema,
        response: { 200: categoryResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      const { restaurantId, id } = request.params;
      return categoriesService.getById(restaurantId, id);
    },
  );

  app.patch<{
    Params: { restaurantId: string; id: string };
    Body: UpdateCategoryInput;
  }>(
    "/restaurants/:restaurantId/categories/:id",
    {
      schema: {
        tags: ["Categorias"],
        operationId: "updateCategory",
        summary: "Renomeia ou reordena a categoria",
        description:
          "Reordenar é mandar só `position`. Renomear para um nome que já existe no restaurante é 409.",
        params: categoryParamsSchema,
        body: updateCategoryBodySchema,
        response: {
          200: categoryResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { restaurantId, id } = request.params;
      return categoriesService.update(restaurantId, id, request.body);
    },
  );

  app.delete<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/categories/:id",
    {
      schema: {
        tags: ["Categorias"],
        operationId: "deleteCategory",
        summary: "Remove a seção do cardápio",
        description: "Soft delete, como todo DELETE da API.",
        params: categoryParamsSchema,
        response: { 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { restaurantId, id } = request.params;
      await categoriesService.remove(restaurantId, id);
      return reply.code(204).send();
    },
  );
}
