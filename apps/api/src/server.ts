import Fastify from "fastify";
import { healthRoutes } from "./routes/health.ts";
import { restaurantRoutes } from "./routes/restaurants.ts";

const app = Fastify({
  logger: true,
});

// Registro das rotas
await app.register(healthRoutes);
await app.register(restaurantRoutes);

const port = Number(process.env.PORT ?? 3333);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
