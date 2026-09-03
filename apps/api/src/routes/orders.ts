import type { FastifyInstance } from "fastify";
import type { CreateOrderInput, OrderStatus } from "../domain/order.ts";
import {
  ORDER_SORT_FIELDS,
  ORDER_STATUSES,
  ORDER_TYPES,
  SORT_DIRECTIONS,
} from "../domain/order.ts";
import type { OrderSortField, SortDirection } from "../domain/order.ts";
import { ORDER_PERIODS } from "../domain/period.ts";
import type { OrderPeriod } from "../domain/period.ts";
import type { Pagination } from "../domain/pagination.ts";
import * as ordersService from "../services/orders.ts";
import { installRouteValidators } from "./validators.ts";
import {
  addressProperties,
  addressSchema,
  errorResponseSchema,
  pageResponseSchema,
  paginationQuerystringSchema,
} from "./schemas.ts";

/**
 * Rotas de pedidos — camada HTTP (controller), aninhadas em restaurantes.
 *
 * Só HTTP. Congelar preço, calcular total e decidir se o restaurante entrega
 * são regra de negócio e moram no serviço; aqui elas chegam como
 * `NotFoundError`/`ConflictError` e viram 404/409 no error handler central.
 */

// ===================== JSON Schemas =====================

const createOrderBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "customer", "items"],
  properties: {
    // decide a trilha de status, se exige endereço e se há acompanhamento
    type: { type: "string", enum: [...ORDER_TYPES] },
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["name", "phone"],
      properties: {
        name: { type: "string", minLength: 1 },
        phone: { type: "string", minLength: 1 },
      },
    },
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["productId", "quantity"],
        properties: {
          productId: { type: "string", format: "uuid" },
          quantity: { type: "integer", minimum: 1 },
          // ausente = nenhuma opção; o serviço confere contra os grupos do
          // produto (obrigatoriedade, teto de opções, teto de unidades,
          // disponibilidade) — tudo isso é 400, não 404: é a montagem do
          // pedido que falha, não um recurso ausente
          options: {
            type: "array",
            default: [],
            items: {
              type: "object",
              additionalProperties: false,
              required: ["optionId", "quantity"],
              properties: {
                optionId: { type: "string", format: "uuid" },
                quantity: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      },
    },
    // obrigatório em `delivery`, recusado nas outras duas (400)
    deliveryAddress: addressSchema,
  },
  // `totalInCents` não está aqui de propósito: o total é calculado no servidor.
  // Aceitá-lo do cliente seria deixar quem paga escolher o preço.
};

const customerResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    phone: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

/** Uma opção escolhida, como congelada no item — nunca lida de `options`. */
const orderItemOptionResponseSchema = {
  type: "object",
  properties: {
    optionId: { type: "string" },
    groupName: { type: "string" },
    name: { type: "string" },
    priceInCents: { type: "integer" },
    quantity: { type: "integer" },
  },
};

const orderItemResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    productId: { type: "string" },
    name: { type: "string" },
    priceInCents: { type: "integer" },
    // preço de UMA unidade já com as opções escolhidas; `priceInCents` acima
    // continua sendo só o preço do produto
    unitPriceInCents: { type: "integer" },
    quantity: { type: "integer" },
    options: { type: "array", items: orderItemOptionResponseSchema },
  },
};

const orderSummaryProperties = {
  id: { type: "string" },
  restaurantId: { type: "string" },
  customer: customerResponseSchema,
  type: { type: "string" },
  status: { type: "string" },
  totalInCents: { type: "integer" },
  // `nullable` em vez de `anyOf: [..., {type:"null"}]` (F12); null fora de delivery
  deliveryAddress: {
    type: "object",
    nullable: true,
    properties: addressProperties,
  },
  createdAt: { type: "string" },
  updatedAt: { type: "string" },
};

/** A listagem não devolve itens — ver o comentário de `OrderSummary`. */
const orderSummaryResponseSchema = {
  type: "object",
  properties: orderSummaryProperties,
};

const orderResponseSchema = {
  type: "object",
  properties: {
    ...orderSummaryProperties,
    items: { type: "array", items: orderItemResponseSchema },
  },
};

