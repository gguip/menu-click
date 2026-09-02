import type { FastifyInstance } from "fastify";
import type { CreateRestaurantUserInput } from "../domain/restaurant-user.ts";
import {
  PASSWORD_MIN_LENGTH,
  USER_ROLES,
} from "../domain/restaurant-user.ts";
import * as authService from "../services/auth.ts";
import { requireAuth } from "./authenticate.ts";
import { installRouteValidators } from "./validators.ts";
import { errorResponseSchema } from "./schemas.ts";

/**
 * Quem tem acesso ao painel do restaurante.
 *
 * As três rotas são `ownerOnly`: administrar usuários é uma das duas ações que
 * o papel restringe (a outra é remover o restaurante). Sem isso, um atendente
 * convidaria outro atendente — e o dono deixaria de controlar quem entra.
 *
 * O endereço é `/restaurants/:restaurantId/users` e o parâmetro **precisa**
 * chamar `restaurantId`: é o nome que o hook procura para comparar com a
 * sessão (S18).
 */

const createUserBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "email", "password"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    email: { type: "string", format: "email", maxLength: 254 },
    // o limite real é em BYTES e é conferido no serviço: o bcrypt ignora tudo
    // depois do byte 72, e `maxLength` conta caracteres (S20)
    password: { type: "string", minLength: PASSWORD_MIN_LENGTH },
    // ausente = `staff`, o menos poderoso: esquecer o campo não pode dar a
    // alguém o poder de apagar o restaurante
    role: { type: "string", enum: [...USER_ROLES] },
  },
};

const userResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    restaurantId: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    role: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
  // nem `passwordHash` nem `password` entram aqui, e o tipo `RestaurantUser`
  // também não os tem — duas barreiras para o mesmo vazamento (S10)
};

const userListResponseSchema = {
  type: "object",
  properties: { data: { type: "array", items: userResponseSchema } },
};

const restaurantIdParamsSchema = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: { type: "string" } },
};

const userParamsSchema = {
  type: "object",
  required: ["restaurantId", "id"],
  properties: {
    restaurantId: { type: "string" },
    id: { type: "string" },
  },
};

export async function restaurantUserRoutes(app: FastifyInstance) {
  installRouteValidators(app);

  app.post<{ Params: { restaurantId: string }; Body: CreateRestaurantUserInput }>(
    "/restaurants/:restaurantId/users",
    {
      config: { ownerOnly: true },
      schema: {
        tags: ["Usuários"],
        operationId: "createRestaurantUser",
        summary: "Dá acesso ao painel para mais alguém",
        description:
          "Restrito ao dono. A senha é definida por quem convida e entregue à pessoa, que a troca depois em `/auth/change-password` — não há envio de e-mail no projeto. `role` ausente é `staff`: o padrão é o menos poderoso, para que esquecer o campo não dê a alguém o poder de apagar o restaurante.",
        params: restaurantIdParamsSchema,
        body: createUserBodySchema,
        response: {
          201: userResponseSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = await authService.createUser(
        request.params.restaurantId,
        request.body,
      );
      reply.code(201);
      return user;
    },
  );

  app.get<{ Params: { restaurantId: string } }>(
    "/restaurants/:restaurantId/users",
    {
      config: { ownerOnly: true },
      schema: {
        tags: ["Usuários"],
        operationId: "listRestaurantUsers",
        summary: "Quem tem acesso ao painel",
        description:
          "Restrito ao dono, e **sem envelope de paginação**: é a lista de quem entra no painel, não um catálogo. Um restaurante com dezenas de logins é outro problema, e ele ainda não existe.",
        params: restaurantIdParamsSchema,
        response: {
          200: userListResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      return { data: await authService.listUsers(request.params.restaurantId) };
    },
  );

  app.delete<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/users/:id",
    {
      config: { ownerOnly: true },
      schema: {
        tags: ["Usuários"],
        operationId: "deleteRestaurantUser",
        summary: "Tira o acesso de alguém",
        description:
          "Restrito ao dono. **Ninguém remove a si mesmo** (409): a regra impede alguém de se trancar para fora e, como só o dono remove usuário, garante de quebra que o restaurante nunca fica sem nenhum `owner`. As sessões do removido param de valer no mesmo instante — a resolução do token filtra usuário vivo.",
        params: userParamsSchema,
        response: {
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      await authService.removeUser(requireAuth(request), request.params.id);
      return reply.code(204).send();
    },
  );
}
