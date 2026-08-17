import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.ts";

/**
 * Compra de produto, protegida contra a race condition do check-then-act:
 * `select ... for update` trava a linha até o commit/rollback, então uma
 * segunda transação concorrente que tente ler o mesmo produto fica bloqueada
 * na sua própria `select ... for update` até esta terminar — nunca as duas
 * leem o mesmo `stock` ao mesmo tempo.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

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

const errorResponseSchema = {
  type: "object",
  properties: {
    statusCode: { type: "integer" },
    error: { type: "string" },
    message: { type: "string" },
  },
};

function productNotFound(id: string) {
  return {
    statusCode: 404 as const,
    error: "Not Found",
    message: `Produto com id "${id}" não encontrado`,
  };
}

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
    async (request, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) {
        reply.code(404);
        return productNotFound(id);
      }

      // Client dedicado, não `pool.query()`: begin/select/update/commit
      // precisam sair pela MESMA conexão, senão cada chamada pega um cliente
      // diferente do pool e a transação (e o lock da linha) se perde.
      const client = await pool.connect();
      try {
        await client.query("begin");

        // `for update` trava a linha até commit/rollback: uma segunda
        // transação que peça lock nesse mesmo id fica esperando aqui, não lê
        // um `stock` desatualizado.
        const { rows } = await client.query<{ stock: number }>(
          `select stock from products
            where id = $1 and deleted_at is null
            for update`,
          [id],
        );

        if (rows.length === 0) {
          await client.query("rollback");
          reply.code(404);
          return productNotFound(id);
        }

        const { stock } = rows[0];
        if (stock <= 0) {
          await client.query("rollback");
          reply.code(409);
          return {
            statusCode: 409,
            error: "Conflict",
            message: "Produto sem estoque",
          };
        }

        const { rows: updated } = await client.query<{ stock: number }>(
          `update products set stock = $1, updated_at = now()
            where id = $2 and deleted_at is null
            returning stock`,
          [stock - 1, id],
        );

        await client.query("commit");
        return { productId: id, stockRemaining: updated[0].stock };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        // Sempre devolve a conexão ao pool — client não liberado é conexão
        // vazada, e o pool tem `max` limitado (ver DB_POOL_MAX em pool.ts).
        client.release();
      }
    },
  );
}
