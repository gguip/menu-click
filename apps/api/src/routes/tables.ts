import type { FastifyInstance } from "fastify";
import type { CreateTableInput, UpdateTableInput } from "../domain/table.ts";
import type { Pagination } from "../domain/pagination.ts";
import * as tablesService from "../services/tables.ts";
import { installRouteValidators } from "./validators.ts";
import {
  errorResponseSchema,
  pageResponseSchema,
  paginationQuerystringSchema,
} from "./schemas.ts";

/**
 * Rotas de mesas — camada HTTP (controller), aninhadas em restaurantes.
 *
 * ⚠️ Nenhuma delas é `ownerOnly`, e isso é decisão. O papel restringe só o que
 * é destrutivo (apagar o restaurante, administrar usuários); gerenciar mesa é
 * operação de salão, como mexer no cardápio, e `staff` faz. Marcar rota nova
 * como `ownerOnly` por reflexo criaria uma hierarquia que ninguém decidiu.
 */

// ===================== JSON Schemas =====================

/** Rótulo curto: é etiqueta de mesa no painel, não descrição. */
const TABLE_LABEL_MAX_LENGTH = 40;

const tableLabelSchema = {
  type: "string",
  minLength: 1,
  maxLength: TABLE_LABEL_MAX_LENGTH,
};

const createTableBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["label"],
  properties: { label: tableLabelSchema },
};

const updateTableBodySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: { label: tableLabelSchema },
};

/**
 * O `hash` SAI nesta resposta, e isso não contradiz o S10.
 *
 * Ele é o conteúdo do QR code: o painel precisa dele para imprimir o adesivo,
 * e a rota é do restaurante — quem a chama é o dono do salão, lendo as
 * próprias mesas. O que o S10 impede é o hash escapar para a superfície
 * pública, e lá ele não está: `GET /menu/:slug/table/:hash` devolve só o
 * rótulo.
 */
const tableResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    restaurantId: { type: "string" },
    label: { type: "string" },
    hash: { type: "string" },
    qrUrl: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const tablePageResponseSchema = pageResponseSchema(tableResponseSchema);

const restaurantIdParamsSchema = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: { type: "string" } },
};

const tableParamsSchema = {
  type: "object",
  required: ["restaurantId", "id"],
  properties: {
    restaurantId: { type: "string" },
    id: { type: "string" },
  },
};

// ===================== Rotas =====================

/** Plugin encapsulado: os validadores não vazam para as rotas irmãs (F2). */
export async function tableRoutes(app: FastifyInstance) {
  installRouteValidators(app);

  app.post<{ Params: { restaurantId: string }; Body: CreateTableInput }>(
    "/restaurants/:restaurantId/tables",
    {
      schema: {
        tags: ["Mesas"],
        operationId: "createTable",
        summary: "Cadastra uma mesa do salão",
        description:
          'O hash é sorteado pelo servidor (16 bytes, 22 caracteres) e a resposta já traz `qrUrl` pronta — o front só precisa passá-la para a biblioteca de QR. O rótulo é único dentro do restaurante e **não diferencia maiúscula**: com "Mesa 7" já criada, "mesa 7" é 409.',
        params: restaurantIdParamsSchema,
        body: createTableBodySchema,
        response: {
          201: tableResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const table = await tablesService.create(
        request.params.restaurantId,
        request.body,
      );
      reply.code(201);
      return table;
    },
  );

  app.get<{ Params: { restaurantId: string }; Querystring: Pagination }>(
    "/restaurants/:restaurantId/tables",
    {
      schema: {
        tags: ["Mesas"],
        operationId: "listTables",
        summary: "Lista as mesas do salão",
        description:
          "Envelope paginado, como todas as listagens. Cada mesa vem com o hash e a `qrUrl` pronta para impressão.",
        params: restaurantIdParamsSchema,
        querystring: paginationQuerystringSchema,
        response: {
          200: tablePageResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) =>
      tablesService.listByRestaurant(
        request.params.restaurantId,
        request.query,
      ),
  );

  app.get<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/tables/:id",
    {
      schema: {
        tags: ["Mesas"],
        operationId: "getTable",
        summary: "Detalha uma mesa",
        description:
          "Mesa de outro restaurante responde 404, não 403 — do lado de fora ela tem que ser indistinguível de uma que não existe.",
        params: tableParamsSchema,
        response: {
          200: tableResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) =>
      tablesService.getById(request.params.restaurantId, request.params.id),
  );

  app.patch<{
    Params: { restaurantId: string; id: string };
    Body: UpdateTableInput;
  }>(
    "/restaurants/:restaurantId/tables/:id",
    {
      schema: {
        tags: ["Mesas"],
        operationId: "updateTable",
        summary: "Renomeia uma mesa",
        description:
          "Só o rótulo. O hash **não** é editável aqui: trocá-lo mata o QR code que já está colado na mesa, e isso precisa ser um gesto explícito (`POST .../rotate-hash`), nunca efeito colateral de renomear.",
        params: tableParamsSchema,
        body: updateTableBodySchema,
        response: {
          200: tableResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) =>
      tablesService.update(
        request.params.restaurantId,
        request.params.id,
        request.body,
      ),
  );

  app.post<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/tables/:id/rotate-hash",
    {
      schema: {
        tags: ["Mesas"],
        operationId: "rotateTableHash",
        summary: "Sorteia um hash novo para a mesa",
        description:
          "Invalida o QR code anterior no instante do commit e devolve a `qrUrl` nova, para reimpressão. É o caminho de volta de um adesivo comprometido — e a razão de o hash poder ficar em claro no banco: o que o protege é entropia mais revogação, não sigilo.",
        params: tableParamsSchema,
        response: {
          200: tableResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) =>
      tablesService.rotateHash(request.params.restaurantId, request.params.id),
  );

  app.delete<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/tables/:id",
    {
      schema: {
        tags: ["Mesas"],
        operationId: "deleteTable",
        summary: "Remove uma mesa",
        description:
          "Soft delete. Pedidos antigos continuam mostrando o rótulo: ele é copiado para o pedido na criação, então o histórico não depende da mesa continuar existindo.",
        params: tableParamsSchema,
        response: {
          204: { type: "null" },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      await tablesService.remove(
        request.params.restaurantId,
        request.params.id,
      );
      reply.code(204);
    },
  );
}