/**
 * A resposta da CRIAÇÃO, e só dela, carrega o token de acompanhamento.
 *
 * É schema separado de propósito. O `fast-json-stringify` só serializa o que
 * está declarado, então o token não tem como escapar para a listagem nem para
 * o detalhe do pedido — que são rotas do restaurante, e entregariam a
 * credencial de todos os clientes ao painel (S10).
 *
 * Ausente em `dine_in`: quem está no salão não acompanha, e por isso não recebe
 * credencial nenhuma.
 */
const createdOrderResponseSchema = {
  type: "object",
  properties: {
    ...orderSummaryProperties,
    items: { type: "array", items: orderItemResponseSchema },
    trackingToken: { type: "string" },
  },
};

const orderPageResponseSchema = pageResponseSchema(orderSummaryResponseSchema);

/** Paginação mais os filtros do painel: status e recorte de tempo. */
const orderListQuerystringSchema = {
  ...paginationQuerystringSchema,
  properties: {
    ...paginationQuerystringSchema.properties,
    // enum fechado: o valor chega ao SQL como `$n` comparado a uma coluna,
    // nunca como identificador — e mesmo assim só passa o que está na lista
    status: { type: "string", enum: [...ORDER_STATUSES] },
    // os atalhos do painel; o recorte é resolvido no fuso do restaurante
    period: { type: "string", enum: [...ORDER_PERIODS] },
    // datas locais do seletor, não instantes: `format: "date"` é YYYY-MM-DD.
    // Mandar `period` junto com estas é 400 — quem recusa é o serviço, porque
    // "um ou outro" não cabe num JSON Schema sem `oneOf` ilegível.
    from: { type: "string", format: "date" },
    to: { type: "string", format: "date" },
    // allowlist (S3): `order by` não aceita `$n`, então o que passa é só o que
    // está nesta lista, traduzido por um mapa fixo no repositório
    sort: { type: "string", enum: [...ORDER_SORT_FIELDS], default: "createdAt" },
    order: { type: "string", enum: [...SORT_DIRECTIONS], default: "desc" },
  },
};

/** O resumo aceita o mesmo recorte de tempo da listagem, e nada além dele. */
const orderSummaryQuerystringSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    period: { type: "string", enum: [...ORDER_PERIODS] },
    from: { type: "string", format: "date" },
    to: { type: "string", format: "date" },
  },
};

const orderSummaryTotalsResponseSchema = {
  type: "object",
  properties: {
    // os instantes que o servidor realmente usou; cada lado some quando o
    // período é aberto daquele lado. É o que torna o número conferível sem
    // abrir o banco quando alguém estranha um faturamento zerado
    period: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
    },
    counts: {
      type: "object",
      properties: Object.fromEntries(
        ORDER_STATUSES.map((status) => [status, { type: "integer" }]),
      ),
    },
    revenueInCents: { type: "integer" },
    revenueOrderCount: { type: "integer" },
    averageTicketInCents: { type: "integer" },
  },
};

const restaurantIdParamsSchema = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: { type: "string" } },
};

const orderParamsSchema = {
  type: "object",
  required: ["restaurantId", "orderId"],
  properties: {
    restaurantId: { type: "string" },
    orderId: { type: "string" },
  },
};

type OrderListQuery = Pagination & {
  status?: OrderStatus;
  period?: OrderPeriod;
  from?: string;
  to?: string;
  sort?: OrderSortField;
  order?: SortDirection;
};

// ===================== Rotas =====================

