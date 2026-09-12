import type { FastifyInstance } from "fastify";
import type { OpeningHourInput } from "../domain/opening-hours.ts";
import * as openingHoursService from "../services/opening-hours.ts";
import { installRouteValidators } from "./validators.ts";
import { errorResponseSchema } from "./schemas.ts";

/**
 * Rotas de horário de funcionamento — camada HTTP (controller), aninhadas em
 * restaurantes.
 *
 * Só HTTP: schema, params/body, chamada ao serviço e status code. Faixa de
 * duração zero e restaurante de outro dono são regra de negócio e moram no
 * serviço; aqui chegam como `ValidationError`/`NotFoundError` e viram 400/404
 * no error handler central.
 */

// ===================== JSON Schemas =====================

/** `HH:MM` em 24 horas. O `pattern` é o que recusa "11h" e "25:00". */
const timeSchema = { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" };

const openingHourSchema = {
  type: "object",
  additionalProperties: false,
  required: ["weekday", "opensAt", "closesAt"],
  properties: {
    weekday: { type: "integer", minimum: 0, maximum: 6 },
    opensAt: timeSchema,
    closesAt: timeSchema,
  },
};

const openingHoursBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["openingHours"],
  properties: {
    // lista vazia é válida e significa fechado todos os dias
    openingHours: { type: "array", items: openingHourSchema },
  },
};

const openingHoursResponseSchema = {
  type: "object",
  properties: {
    openingHours: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          weekday: { type: "integer" },
          opensAt: { type: "string" },
          closesAt: { type: "string" },
        },
      },
    },
  },
};

const restaurantIdParamsSchema = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: { type: "string" } },
};

// ===================== Rotas =====================

/** Plugin encapsulado: os validadores não vazam para as rotas irmãs (F2). */
export async function openingHoursRoutes(app: FastifyInstance) {
  installRouteValidators(app);

  app.put<{
    Params: { restaurantId: string };
    Body: { openingHours: OpeningHourInput[] };
  }>(
    "/restaurants/:restaurantId/opening-hours",
    {
      schema: {
        tags: ["Horário"],
        operationId: "replaceOpeningHours",
        summary: "Define a grade de horário da semana",
        description:
          "Troca a semana inteira pela grade enviada — como a tela faz: a " +
          "pessoa edita e salva. Dia sem faixa nasce fechado; `closesAt` " +
          "menor que `opensAt` significa que a faixa atravessa a meia-noite.",
        params: restaurantIdParamsSchema,
        body: openingHoursBodySchema,
        response: {
          200: openingHoursResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const openingHours = await openingHoursService.replaceForRestaurant(
        request.params.restaurantId,
        request.body.openingHours,
      );
      return { openingHours };
    },
  );

  app.get<{ Params: { restaurantId: string } }>(
    "/restaurants/:restaurantId/opening-hours",
    {
      schema: {
        tags: ["Horário"],
        operationId: "getOpeningHours",
        summary: "A grade de horário atual",
        description:
          "As faixas vivas do restaurante, ordenadas por dia e por início.",
        params: restaurantIdParamsSchema,
        response: {
          200: openingHoursResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const openingHours = await openingHoursService.listByRestaurant(
        request.params.restaurantId,
      );
      return { openingHours };
    },
  );
}
