import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Order } from "../domain/order.ts";
import { isTerminalStatus } from "../domain/order.ts";
import * as orderEvents from "../events/orders.ts";
import * as ordersService from "../services/orders.ts";
import { errorResponseSchema } from "./schemas.ts";

/**
 * Acompanhamento do pedido em tempo real — a única rota WebSocket da API.
 *
 * Quem usa é o cliente que pediu entrega ou retirada. Pedido de salão não chega
 * aqui, e não por uma checagem: ele simplesmente não recebe token na criação,
 * então não existe com o que conectar.
 *
 * O canal é **só de leitura**. Nada que o cliente mande pelo socket é
 * interpretado — mudar o estado de um pedido é operação do restaurante, com
 * sessão, pelas rotas HTTP.
 */

declare module "fastify" {
  interface FastifyRequest {
    /** Preenchido no `preValidation` da rota de acompanhamento. */
    trackedOrder: Order | null;
  }
}

/** O que o canal transmite. Deliberadamente menor que o pedido inteiro. */
function toPayload(order: Order) {
  return {
    id: order.id,
    type: order.type,
    status: order.status,
    totalInCents: order.totalInCents,
    updatedAt: order.updatedAt,
  };
}

const paramsSchema = {
  type: "object",
  required: ["orderId"],
  properties: { orderId: { type: "string" } },
};

const querystringSchema = {
  type: "object",
  required: ["token"],
  properties: { token: { type: "string", minLength: 1 } },
};

export async function trackingRoutes(app: FastifyInstance) {
  // F18: nasce com valor "vazio" para o shape do objeto não mudar no meio.
  app.decorateRequest("trackedOrder", null);

  app.get<{ Params: { orderId: string }; Querystring: { token: string } }>(
    "/orders/:orderId/track",
    {
      websocket: true,
      // pública: quem pediu não tem conta. Quem autoriza é o token.
      config: { public: true },
      schema: {
        tags: ["Pedidos"],
        operationId: "trackOrder",
        summary: "Acompanha o pedido em tempo real (WebSocket)",
        description:
          "Faz upgrade para WebSocket. A primeira mensagem é sempre um `snapshot` com o estado atual — sem ela, uma conexão que caia e volte ficaria sem saber onde o pedido está. Depois vêm mensagens `status` a cada mudança, e o servidor fecha a conexão (código 1000) quando o pedido chega a `completed` ou `cancelled`. Autoriza pelo `token` devolvido na criação do pedido; pedido de salão não recebe token e não é acompanhável.",
        params: paramsSchema,
        querystring: querystringSchema,
        response: { 404: errorResponseSchema },
      },

      /**
       * A autorização acontece ANTES do upgrade: rota WebSocket passa pelos
       * hooks do Fastify, e responder num deles aborta o handshake com o
       * status HTTP. Deixar isso para dentro do handler abriria um socket só
       * para depois avisar que não era para ter aberto.
       *
       * É `preHandler`, e não `preValidation` — a diferença importa. O
       * `preValidation` roda ANTES da validação do schema, então lá o
       * `token` ainda pode ser `undefined`, e o hash dele estoura um 500 em vez
       * de responder 400. (Os exemplos do plugin usam `preValidation` porque
       * leem um header, que não passa por schema. Credencial em querystring,
       * não.)
       *
       * O token vai na querystring porque navegador não deixa mandar header no
       * handshake. É a razão de ele ser descartável e revogável, e não o id do
       * pedido: a URL entra em log de acesso e de proxy.
       */
      preHandler: async (request, reply) => {
        const { orderId } = request.params as { orderId: string };
        const { token } = request.query as { token: string };

        const order = await ordersService.findByTrackingToken(token);

        // Uma resposta só para "token inválido" e "token de outro pedido": a
        // diferença entre as duas diria a quem tenta se aquele pedido existe.
        if (order === null || order.id !== orderId) {
          return reply.code(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "Pedido não encontrado",
          });
        }

        request.trackedOrder = order;
      },
    },
    (socket, request: FastifyRequest) => {
      const order = request.trackedOrder as Order;

      function enviar(tipo: "snapshot" | "status", atual: Order) {
        socket.send(JSON.stringify({ type: tipo, order: toPayload(atual) }));
      }

      // Estado atual antes de qualquer delta. É o que faz uma reconexão no meio
      // do preparo mostrar "em preparo" em vez de uma tela vazia esperando um
      // evento que talvez nunca venha.
      enviar("snapshot", order);

      if (isTerminalStatus(order.status)) {
        socket.close(1000, "pedido finalizado");
        return;
      }

      const cancelarInscricao = orderEvents.subscribe(order.id, (atual) => {
        enviar("status", atual);

        // Fim do ciclo: não há mais o que transmitir, e socket aberto por
        // pedido concluído é vazamento lento. 1000 diz ao cliente que o
        // fechamento é normal e ele NÃO deve reconectar.
        if (isTerminalStatus(atual.status)) {
          socket.close(1000, "pedido finalizado");
        }
      });

      // Sem isto o listener sobrevive à conexão e o emissor segura a referência
      // do socket morto para sempre.
      socket.on("close", cancelarInscricao);
    },
  );
}
