import type { FastifyInstance } from "fastify";
import { PRICE_RULES } from "../domain/option.ts";
import type {
  CreateOptionGroupInput,
  UpdateOptionGroupInput,
} from "../domain/option.ts";
import type { Pagination } from "../domain/pagination.ts";
import * as optionGroupsService from "../services/option-groups.ts";
import { installRouteValidators } from "./validators.ts";
import {
  errorResponseSchema,
  pageResponseSchema,
  paginationQuerystringSchema,
} from "./schemas.ts";

/**
 * Rotas de grupos de opções — camada HTTP (controller), aninhadas em
 * restaurantes.
 *
 * Só HTTP: schema, params/body, chamada ao serviço e status code. Nome
 * repetido, limites impossíveis e grupo de outro restaurante são regra de
 * negócio e moram no serviço; aqui chegam como `ConflictError`/`NotFoundError`/
 * `ValidationError` e viram 409/404/400 no error handler central.
 */

// ===================== JSON Schemas =====================

const optionGroupNameSchema = { type: "string", minLength: 1, maxLength: 60 };

const createOptionGroupBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "maxOptions", "priceRule"],
  properties: {
    name: optionGroupNameSchema,
    // ausente = 0 = grupo opcional
    minOptions: { type: "integer", minimum: 0, default: 0 },
    maxOptions: { type: "integer", minimum: 1 },
    priceRule: { type: "string", enum: [...PRICE_RULES] },
  },
};

const updateOptionGroupBodySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: optionGroupNameSchema,
    minOptions: { type: "integer", minimum: 0 },
    maxOptions: { type: "integer", minimum: 1 },
    priceRule: { type: "string", enum: [...PRICE_RULES] },
  },
};

const optionResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    priceInCents: { type: "integer" },
    maxQuantity: { type: "integer" },
    available: { type: "boolean" },
    position: { type: "integer" },
  },
};

const optionGroupResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    restaurantId: { type: "string" },
    name: { type: "string" },
    minOptions: { type: "integer" },
    maxOptions: { type: "integer" },
    priceRule: { type: "string" },
    // as opções vêm aninhadas: uma opção fora do grupo dela não significa nada,
    // e uma rota para buscá-la sozinha só existiria para ser ignorada
    options: { type: "array", items: optionResponseSchema },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const optionGroupPageResponseSchema = pageResponseSchema(
  optionGroupResponseSchema,
);

const restaurantIdParamsSchema = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: { type: "string" } },
};

const optionGroupParamsSchema = {
  type: "object",
  required: ["restaurantId", "id"],
  properties: {
    restaurantId: { type: "string" },
    id: { type: "string" },
  },
};

// ===================== Rotas =====================

/** Plugin encapsulado: os validadores não vazam para as rotas irmãs (F2). */
export async function optionGroupRoutes(app: FastifyInstance) {
  installRouteValidators(app);

  app.post<{
    Params: { restaurantId: string };
    Body: CreateOptionGroupInput;
  }>(
    "/restaurants/:restaurantId/option-groups",
    {
      schema: {
        tags: ["Opções"],
        operationId: "createOptionGroup",
        summary: "Cria um grupo de opções",
        description:
          'Sem `minOptions`, o grupo nasce opcional. O nome é único dentro do restaurante e **não diferencia maiúscula**: com "Sabores" já criado, "sabores" é 409. `minOptions` maior que `maxOptions` é 400 — o grupo nunca poderia ser satisfeito.',
        params: restaurantIdParamsSchema,
        body: createOptionGroupBodySchema,
        response: {
          201: optionGroupResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const optionGroup = await optionGroupsService.create(
        request.params.restaurantId,
        request.body,
      );
      reply.code(201);
      return optionGroup;
    },
  );

  app.get<{ Params: { restaurantId: string }; Querystring: Pagination }>(
    "/restaurants/:restaurantId/option-groups",
    {
      schema: {
        tags: ["Opções"],
        operationId: "listOptionGroups",
        summary: "Os grupos de opções do restaurante",
        description: "Ordenados por nome — o grupo não tem posição própria; a ordem de exibição é por produto e mora na junção.",
        params: restaurantIdParamsSchema,
        querystring: paginationQuerystringSchema,
        response: {
          200: optionGroupPageResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      return optionGroupsService.listByRestaurant(
        request.params.restaurantId,
        request.query,
      );
    },
  );

  app.get<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/option-groups/:id",
    {
      schema: {
        tags: ["Opções"],
        operationId: "getOptionGroup",
        summary: "Detalhe do grupo de opções",
        description:
          "Escopado pelo restaurante da URL: grupo de outro restaurante é 404, mesmo com o id certo.",
        params: optionGroupParamsSchema,
        response: { 200: optionGroupResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      const { restaurantId, id } = request.params;
      return optionGroupsService.getById(restaurantId, id);
    },
  );

  app.patch<{
    Params: { restaurantId: string; id: string };
    Body: UpdateOptionGroupInput;
  }>(
    "/restaurants/:restaurantId/option-groups/:id",
    {
      schema: {
        tags: ["Opções"],
        operationId: "updateOptionGroup",
        summary: "Renomeia ou muda os limites do grupo",
        description:
          "A checagem de limites considera o valor resultante: baixar só o `maxOptions` para abaixo do `minOptions` já gravado é 400. Renomear para um nome que já existe no restaurante é 409.",
        params: optionGroupParamsSchema,
        body: updateOptionGroupBodySchema,
        response: {
          200: optionGroupResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { restaurantId, id } = request.params;
      return optionGroupsService.update(restaurantId, id, request.body);
    },
  );

  app.delete<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/option-groups/:id",
    {
      schema: {
        tags: ["Opções"],
        operationId: "deleteOptionGroup",
        summary: "Remove o grupo de opções",
        description: "Soft delete, como todo DELETE da API.",
        params: optionGroupParamsSchema,
        response: { 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { restaurantId, id } = request.params;
      await optionGroupsService.remove(restaurantId, id);
      return reply.code(204).send();
    },
  );
}
