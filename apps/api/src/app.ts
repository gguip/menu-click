import Fastify from "fastify";
import type { FastifyError } from "fastify";
import { pool } from "./db/pool.ts";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./errors.ts";
import { healthRoutes } from "./routes/health.ts";
import { restaurantRoutes } from "./routes/restaurants.ts";
import { productRoutes } from "./routes/products.ts";
import { orderRoutes } from "./routes/orders.ts";
import { menuRoutes } from "./routes/menu.ts";
import { authRoutes } from "./routes/auth.ts";
import { installAuth } from "./routes/authenticate.ts";

/**
 * Monta a instância do Fastify sem escutar (F1): registra plugins, rotas e o
 * error handler, e devolve o `app` pronto. Quem decide se/como escutar é o
 * chamador — `.listen()` no `server.ts` real, `app.inject()` nos testes
 * (F21), sem precisar abrir socket nenhum.
 */
export async function buildApp() {
  const app = Fastify({
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

  // Tratamento centralizado de erro (F14/S11). É aqui — e só aqui — que erro de
  // negócio vira status HTTP: o serviço lança `NotFoundError`/`ConflictError`
  // sem saber o que é um status code, e a tradução acontece neste ponto. Erro de
  // cliente continua sendo respondido pelo Fastify como sempre; erro de servidor
  // tem o detalhe (mensagem do Postgres, nome de coluna, stack) só no log.
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
      return reply.send(error);
    }

    request.log.error({ err: error }, "erro não tratado");
    return reply.code(500).send({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Erro interno no servidor",
    });
  });

  // Registro das rotas
  await app.register(healthRoutes);
  await app.register(restaurantRoutes);
  await app.register(productRoutes);
  await app.register(orderRoutes);
  await app.register(menuRoutes);
  await app.register(authRoutes);

  return app;
}
