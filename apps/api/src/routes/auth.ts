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

const verifyEmailBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["token"],
  properties: {
    // mesmo raciocínio do token de recuperação: opaco para quem valida, sem
    // `format` nem tamanho fixo — o que não bate com hash nenhum já cai na
    // mesma mensagem de "inválido"
    token: { type: "string", minLength: 1 },
  },
};

/**
 * Sem restaurante nem usuário no corpo — o gêmeo do `/auth/reset-password` na
 * barreira de saída (S10): esta rota não devolve sessão, então nem pretexto
 * há para carregar mais que uma mensagem.
 */
const verifyEmailResponseSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
  },
};

/**
 * O `/auth/me` de sempre, mais `emailVerified` NO TOPO — o corpo é o
 * `RestaurantUser`, e não há `restaurant` aninhado nele. Booleano, não a
 * data: quando a loja verificou é informação de auditoria, não do painel, e
 * declarar só o booleano aqui é o que impede a data de vazar por engano
 * (S10) — mesmo raciocínio do `deleted_at` nunca aparecer numa resposta.
 */
const currentUserResponseSchema = {
  type: "object",
  properties: {
    ...userResponseSchema.properties,
    emailVerified: { type: "boolean" },
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

const resetPasswordBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["token", "newPassword"],
  properties: {
    // o token não tem `format` nem regra de tamanho fixa: é opaco para quem
    // valida, e um valor fora do formato esperado simplesmente não bate com
    // hash nenhum no banco — a mesma mensagem de "inválido" cobre os dois
    token: { type: "string", minLength: 1 },
    newPassword: passwordSchema,
  },
};

/**
 * Sem token e sem dado de usuário — a rota é o gêmeo do `/auth/forgot-
 * password` na barreira de saída (S10): devolver sessão aqui trocaria a
 * segunda barreira (a senha nova) por só possuir o link.
 */
const resetPasswordResponseSchema = {
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
          "As duas coisas numa transação: e-mail já cadastrado desfaz o restaurante junto, senão sobraria um registro que ninguém consegue acessar. Não devolve sessão — entrar é `POST /auth/login`. Dispara um e-mail de confirmação; até o dono confirmar (`POST /auth/verify-email`), toda rota escopada no restaurante responde 403.",
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

      // Depois de responder, e sem `await`: e-mail é rede, e não pode
      // segurar quem acabou de criar a conta — mesmo motivo do
      // `requestPasswordReset`. Falha de envio vai só para o log (nunca o
      // token, S13); a loja fica bloqueada, sem caminho de reenvio até a
      // Task 4.
      void authService.sendEmailVerification(created.user).catch((error) => {
        request.log.error(
          { err: error },
          "falha ao enviar e-mail de verificação",
        );
      });

      return created;
    },
  );

  // Consome o token de `/auth/register`. Pública pelo mesmo motivo do
  // reset de senha: é o próprio token que prova quem é, não uma sessão — a
  // loja ainda está bloqueada e não tem como se autenticar de outro jeito.
  app.post<{ Body: { token: string } }>(
    "/auth/verify-email",
    {
      config: { public: true },
      schema: {
        tags: ["Autenticação"],
        operationId: "verifyEmail",
        summary: "Confirma o e-mail do restaurante",
        description:
          "Consome o token que o cadastro mandou por e-mail e libera o painel (a loja passa a responder fora do 403 de `authenticate.ts`). Mensagem única para token inválido, expirado ou já usado — distinguir diria a quem guarda um link velho se ele um dia existiu. Não devolve sessão: quem verificou entra como sempre, por `POST /auth/login`.",
        body: verifyEmailBodySchema,
        response: {
          200: verifyEmailResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request) => {
      await authService.verifyEmail(request.body.token);
      return { message: "E-mail confirmado. O painel já está liberado" };
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
          // o corpo tem `format: "email"`: 400 é resposta real, e sem o schema
          // o corpo do erro sai com campos que nenhum outro 400 da API expõe
          400: errorResponseSchema,
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

  // Consome o token de `/auth/forgot-password`. Pública pelo mesmo motivo:
  // quem está aqui não tem sessão para provar quem é — é o próprio token que
  // prova.
  app.post<{ Body: { token: string; newPassword: string } }>(
    "/auth/reset-password",
    {
      config: {
        public: true,
        // teto próprio: desde que a conferência do token passou a vir ANTES do
        // bcrypt, token inventado sai barato — mas a rota segue anônima e cara
        // no caminho feliz, e é o perfil que o S25 descreve. Compartilhar o
        // teto global de 100/min a deixaria de fora da proteção que as duas
        // rotas irmãs de autenticação já têm.
        rateLimit: {
          max: PASSWORD_RESET_RATE_LIMIT_MAX,
          timeWindow: RATE_LIMIT_WINDOW,
        },
      },
      schema: {
        tags: ["Autenticação"],
        operationId: "resetPassword",
        summary: "Troca a senha com o token de recuperação",
        description:
          "Mensagem única para token inválido, expirado ou já usado — distinguir diria a quem guarda um link velho se ele um dia existiu. Não devolve sessão: quem recuperou entra como todo mundo, por `/auth/login` — devolver token aqui trocaria a segunda barreira (a senha nova) por só possuir o link. Derruba TODAS as sessões do usuário, sem exceção: não há sessão atual a poupar, e qualquer sessão viva pertence a quem tinha a senha antiga.",
        body: resetPasswordBodySchema,
        response: {
          200: resetPasswordResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request) => {
      await authService.resetPassword(
        request.body.token,
        request.body.newPassword,
      );
      return { message: "Senha alterada. Entre com a senha nova" };
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
          "Devolve o usuário e o restaurante a que ele pertence — é como o front descobre o `restaurantId` para montar as demais chamadas. Traz `emailVerified` no topo: é o que o painel usa para saber se falta desbloquear (e mostrar o convite a reenviar o link).",
        response: { 200: currentUserResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const user = await authService.getUser(auth.userId);
      // emailVerified vem da SESSÃO (já resolvida no hook), não de uma nova
      // consulta ao restaurante — é o mesmo booleano que bloqueia o painel.
      return { ...user, emailVerified: auth.emailVerified };
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
