import type { FastifyInstance } from "fastify";
import { createRequire } from "node:module";
import type { CreateRestaurantInput } from "../domain/restaurant.ts";
import type { CreateRestaurantUserInput } from "../domain/restaurant-user.ts";
import { PASSWORD_MIN_LENGTH } from "../domain/restaurant-user.ts";
import { LOGIN_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW } from "../limits.ts";
import * as authService from "../services/auth.ts";
import { requireAuth } from "./authenticate.ts";
import {
  createRestaurantBodySchema,
  errorResponseSchema,
  restaurantResponseSchema,
} from "./schemas.ts";

/**
 * Rotas de autenticação — camada HTTP.
 *
 * `/register` e `/login` se declaram `public` (quem ainda não tem conta não
 * tem como se autenticar). `/logout` e `/me` não declaram nada — e é
 * justamente por não declarar que ficam protegidas: o hook de raiz fecha tudo
 * que não pediu para ser aberto.
 */

// Mesmo motivo de `products.ts`: ajv/ajv-formats são CJS com `export default`.
const nodeRequire = createRequire(import.meta.url);
const Ajv = nodeRequire("ajv") as typeof import("ajv")["default"];
const addFormats = nodeRequire(
  "ajv-formats",
) as typeof import("ajv-formats")["default"];

/**
 * Estrito para o corpo. Aqui a coerção seria perigosa de um jeito específico:
 * com ela, `{"password": 12345}` viraria a string "12345" e criaria uma conta
 * com senha que o dono nunca digitou.
 */
const strictAjv = new Ajv({
  coerceTypes: false,
  useDefaults: true,
  removeAdditional: true,
  allErrors: false,
});
addFormats(strictAjv);

const coercingAjv = new Ajv({
  coerceTypes: "array",
  useDefaults: true,
  removeAdditional: true,
  allErrors: false,
});
addFormats(coercingAjv);

// ===================== JSON Schemas =====================

/**
 * `maxLength` aqui conta CARACTERES e serve só para barrar corpo absurdo. O
 * limite que importa é o de 72 **bytes** do bcrypt, medido no serviço — 40
 * letras "ç" passam por este schema e já estouram lá.
 */
const passwordSchema = {
  type: "string",
  minLength: PASSWORD_MIN_LENGTH,
  maxLength: 200,
};

const userInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "email", "password"],
  properties: {
    name: { type: "string", minLength: 1 },
    email: { type: "string", format: "email", maxLength: 254 },
    password: passwordSchema,
  },
};

const registerBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["restaurant", "user"],
  properties: {
    restaurant: createRestaurantBodySchema,
    user: userInputSchema,
  },
};

const userResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    restaurantId: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
  // `passwordHash` não está aqui, e o tipo `RestaurantUser` também não o tem —
  // duas barreiras para o mesmo vazamento (S10)
};

const registerResponseSchema = {
  type: "object",
  properties: {
    restaurant: restaurantResponseSchema,
    user: userResponseSchema,
  },
};

const loginBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["email", "password"],
  properties: {
    email: { type: "string", maxLength: 254 },
    password: passwordSchema,
  },
};

const loginResponseSchema = {
  type: "object",
  properties: {
    token: { type: "string" },
    expiresAt: { type: "string" },
  },
};

// ===================== Rotas =====================

export async function authRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === "body" ? strictAjv : coercingAjv).compile(schema as object),
  );

  // Cadastro: restaurante + primeiro usuário, numa transação. Não devolve
  // sessão — cadastrar e entrar são duas operações.
  app.post<{
    Body: { restaurant: CreateRestaurantInput; user: CreateRestaurantUserInput };
  }>(
    "/auth/register",
    {
      // sem conta ainda não há como se autenticar
      config: { public: true },
      schema: {
        body: registerBodySchema,
        response: {
          201: registerResponseSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const created = await authService.register(request.body);
      reply.code(201);
      return created;
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    {
      config: {
        public: true,
        // teto próprio, bem abaixo do global: ver LOGIN_RATE_LIMIT_MAX no app.ts
        rateLimit: { max: LOGIN_RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW },
      },
      schema: {
        body: loginBodySchema,
        response: {
          200: loginResponseSchema,
          401: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { email, password } = request.body;
      return authService.login(email, password);
    },
  );

  app.post(
    "/auth/logout",
    {
      // sem `config.public`: o hook de raiz já exige sessão
      schema: {
        response: { 204: { type: "null" }, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await authService.logout(requireAuth(request).sessionId);
      return reply.code(204).send();
    },
  );

  app.get(
    "/auth/me",
    {
      schema: {
        response: { 200: userResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      return authService.getUser(requireAuth(request).userId);
    },
  );
}
