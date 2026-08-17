import { buildApp } from "./app.ts";

const app = await buildApp();

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
