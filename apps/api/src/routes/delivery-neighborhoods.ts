import type { FastifyInstance } from "fastify";
import type { DeliveryNeighborhoodInput } from "../domain/delivery.ts";
import * as deliveryNeighborhoodsService from "../services/delivery-neighborhoods.ts";
import { installRouteValidators } from "./validators.ts";
import { errorResponseSchema } from "./schemas.ts";

/**
 * Rotas de bairros atendidos — camada HTTP (controller), aninhadas em
 * restaurantes.
 *
 * Só HTTP: schema, params/body, chamada ao serviço e status code. Bairro
 * duplicado e restaurante de outro dono são regra de negócio e moram no
 * serviço; aqui chegam como `ConflictError`/`NotFoundError` e viram 409/404 no
 * error handler central.
 */

// ===================== JSON Schemas =====================

/**
 * Sem teto tão curto quanto o de categoria (que é rótulo de seção): bairro
 * composto ("Jardim Ubirajara") ainda é rótulo, não endereço completo.
 */
const NEIGHBORHOOD_NAME_MAX_LENGTH = 100;

const neighborhoodSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "feeInCents"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: NEIGHBORHOOD_NAME_MAX_LENGTH },
    // zero é entrega grátis, não "não configurado"
    feeInCents: { type: "integer", minimum: 0 },
  },
};

const deliveryNeighborhoodsBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["neighborhoods"],
  properties: {
    // lista vazia é válida e limpa a configuração
    neighborhoods: { type: "array", items: neighborhoodSchema },
  },
};

const deliveryNeighborhoodsResponseSchema = {
  type: "object",
  properties: {
    neighborhoods: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          feeInCents: { type: "integer" },
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
export async function deliveryNeighborhoodsRoutes(app: FastifyInstance) {
  installRouteValidators(app);

  app.put<{
    Params: { restaurantId: string };
    Body: { neighborhoods: DeliveryNeighborhoodInput[] };
  }>(
    "/restaurants/:restaurantId/delivery-neighborhoods",
    {
      schema: {
        tags: ["Entrega"],
        operationId: "replaceDeliveryNeighborhoods",
        summary: "Define os bairros atendidos e o preço de cada um",
        description:
          "Troca a lista inteira pela enviada — como a tela faz: a pessoa " +
          "edita e salva. Lista vazia é válida e limpa a configuração. " +
          "`feeInCents: 0` é entrega grátis, estado legítimo e diferente de " +
          "não configurado. Dois bairros que só diferem por acento ou caixa " +
          "são o mesmo bairro e respondem 409.",
        params: restaurantIdParamsSchema,
        body: deliveryNeighborhoodsBodySchema,
        response: {
          200: deliveryNeighborhoodsResponseSchema,
          // o corpo tem `minimum: 0` e tamanho máximo: 400 é resposta real
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const neighborhoods = await deliveryNeighborhoodsService.replaceForRestaurant(
        request.params.restaurantId,
        request.body.neighborhoods,
      );
      return { neighborhoods };
    },
  );

  app.get<{ Params: { restaurantId: string } }>(
    "/restaurants/:restaurantId/delivery-neighborhoods",
    {
      schema: {
        tags: ["Entrega"],
        operationId: "getDeliveryNeighborhoods",
        summary: "Os bairros atendidos atualmente",
        description: "A lista viva do restaurante, em ordem alfabética.",
        params: restaurantIdParamsSchema,
        response: {
          200: deliveryNeighborhoodsResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const neighborhoods = await deliveryNeighborhoodsService.listByRestaurant(
        request.params.restaurantId,
      );
      return { neighborhoods };
    },
  );
}
