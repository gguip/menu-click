import type { FastifyInstance } from "fastify";
import { createRequire } from "node:module";
import type { CreateRestaurantInput } from "../domain/restaurant.ts";
import type { CreateRestaurantUserInput } from "../domain/restaurant-user.ts";
import { PASSWORD_MIN_LENGTH } from "../domain/restaurant-user.ts";
import {
  LOGIN_RATE_LIMIT_MAX,
  PASSWORD_RESET_RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
} from "../limits.ts";
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

const changePasswordBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["currentPassword", "newPassword"],
  properties: {
    // a atual não tem `minLength`: ela é conferida contra o hash, e exigir
    // formato dela recusaria uma senha legítima criada sob outra regra
    currentPassword: { type: "string" },
    newPassword: passwordSchema,
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

const forgotPasswordBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["email"],
  properties: {
    email: { type: "string", format: "email", maxLength: 254 },
  },
};

/**
 * Mensagem genérica, de propósito: nada aqui distingue "existe" de "não
 * existe". O schema também é a barreira que impede o token de vazar por
 * engano na resposta (S10) — ele nunca esteve num campo deste objeto.
 */
const forgotPasswordResponseSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
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
        tags: ["Autenticação"],
        operationId: "register",
        summary: "Cadastra restaurante e primeiro usuário",
        description:
          "As duas coisas numa transação: e-mail já cadastrado desfaz o restaurante junto, senão sobraria um registro que ninguém consegue acessar. Não devolve sessão — entrar é `POST /auth/login`.",
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
        tags: ["Autenticação"],
        operationId: "login",
        summary: "Entra e recebe um token de sessão",
        description:
          "Senha errada e e-mail inexistente respondem a MESMA coisa, no mesmo tempo: distinguir os dois entregaria quais endereços estão cadastrados. Limite de 5 requisições por minuto por IP (429 ao estourar), porque a rota é anônima e cara de propósito.",
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

  // Pede o link de recuperação de senha. Pública pelo mesmo motivo do
  // login: quem esqueceu a senha não tem sessão para provar quem é.
  app.post<{ Body: { email: string } }>(
    "/auth/forgot-password",
    {
      config: {
        public: true,
        // teto próprio, bem abaixo do global — ver PASSWORD_RESET_RATE_LIMIT_MAX
        rateLimit: {
          max: PASSWORD_RESET_RATE_LIMIT_MAX,
          timeWindow: RATE_LIMIT_WINDOW,
        },
      },
      schema: {
        tags: ["Autenticação"],
        operationId: "requestPasswordReset",
        summary: "Pede o link de recuperação de senha",
        description:
          "Sempre responde 202, exista ou não o e-mail: dizer que não existe seria um oráculo de quais contas estão cadastradas. O trabalho (achar o usuário, criar o token, mandar o e-mail) acontece DEPOIS desta resposta, então nem o tempo de resposta denuncia — e um provedor de SMTP lento deixa de segurar a requisição. Limite de 5 por minuto por IP (429 ao estourar), mesmo motivo do `/auth/login`.",
        body: forgotPasswordBodySchema,
        response: {
          202: forgotPasswordResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.code(202).send({
        message: "Se o e-mail estiver cadastrado, enviamos um link de recuperação",
      });

      // Depois de responder, e sem `await` — ver o comentário de
      // `requestPasswordReset` em `services/auth.ts`. Falha de envio vai só
      // para o log, sem o token (S13): contar ao cliente que o envio falhou
      // também diria que o e-mail existe.
      void authService.requestPasswordReset(request.body.email).catch((error) => {
        request.log.error({ err: error }, "falha ao processar recuperação de senha");
      });

      return reply;
    },
  );

  app.post(
    "/auth/logout",
    {
      // sem `config.public`: o hook de raiz já exige sessão
      schema: {
        tags: ["Autenticação"],
        operationId: "logout",
        summary: "Revoga a sessão atual",
        description:
          "Só a sessão do token usado. As outras sessões do mesmo usuário (outro aparelho) continuam valendo.",
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
        tags: ["Autenticação"],
        operationId: "getCurrentUser",
        summary: "Quem é o dono da sessão",
        description:
          "Devolve o usuário e o restaurante a que ele pertence — é como o front descobre o `restaurantId` para montar as demais chamadas.",
        response: { 200: userResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      return authService.getUser(requireAuth(request).userId);
    },
  );

  // Trocar a própria senha. Sem esta rota, quem quisesse trocar a senha (ou
  // desconfiasse de vazamento) não teria caminho nenhum pela API.
  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/auth/change-password",
    {
      schema: {
        tags: ["Autenticação"],
        operationId: "changePassword",
        summary: "Troca a própria senha",
        description:
          "Exige a senha **atual** mesmo já havendo sessão: sem isso, um token roubado trocaria a senha e trancaria o dono para fora da própria conta. Ao trocar, as **demais** sessões do usuário são revogadas e a atual continua valendo — trocar senha é o que se faz ao desconfiar de vazamento, e sessões antigas ainda válidas esvaziariam o gesto. Senha atual errada é 401.",
        body: changePasswordBodySchema,
        response: {
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body;
      await authService.changePassword(
        requireAuth(request),
        currentPassword,
        newPassword,
      );
      return reply.code(204).send();
    },
  );
}
