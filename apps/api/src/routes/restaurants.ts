import type { FastifyInstance } from "fastify";
import type { UpdateRestaurantInput } from "../domain/restaurant.ts";
import * as restaurantsService from "../services/restaurants.ts";
import { requireAuth } from "./authenticate.ts";
import type { Pagination } from "../domain/pagination.ts";
import {
  errorResponseSchema,
  pageResponseSchema,
  paginationQuerystringSchema,
  restaurantResponseSchema,
  updateRestaurantBodySchema,
} from "./schemas.ts";

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

const restaurantPageResponseSchema = pageResponseSchema(
  restaurantResponseSchema,
);

/**
 * O parâmetro se chama `restaurantId` (e não `id`) de propósito: é esse nome
 * que o hook de autorização em `authenticate.ts` procura para comparar com o
 * restaurante da sessão. Uma rota que chamasse o mesmo valor de `id` ficaria
 * autenticada mas NÃO escopada — passaria a sessão de um restaurante em cima
 * de outro. A URL é a mesma; o nome é o que liga a rota à checagem.
 */
const restaurantIdParamsSchema = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: { type: "string" } },
};

// ===================== Rotas =====================

export async function restaurantRoutes(app: FastifyInstance) {
  // Listar. Devolve o restaurante da SESSÃO, não todos: uma listagem geral
  // entregaria a qualquer usuário logado o cadastro dos concorrentes. Continua
  // paginada (mesmo envelope) porque um usuário em várias lojas é o próximo
  // passo natural — e porque vitrine pública, se um dia existir, é rota
  // própria com schema próprio, como o /menu.
  app.get<{ Querystring: Pagination }>(
    "/restaurants",
    {
      schema: {
        querystring: paginationQuerystringSchema,
        response: { 200: restaurantPageResponseSchema },
      },
    },
    async (request) => {
      return restaurantsService.listForSession(
        requireAuth(request).restaurantId,
        request.query,
      );
    },
  );

  // Buscar por id
  app.get<{ Params: { restaurantId: string } }>(
    "/restaurants/:restaurantId",
    {
      schema: {
        params: restaurantIdParamsSchema,
        response: { 200: restaurantResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      return restaurantsService.getById(request.params.restaurantId);
    },
  );

  // Edição parcial
  app.patch<{ Params: { restaurantId: string }; Body: UpdateRestaurantInput }>(
    "/restaurants/:restaurantId",
    {
      schema: {
        params: restaurantIdParamsSchema,
        body: updateRestaurantBodySchema,
        response: { 200: restaurantResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      return restaurantsService.update(request.params.restaurantId, request.body);
    },
  );

  // Remover (o serviço cuida da cascata nos produtos)
  app.delete<{ Params: { restaurantId: string } }>(
    "/restaurants/:restaurantId",
    {
      schema: {
        params: restaurantIdParamsSchema,
        response: { 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await restaurantsService.remove(request.params.restaurantId);
      return reply.code(204).send();
    },
  );
}
