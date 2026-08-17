import type { FastifyInstance } from "fastify";
import * as productsService from "../services/products.ts";
import { errorResponseSchema } from "./schemas.ts";

/**
 * Compra de produto — camada HTTP (controller).
 *
 * A transação, o lock da linha e a decisão "sem estoque" ficam no serviço
 * (`services/products.ts`); aqui só declaramos o contrato. Estoque insuficiente
 * chega como `ConflictError` e vira 409 no error handler central.
 */

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
};

const purchaseResponseSchema = {
  type: "object",
  properties: {
    productId: { type: "string" },
    stockRemaining: { type: "integer" },
  },
};

export async function productPurchaseRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>(
    "/products/:id/purchase",
    {
      schema: {
        params: paramsSchema,
        response: {
          200: purchaseResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      return productsService.purchase(request.params.id);
    },
  );
}
