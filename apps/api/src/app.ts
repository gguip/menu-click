import Fastify from "fastify";
import type { FastifyError } from "fastify";
import { pool } from "./db/pool.ts";
import { healthRoutes } from "./routes/health.ts";
import { restaurantRoutes } from "./routes/restaurants.ts";
import { productPurchaseRoutes } from "./routes/products-purchase.ts";

/**
 * Monta a instância do Fastify sem escutar (F1): registra plugins, rotas e o
 * error handler, e devolve o `app` pronto. Quem decide se/como escutar é o
 * chamador — `.listen()` no `server.ts` real, `app.inject()` nos testes
 * (F21), sem precisar abrir socket nenhum.
 */
export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  // Erro em cliente ocioso do pool (ex.: banco reiniciou) derruba o processo
  // se ninguém escutar — o pool descarta a conexão sozinho, aqui só registramos.
  pool.on("error", (err) => {
    app.log.error({ err }, "erro inesperado em cliente ocioso do pool");
  });

  // Fecha o pool junto com o app (F26).
  app.addHook("onClose", async () => {
    await pool.end();
  });

  // Tratamento centralizado de erro (F14/S11). Erro de cliente continua sendo
  // respondido pelo Fastify como sempre; erro de servidor tem o detalhe
  // (mensagem do Postgres, nome de coluna, stack) guardado só no log.
  app.setErrorHandler(function (error: FastifyError, request, reply) {
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
  await app.register(productPurchaseRoutes);

  return app;
}
