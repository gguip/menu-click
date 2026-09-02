import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
import {
  BODY_LIMIT_BYTES,
  corsOrigins,
  CONNECTION_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
  TRUST_PROXY,
} from "./limits.ts";
import type { FastifyError } from "fastify";
import { pool } from "./db/pool.ts";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./errors.ts";
import { healthRoutes } from "./routes/health.ts";
import { restaurantRoutes } from "./routes/restaurants.ts";
import { productRoutes } from "./routes/products.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { restaurantUserRoutes } from "./routes/restaurant-users.ts";
import { orderRoutes } from "./routes/orders.ts";
import { menuRoutes } from "./routes/menu.ts";
import { trackingRoutes } from "./routes/tracking.ts";
import { authRoutes } from "./routes/auth.ts";
import { installAuth } from "./routes/authenticate.ts";
import { openapiOptions } from "./openapi.ts";

/**
 * Monta a instância do Fastify sem escutar (F1): registra plugins, rotas e o
 * error handler, e devolve o `app` pronto. Quem decide se/como escutar é o
 * chamador — `.listen()` no `server.ts` real, `app.inject()` nos testes
 * (F21), sem precisar abrir socket nenhum.
 */
export async function buildApp() {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    trustProxy: TRUST_PROXY,
    logger: {
      // S13/F20. Hoje isto não filtra nada: o serializer padrão do Fastify
      // loga só method/url/host/remoteAddress, sem headers — verificado.
      //
      // Está aqui como rede para o dia em que alguém precisar dos headers no
      // log (debugar um proxy, um `serializers.req` customizado, subir o nível
      // para trace). Nesse dia o `Authorization` carrega uma credencial válida
      // em texto puro, e quem mexer no logger não vai lembrar disso. Custo
      // zero agora, e a alternativa é depender de memória.
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        remove: true,
      },
    },
  });

  // Tratamento centralizado de erro (F14/S11). É aqui — e só aqui — que erro de
  // negócio vira status HTTP: o serviço lança `NotFoundError`/`ConflictError`
  // sem saber o que é um status code, e a tradução acontece neste ponto. Erro de
  // cliente continua sendo respondido pelo Fastify como sempre; erro de servidor
  // tem o detalhe (mensagem do Postgres, nome de coluna, stack) só no log.
  //
  // Registrado ANTES de qualquer plugin, e isso não é estilo. Um plugin que
  // registra rotas cria um contexto encapsulado, e esse contexto herda o error
  // handler que existia no momento em que foi criado. Plugin registrado antes
  // desta linha fica com o handler PADRÃO do Fastify — que responde 500 com a
  // mensagem interna no corpo, violando S11. Aconteceu de verdade com o
  // `/docs`: um 401 saía como `500 {"message":"Autenticação obrigatória"}`.
  app.setErrorHandler(function (error: FastifyError, request, reply) {
    if (error instanceof NotFoundError) {
      return reply.code(404).send({
        statusCode: 404,
        error: "Not Found",
        message: error.message,
      });
    }

    if (error instanceof UnauthorizedError) {
      return reply.code(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: error.message,
      });
    }

    if (error instanceof ValidationError) {
      return reply.code(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: error.message,
      });
    }

    if (error instanceof ForbiddenError) {
      return reply.code(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: error.message,
      });
    }

    if (error instanceof ConflictError) {
      return reply.code(409).send({
        statusCode: 409,
        error: "Conflict",
        message: error.message,
      });
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode < 500) {
      // validação, JSON malformado, rota inexistente: a mensagem fala da
      // requisição, não das tripas do servidor. Delega pro handler padrão.
      //
      // O `reply.code()` explícito não é redundante. Quando o erro vem do
      // caminho de validação do próprio Fastify, o status já está no `reply` e
      // o `send` o preserva — mas erro lançado por um hook de plugin (o 429 do
      // rate limit, por exemplo) chega aqui com o reply ainda em 200, e sem
      // esta linha a resposta sai **200 com o corpo serializado pelo schema do
      // 200**, ou seja, `{}`. Foi exatamente o que aconteceu quando o rate
      // limit entrou.
      return reply.code(statusCode).send(error);
    }

    request.log.error({ err: error }, "erro não tratado");
    return reply.code(500).send({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Erro interno no servidor",
    });
  });

  /**
   * WebSocket. Precisa vir antes das rotas que o usam, como todo plugin que
   * decora a instância (F5).
   *
   * Rota WebSocket passa pelos hooks `onRequest`/`preValidation` do Fastify
   * antes do upgrade — o que significa que o hook de negação por padrão vale
   * para ela também. A rota de acompanhamento é pública por declaração
   * explícita, como qualquer outra.
   */
  await app.register(websocket);

  /**
   * OpenAPI. Precisa vir antes das rotas: o plugin coleta cada uma via
   * `onRoute`, e rota registrada antes dele simplesmente não entra no
   * documento — sem erro nenhum, só ausente.
   */
  await app.register(swagger, openapiOptions);

  /**
   * A interface do `/docs` fica fora de produção.
   *
   * Ela é um mapa completo da superfície da API: toda rota, todo parâmetro,
   * todo formato. Isso é exatamente o que ajuda quem constrói — e quem sonda.
   * A decisão é falhar fechado: só sobe quando `NODE_ENV` **não** é
   * `production`. O documento em si continua sendo gerado sempre (o
   * `openapi.json` versionado sai dele), o que muda é a página estar no ar.
   */
  if (process.env.NODE_ENV !== "production") {
    await app.register(async (escopo) => {
      /**
       * As rotas do `/docs` são criadas pelo plugin, não por nós — não há onde
       * escrever `config: { public: true }` nelas. Este `onRoute` marca todas
       * as que nascerem neste escopo, que é exatamente o conjunto do
       * swagger-ui (a página, os estáticos, o JSON e o YAML).
       *
       * Sem isso o hook de negação por padrão responde 401 à própria
       * documentação — o que é o desenho funcionando, não um bug: rota que não
       * se declara pública nasce fechada, inclusive esta.
       */
      escopo.addHook("onRoute", (routeOptions) => {
        routeOptions.config = { ...routeOptions.config, public: true };
      });

      await escopo.register(swaggerUi, {
        routePrefix: "/docs",
        uiConfig: { docExpansion: "list", deepLinking: true },
      });
    });
  }

  /**
   * CORS, registrado **antes** do `installAuth()`.
   *
   * A ordem não é estética. O preflight `OPTIONS` que o navegador manda antes
   * de uma requisição com header customizado **não carrega o `Authorization`**
   * — ele é anônimo por definição. O hook de negação por padrão responderia
   * 401 a ele, e um preflight que falha faz o navegador recusar a requisição
   * real e reportar "erro de CORS". O sintoma aponta para o lugar errado, e a
   * causa é autenticação. Registrando o CORS primeiro, o preflight é respondido
   * por ele e nunca chega ao hook.
   *
   * Com `CORS_ORIGINS` vazio (o default), nenhuma origem cruzada é aceita.
   */
  const origens = corsOrigins();
  await app.register(cors, {
    origin: origens.length === 0 ? false : origens,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "authorization"],
    // sem `credentials`: a API usa header, não cookie
  });

  /**
   * Rate limit por IP.
   *
   * O plugin instala a checagem como hook **de rota**, e hook de rota roda
   * depois dos hooks de instância — ou seja, depois da autenticação. Isso é
   * imposto pelo plugin, não escolha nossa: ele marca a requisição e roda no
   * máximo uma vez, então instalar um hook de instância por fora (para chegar
   * antes) faz o limite específico do login ser ignorado. Testado.
   *
   * A ordem custa pouco no fim das contas:
   *
   * - No `/auth/login`, que é o alvo real, a rota é pública — a autenticação
   *   devolve na primeira linha e o limitador roda ANTES do bcrypt, que é o
   *   recurso caro que precisa de proteção.
   * - Em rota protegida, uma enxurrada sem token é recusada pela autenticação
   *   antes de o contador incrementar. Não custa consulta ao banco: sem header
   *   `Authorization`, o `authenticate` lança na hora.
   *
   * O contador é em memória, por processo. Com uma instância só (o caso hoje)
   * isso é exato; com duas, cada uma tem o próprio contador e o limite efetivo
   * dobra. Resolver é trocar o store por Redis, e é decisão de infra.
   *
   * `request.ip` respeita o `trustProxy` de `limits.ts` — sem ele, atrás de um
   * proxy todos os clientes contam como um só.
   */
  await app.register(rateLimit, {
    global: true,
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW,
    // o plugin tem corpo de erro próprio; este casa com o resto da API (S11)
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Muitas requisições. Tente de novo em ${context.after}.`,
    }),
  });

  // `request.auth` precisa existir antes de qualquer rota ser registrada (F5).
  installAuth(app);


  // Erro em cliente ocioso do pool (ex.: banco reiniciou) derruba o processo
  // se ninguém escutar — o pool descarta a conexão sozinho, aqui só registramos.
  pool.on("error", (err) => {
    app.log.error({ err }, "erro inesperado em cliente ocioso do pool");
  });

  // Fecha o pool junto com o app (F26).
  app.addHook("onClose", async () => {
    await pool.end();
  });


  // Registro das rotas
  await app.register(healthRoutes);
  await app.register(restaurantRoutes);
  await app.register(productRoutes);
  await app.register(categoryRoutes);
  await app.register(restaurantUserRoutes);
  await app.register(orderRoutes);
  await app.register(menuRoutes);
  await app.register(trackingRoutes);
  await app.register(authRoutes);

  return app;
}
