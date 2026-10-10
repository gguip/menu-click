import type { FastifyInstance } from "fastify";
import type { UpdateRestaurantInput } from "../domain/restaurant.ts";
import * as restaurantsService from "../services/restaurants.ts";
import { requireAuth } from "./authenticate.ts";
import { installRouteValidators } from "./validators.ts";
import type { Pagination } from "../domain/pagination.ts";
import {
  errorResponseSchema,
  pageResponseSchema,
  paginationQuerystringSchema,
  restaurantDetailResponseSchema,
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
  // O validador ESTRITO para o corpo: sem ele vale o Ajv padrão do Fastify,
  // que coage tipo — e aí `null` num campo de dinheiro vira 0. Em
  // `freeDeliveryAboveInCents` isso significaria "frete grátis acima de
  // R$ 0,00", ou seja, grátis em todo pedido, com 200 na resposta.
  installRouteValidators(app);

  // Listar. Devolve o restaurante da SESSÃO, não todos: uma listagem geral
  // entregaria a qualquer usuário logado o cadastro dos concorrentes. Continua
  // paginada (mesmo envelope) porque um usuário em várias lojas é o próximo
  // passo natural — e porque vitrine pública, se um dia existir, é rota
  // própria com schema próprio, como o /menu.
  app.get<{ Querystring: Pagination }>(
    "/restaurants",
    {
      schema: {
        tags: ["Restaurantes"],
        operationId: "listRestaurants",
        summary: "Os restaurantes da sessão",
        description:
          "Devolve o restaurante do usuário logado, não todos: uma listagem geral entregaria o cadastro dos concorrentes. Hoje é sempre um, mas o contrato é de lista.",
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
        tags: ["Restaurantes"],
        operationId: "getRestaurant",
        summary: "Detalhe do restaurante",
        description:
          "Pedir um restaurante que não é o da sessão responde 404, e não 403: 'proibido' confirmaria que ele existe. Traz `openingStatus`: se a loja está dentro da grade de horário agora, com `closesAt` (aberta) ou `opensAt` (fechada); sem `closesAt`, está aberta direto pelos próximos 7 dias, e sem `opensAt`, não tem nenhuma faixa cadastrada. A pausa manual não entra nele — está em `acceptingOrders`. Traz também `menuUrl`, o endereço do cardápio da loja para passar ao cliente (entrega e retirada).",
        params: restaurantIdParamsSchema,
        response: { 200: restaurantDetailResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      return restaurantsService.getDetail(request.params.restaurantId);
    },
  );

  // Edição parcial
  app.patch<{ Params: { restaurantId: string }; Body: UpdateRestaurantInput }>(
    "/restaurants/:restaurantId",
    {
      schema: {
        tags: ["Restaurantes"],
        operationId: "updateRestaurant",
        summary: "Edita o restaurante",
        description:
          "Edição parcial. O `slug` NÃO é editável por aqui: mudar a URL pública quebraria QR code já impresso, então isso precisa ser operação explícita. `logoUrl` e `coverUrl` aceitam `null` ou a URL devolvida pelo Cloudinary para esta loja (ver `signUpload`) — qualquer outra é 400.",
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
      // apagar o restaurante cascateia para produtos e categorias: é a ação
      // mais destrutiva da API, e a razão de os papéis existirem
      config: { ownerOnly: true },
      schema: {
        tags: ["Restaurantes"],
        operationId: "deleteRestaurant",
        summary: "Remove o restaurante",
        description:
          "Soft delete: nada sai do banco. O restaurante e os produtos dele passam a se comportar como se nunca tivessem existido (404 em tudo, fora das listagens), na mesma transação. Pedidos NÃO são afetados — eles são histórico, não catálogo.",
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
