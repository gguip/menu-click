import type { FastifyInstance } from "fastify";

/**
 * Rota de health check da API.
 * Usada para monitoramento e para verificar se o server está no ar.
 */
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "menuclick-api",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });
}
