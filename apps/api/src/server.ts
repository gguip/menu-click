import Fastify from "fastify";
import type { FastifyError } from "fastify";
import { pool } from "./db/pool.ts";
import { healthRoutes } from "./routes/health.ts";
import { restaurantRoutes } from "./routes/restaurants.ts";

const app = Fastify({
  logger: true,
});

// Erro em cliente ocioso do pool (ex.: banco reiniciou) derruba o processo se
// ninguém escutar — o pool descarta a conexão sozinho, aqui só registramos.
pool.on("error", (err) => {
  app.log.error({ err }, "erro inesperado em cliente ocioso do pool");
});

// Fecha o pool junto com o app (F26).
app.addHook("onClose", async () => {
  await pool.end();
});

// Tratamento centralizado de erro (F14/S11). Erro de cliente continua sendo
// respondido pelo Fastify como sempre; erro de servidor tem o detalhe (mensagem
// do Postgres, nome de coluna, stack) guardado só no log.
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

const port = Number(process.env.PORT ?? 3333);
const host = process.env.HOST ?? "0.0.0.0";

// Shutdown gracioso: encerra requisições em andamento e fecha o pool.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} recebido, encerrando`);
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  await app.close();
  process.exit(1);
}