/** Plugin encapsulado: os validadores abaixo não vazam para as irmãs (F2). */
export async function orderRoutes(app: FastifyInstance) {
  installRouteValidators(app);

  // Criar pedido. Nasce `pending` e NÃO mexe em estoque — a baixa acontece na
  // confirmação do restaurante.
  app.post<{ Params: { restaurantId: string }; Body: CreateOrderInput }>(
    "/restaurants/:restaurantId/orders",
    {
      // pública: quem escaneia o QR code pede sem ter conta. As demais rotas
      // de pedido (listar, confirmar, cancelar) são do restaurante.
      config: { public: true },
      schema: {
        tags: ["Pedidos"],
        operationId: "createOrder",
        summary: "Cria um pedido (público)",
        description:
          "Quem pede não precisa ter conta. Devolve `trackingToken` em `takeaway` e `delivery` — é a credencial do acompanhamento em tempo real, e ela aparece **só aqui**. O total é calculado no servidor — `totalInCents` nem existe no corpo. Os itens congelam nome, preço e as opções escolhidas do produto, então reajuste de cardápio (ou de opção) não muda pedido já feito. Cada item pode trazer `options` com as opções escolhidas nos grupos ligados ao produto; toda violação (grupo obrigatório sem escolha, teto de opções ou de unidades, opção indisponível ou de outro produto) é 400. Duas linhas com o mesmo produto E as mesmas opções viram uma, com a quantidade somada — opções diferentes geram linhas separadas. NÃO debita estoque: isso é a confirmação. Endereço de entrega ausente = pedido de mesa; presente em restaurante que não entrega = 409.",
        params: restaurantIdParamsSchema,
        body: createOrderBodySchema,
        response: {
          201: createdOrderResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const order = await ordersService.create(
        request.params.restaurantId,
        request.body,
      );
      reply.code(201);
      return order;
    },
  );

  // Listar pedidos do restaurante, opcionalmente por status
  app.get<{ Params: { restaurantId: string }; Querystring: OrderListQuery }>(
    "/restaurants/:restaurantId/orders",
    {
      schema: {
        tags: ["Pedidos"],
        operationId: "listOrders",
        summary: "Pedidos do restaurante",
        description:
          "Sem os itens — use a rota de detalhe para eles. Filtros opcionais: `status`, e o recorte de tempo por `period` (`today`, `yesterday`, `last7days`, `thisMonth`) **ou** por `from`/`to` (datas `YYYY-MM-DD`, intervalo fechado nos dois lados). Mandar os dois juntos é 400. O recorte é resolvido no **fuso do restaurante**, então \"hoje\" é o dia de quem está no salão, não o do servidor. Os filtros valem também para o `total`. A ordem padrão é **do mais novo para o mais antigo** — o painel existe para ver o pedido que acabou de chegar; `?sort=createdAt|totalInCents` e `?order=asc|desc` mudam isso.",
        params: restaurantIdParamsSchema,
        querystring: orderListQuerystringSchema,
        response: { 200: orderPageResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      const { limit, offset, status, period, from, to, sort, order } =
        request.query;
      return ordersService.listByRestaurant(
        request.params.restaurantId,
        { limit, offset },
        { status, period, from, to, sort, order },
      );
    },
  );

  // Resumo do painel. Rota ESTÁTICA, e por isso ela precisa conviver com
  // `/orders/:orderId`: o roteador do Fastify prefere segmento estático a
  // paramétrico, então "summary" nunca é lido como um id de pedido. Há teste.
  app.get<{
    Params: { restaurantId: string };
    Querystring: { period?: OrderPeriod; from?: string; to?: string };
  }>(
    "/restaurants/:restaurantId/orders/summary",
    {
      schema: {
        tags: ["Pedidos"],
        operationId: "getOrdersSummary",
        summary: "Resumo do período para o painel",
        description:
          "Contadores por status, faturamento e ticket médio. Faturamento é o que o restaurante **aceitou vender**: de `confirmed` em diante, sem `pending` (ainda não é venda) nem `cancelled` (deixou de ser) — contar só `completed` mostraria quase zero no pico do almoço. Aceita o mesmo recorte da listagem (`period` **ou** `from`/`to`), resolvido no fuso do restaurante, e devolve em `period` os instantes que usou.",
        params: restaurantIdParamsSchema,
        querystring: orderSummaryQuerystringSchema,
        response: {
          200: orderSummaryTotalsResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { period, from, to } = request.query;
      return ordersService.summary(request.params.restaurantId, {
        period,
        from,
        to,
      });
    },
  );

  // Confirmar o pedido: é AQUI que o estoque é debitado
  app.post<{ Params: { restaurantId: string; orderId: string } }>(
    "/restaurants/:restaurantId/orders/:orderId/confirm",
    {
      schema: {
        tags: ["Pedidos"],
        operationId: "confirmOrder",
        summary: "Confirma o pedido e debita o estoque",
        description:
          "O ÚNICO ponto do sistema que tira unidade de `products.stock`. Todos os itens são conferidos antes de qualquer débito; faltando estoque de um só, nada é debitado e a resposta é 409. Só pedido `pending` pode ser confirmado. Pedido pendente não é reserva: dois pedidos podem existir para a última unidade, e o primeiro a confirmar leva.",
        params: orderParamsSchema,
        response: {
          200: orderResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { restaurantId, orderId } = request.params;
      return ordersService.confirm(restaurantId, orderId);
    },
  );

  // Manda para a cozinha. Vale nas três modalidades.
  app.post<{ Params: { restaurantId: string; orderId: string } }>(
    "/restaurants/:restaurantId/orders/:orderId/start-preparing",
    {
      schema: {
        tags: ["Pedidos"],
        operationId: "startPreparingOrder",
        summary: "Manda o pedido para a cozinha",
        description:
          "Transição `confirmed → preparing`, nas três modalidades. Não mexe em estoque — o débito acontece na confirmação.",
        params: orderParamsSchema,
        response: {
          200: orderResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { restaurantId, orderId } = request.params;
      return ordersService.startPreparing(restaurantId, orderId);
    },
  );

  // Só na trilha de entrega.
  app.post<{ Params: { restaurantId: string; orderId: string } }>(
    "/restaurants/:restaurantId/orders/:orderId/dispatch",
    {
      schema: {
        tags: ["Pedidos"],
        operationId: "dispatchOrder",
        summary: "Saiu para entrega",
        description:
          "Transição `preparing → out_for_delivery`, **só em pedido de entrega**. Em retirada ou salão responde 409, porque esses estados não existem naquelas trilhas.",
        params: orderParamsSchema,
        response: {
          200: orderResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { restaurantId, orderId } = request.params;
      return ordersService.dispatch(restaurantId, orderId);
    },
  );

  // Só na trilha de retirada.
  app.post<{ Params: { restaurantId: string; orderId: string } }>(
    "/restaurants/:restaurantId/orders/:orderId/ready",
    {
      schema: {
        tags: ["Pedidos"],
        operationId: "markOrderReady",
        summary: "Disponível para retirada",
        description:
          "Transição `preparing → ready_for_pickup`, **só em pedido de retirada**. É o momento em que o cliente é avisado de que pode buscar.",
        params: orderParamsSchema,
        response: {
          200: orderResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { restaurantId, orderId } = request.params;
      return ordersService.markReady(restaurantId, orderId);
    },
  );

  // Fim do ciclo, nas três modalidades.
  app.post<{ Params: { restaurantId: string; orderId: string } }>(
    "/restaurants/:restaurantId/orders/:orderId/complete",
    {
      schema: {
        tags: ["Pedidos"],
        operationId: "completeOrder",
        summary: "Conclui o pedido",
        description:
          "Último passo de cada trilha: entregue, retirado ou servido. O banco guarda um estado só (`completed`); a palavra na tela vem da modalidade do pedido.",
        params: orderParamsSchema,
        response: {
          200: orderResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { restaurantId, orderId } = request.params;
      return ordersService.complete(restaurantId, orderId);
    },
  );

  // Cancelar. Devolve estoque conforme o estado de origem.
  app.post<{ Params: { restaurantId: string; orderId: string } }>(
    "/restaurants/:restaurantId/orders/:orderId/cancel",
    {
      schema: {
        tags: ["Pedidos"],
        operationId: "cancelOrder",
        summary: "Cancela o pedido",
        description:
          "Cancela a partir de qualquer estado não terminal. O estoque volta quando o pedido ainda estava em `confirmed` ou `preparing`; depois que saiu para entrega ou ficou pronto no balcão, não — o prato já existe, e devolvê-lo ao estoque seria mentir sobre o que há na cozinha.",
        params: orderParamsSchema,
        response: {
          200: orderResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { restaurantId, orderId } = request.params;
      return ordersService.cancel(restaurantId, orderId);
    },
  );

  // Buscar pedido específico, com os itens
  app.get<{ Params: { restaurantId: string; orderId: string } }>(
    "/restaurants/:restaurantId/orders/:orderId",
    {
      schema: {
        tags: ["Pedidos"],
        operationId: "getOrder",
        summary: "Detalhe do pedido, com os itens",
        description:
          "Os itens trazem o nome e o preço congelados no momento do pedido, que podem divergir do cardápio atual.",
        params: orderParamsSchema,
        response: { 200: orderResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      const { restaurantId, orderId } = request.params;
      return ordersService.getById(restaurantId, orderId);
    },
  );
}
