import type { FastifyInstance } from "fastify";
import type {
  CreateRestaurantInput,
  UpdateRestaurantInput,
} from "../domain/restaurant.ts";
import * as restaurantsService from "../services/restaurants.ts";
import { errorResponseSchema } from "./schemas.ts";

/**
 * Rotas de restaurantes — camada HTTP (controller), plugin encapsulado (F2/F4).
 *
 * Responsabilidade daqui: declarar o JSON Schema de entrada e de saída, ler
 * params/body, chamar o serviço e escolher o status code do caminho feliz.
 * **Zero SQL e zero regra de negócio** — "não existe" chega como exceção
 * (`NotFoundError`) e vira 404 no error handler central do `app.ts`.
 */

// ===================== JSON Schemas =====================
// Validação da entrada (F9) e serialização da saída (F10/S10).

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

const idParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
};

// ===================== Rotas =====================

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
      const restaurant = await restaurantsService.create(request.body);
      reply.code(201);
      return restaurant;
    },
  );

  // Listar todos (array vazio é resposta válida → 200)
  app.get(
    "/restaurants",
    { schema: { response: { 200: restaurantListResponseSchema } } },
    async () => {
      return restaurantsService.list();
    },
  );

  // Buscar por id
  app.get<{ Params: { id: string } }>(
    "/restaurants/:id",
    {
      schema: {
        params: idParamsSchema,
        response: { 200: restaurantResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      return restaurantsService.getById(request.params.id);
    },
  );

  // Edição parcial
  app.patch<{ Params: { id: string }; Body: UpdateRestaurantInput }>(
    "/restaurants/:id",
    {
      schema: {
        params: idParamsSchema,
        body: updateRestaurantBodySchema,
        response: { 200: restaurantResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      return restaurantsService.update(request.params.id, request.body);
    },
  );

  // Remover (o serviço cuida da cascata nos produtos)
  app.delete<{ Params: { id: string } }>(
    "/restaurants/:id",
    {
      schema: {
        params: idParamsSchema,
        response: { 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await restaurantsService.remove(request.params.id);
      return reply.code(204).send();
    },
  );
}
