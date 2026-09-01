import type { FastifyInstance } from "fastify";

/**
 * Rota de health check da API.
 * Usada para monitoramento e para verificar se o server está no ar.
 *
 * Pública por necessidade: readiness probe de container não tem credencial, e
 * exigir uma faria o orquestrador considerar a app morta.
 */
export async function healthRoutes(app: FastifyInstance) {
  app.get(
    "/health",
    {
      config: { public: true },
      schema: {
        tags: ["Operação"],
        operationId: "healthCheck",
        summary: "Estado da API",
        description:
          "Pública por necessidade: readiness probe de container não tem " +
          "credencial, e exigir uma faria o orquestrador considerar a app morta.",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              service: { type: "string" },
              uptime: { type: "number" },
              timestamp: { type: "string" },
            },
          },
        },
      },
    },
    async () => {
      return {
        status: "ok",
        service: "menuclick-api",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      };
    },
  );
}
