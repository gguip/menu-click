import type { PoolClient } from "pg";
import { withTransaction } from "../db/pool.ts";
import type { Page, Pagination } from "../domain/pagination.ts";
import type { OrderPeriod, PeriodFilter } from "../domain/period.ts";
import type {
  CreatedOrder,
  CreateOrderInput,
  Order,
  OrderStatus,
  OrderSummary,
  OrderType,
} from "../domain/order.ts";
import {
  canTransition,
  cancellingReturnsStock,
  isReachable,
  issuesTrackingToken,
} from "../domain/order.ts";
import { isUuid } from "../domain/uuid.ts";
import { ConflictError, NotFoundError, ValidationError } from "../errors.ts";
import * as customersRepository from "../repositories/customers.ts";
import * as ordersRepository from "../repositories/orders.ts";
import * as productsRepository from "../repositories/products.ts";
import { generateToken, hashToken } from "../tokens.ts";
import * as orderEvents from "../events/orders.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de pedidos: **a regra de negócio**.
 *
 * O que mora aqui e em nenhum outro lugar:
 *  1. o pedido congela nome e preço do produto no momento da criação — nada
 *     depois lê preço de `products` para calcular valor;
 *  2. o total é calculado no servidor, nunca aceito do cliente;
 *  3. pedido com entrega só existe em restaurante que entrega;
 *  4. criar pedido NÃO mexe em estoque (ver `confirm`, no próximo passo).
 *
 * Não há `services/customers.ts`: resolver o cliente é uma chamada só ao
 * repositório, sem regra própria, e uma camada de repasse não ganharia nada.
 */

/** Erro padrão de pedido inexistente — mesma mensagem em toda a API. */
function orderNotFound(id: string): NotFoundError {
  return new NotFoundError(`Pedido com id "${id}" não encontrado`);
}

/** Mesma mensagem do serviço de produtos, para o cliente não ver duas formas. */
function productNotFound(id: string): NotFoundError {
  return new NotFoundError(`Produto com id "${id}" não encontrado`);
}

/** Como cada modalidade se chama para quem lê a mensagem de erro. */
const NOME_DA_MODALIDADE: Record<OrderType, string> = {
  dine_in: "pedido no salão",
  takeaway: "retirada",
  delivery: "entrega",
};

/**
 * O restaurante aceita essa modalidade?
 *
 * As três flags são simétricas de propósito: sem `isTakeaway`, um restaurante
 * que só entrega passaria a aceitar retirada por omissão.
 */
function assertRestauranteAceita(
  restaurant: { isDelivery: boolean; isQrcode: boolean; isTakeaway: boolean },
  type: OrderType,
): void {
  const aceita: Record<OrderType, boolean> = {
    dine_in: restaurant.isQrcode,
    takeaway: restaurant.isTakeaway,
    delivery: restaurant.isDelivery,
  };

  if (!aceita[type]) {
    throw new ConflictError(
      `Este restaurante não aceita ${NOME_DA_MODALIDADE[type]}`,
    );
  }
}

/**
 * Endereço é obrigatório na entrega e proibido nas outras duas.
 *
 * É 400 e não 409: não é o estado do sistema que impede, é o corpo da
 * requisição que não faz sentido. O banco tem o mesmo check — aqui a checagem
 * existe para o cliente receber uma mensagem em vez de um 500 de constraint.
 */
function assertEnderecoCoerente(input: CreateOrderInput): void {
  const temEndereco = input.deliveryAddress !== undefined;

  if (input.type === "delivery" && !temEndereco) {
    throw new ValidationError("Pedido de entrega exige `deliveryAddress`");
  }
  if (input.type !== "delivery" && temEndereco) {
    throw new ValidationError(
      `Pedido de ${NOME_DA_MODALIDADE[input.type]} não leva \`deliveryAddress\``,
    );
  }
}

/**
 * Cria o pedido inteiro numa transação: cliente, pedido e itens valem juntos ou
 * nenhum vale. Sem ela, um erro na gravação dos itens deixaria um pedido órfão
 * com total já calculado e nenhuma linha.
 */
export async function create(
  restaurantId: string,
  input: CreateOrderInput,
): Promise<CreatedOrder> {
  const restaurant = await restaurantsService.getById(restaurantId);
  assertRestauranteAceita(restaurant, input.type);
  assertEnderecoCoerente(input);

  // Duas linhas do mesmo produto viram uma com a quantidade somada. É o que um
  // carrinho faz, e apaga de vez o caso em que a confirmação teria que travar e
  // debitar o mesmo produto duas vezes na mesma transação.
  const quantityByProduct = new Map<string, number>();
  for (const item of input.items) {
    // S9: id fora do formato viraria `invalid input syntax for type uuid` (500)
    if (!isUuid(item.productId)) throw productNotFound(item.productId);
    const current = quantityByProduct.get(item.productId) ?? 0;
    quantityByProduct.set(item.productId, current + item.quantity);
  }

  const productIds = [...quantityByProduct.keys()];

  // Quem acompanha o pedido recebe um token; quem está no salão, não. É por
  // não existir credencial que o pedido de mesa não tem como ser acompanhado —
  // e não por uma checagem que alguém possa remover.
  const trackingToken = issuesTrackingToken(input.type) ? generateToken() : null;

  return withTransaction(async (client) => {
    const products = await productsRepository.findManyByIds(
      restaurantId,
      productIds,
      client,
    );
    const byId = new Map(products.map((product) => [product.id, product]));

    const items = productIds.map((productId) => {
      const product = byId.get(productId);
      // some do cardápio (ou nunca foi deste restaurante) = não dá pra pedir
      if (product === undefined) throw productNotFound(productId);
      return {
        productId,
        // cópias congeladas: daqui pra frente o pedido não depende de `products`
        name: product.name,
        priceInCents: product.priceInCents,
        quantity: quantityByProduct.get(productId) as number,
      };
    });

    // total sempre calculado aqui — aceitar do cliente seria deixar o preço
    // ser escolhido por quem paga
    const totalInCents = items.reduce(
      (sum, item) => sum + item.priceInCents * item.quantity,
      0,
    );

    const customer = await customersRepository.upsertByPhone(
      input.customer,
      client,
    );

    const orderId = await ordersRepository.insertOrder(
      restaurantId,
      {
        customerId: customer.id,
        type: input.type,
        totalInCents,
        deliveryAddress: input.deliveryAddress,
        trackingTokenHash:
          trackingToken === null ? null : hashToken(trackingToken),
      },
      client,
    );
    await ordersRepository.insertItems(orderId, items, client);

    // relido pela mesma conexão da transação, então enxerga o que acabou de ser
    // gravado (e sai já no formato da resposta, com cliente e itens)
    const order = await ordersRepository.findById(restaurantId, orderId, client);

    // única vez que o token existe fora do cliente; o banco só tem o hash
    return {
      ...(order as Order),
      ...(trackingToken === null ? {} : { trackingToken }),
    };
  });
}

/** Pedidos de um restaurante, opcionalmente filtrados por status. */
/** O que a querystring do painel pode trazer além da paginação. */
export type OrderListFilters = {
  status?: OrderStatus;
  period?: OrderPeriod;
  from?: string;
  to?: string;
};

/**
 * Traduz a querystring no recorte de tempo, ou recusa a combinação com 400.
 *
 * As duas formas atendem controles diferentes na tela (os botões e o seletor
 * de datas), e mandar as duas juntas não tem resposta certa: não existe "hoje,
 * de 1 a 5 de agosto". Aceitar em silêncio, ignorando uma delas, devolveria um
 * número que não é o que ninguém pediu — e num painel de faturamento isso é
 * pior do que um erro.
 */
export function resolvePeriodFilter({
  period,
  from,
  to,
}: Pick<OrderListFilters, "period" | "from" | "to">): PeriodFilter | undefined {
  const temIntervalo = from !== undefined || to !== undefined;

  if (period !== undefined && temIntervalo) {
    throw new ValidationError(
      'Use "period" ou "from"/"to", não os dois na mesma requisição',
    );
  }

  if (period !== undefined) return { kind: "named", name: period };
  if (!temIntervalo) return undefined;

  // Comparação de string funciona aqui porque o formato é YYYY-MM-DD, validado
  // por `format: "date"` no schema — nele, ordem lexicográfica é ordem
  // cronológica. Não vale para data em qualquer outro formato.
  if (from !== undefined && to !== undefined && from > to) {
    throw new ValidationError(`O período começa depois de terminar: ${from} > ${to}`);
  }

  return { kind: "range", from, to };
}

/**
 * Pedidos do restaurante, com os filtros do painel.
 *
 * Carrega o restaurante inteiro (e não só confirma que ele existe) porque o
 * recorte de tempo é resolvido **no fuso dele**: sem o fuso, "hoje" seria o do
 * servidor, e um restaurante em Manaus veria o dia trocar uma hora antes.
 */
export async function listByRestaurant(
  restaurantId: string,
  pagination: Pagination,
  filters: OrderListFilters = {},
): Promise<Page<OrderSummary>> {
  const period = resolvePeriodFilter(filters);
  const restaurant = await restaurantsService.getById(restaurantId);

  const { rows, total } = await ordersRepository.findByRestaurant(
    restaurantId,
    pagination,
    { status: filters.status, period },
    restaurant.timezone,
  );
  return { data: rows, ...pagination, total };
}

/**
 * Resolve um token de acompanhamento no pedido correspondente, ou `null`.
 *
 * Não recebe `restaurantId`: quem acompanha é o cliente, que não sabe (nem
 * precisa saber) em qual restaurante pediu. Quem escopa é o token — ele vale
 * para um pedido e só um.
 */
export async function findByTrackingToken(
  token: string,
): Promise<Order | null> {
  const found = await ordersRepository.findByTrackingTokenHash(
    hashToken(token),
  );
  if (found === null) return null;

  return ordersRepository.findById(found.restaurantId, found.id);
}

export async function getById(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(orderId)) throw orderNotFound(orderId);

  const order = await ordersRepository.findById(restaurantId, orderId);
  if (order === null) throw orderNotFound(orderId);
  return order;
}

/**
 * Debita o estoque de todos os itens do pedido. Só a confirmação chama.
 *
 * Confere TODOS antes de debitar QUALQUER um: o rollback resolveria de
 * qualquer jeito, mas conferir antes deixa a regra explícita em vez de
 * depender do desfazer.
 */
async function debitarEstoque(
  orderId: string,
  client: PoolClient,
): Promise<void> {
  const items = await ordersRepository.findItems(orderId, client);
  const stocks = await productsRepository.selectStocksForUpdate(
    items.map((item) => item.productId),
    client,
  );
  const stockById = new Map(stocks.map((row) => [row.id, row.stock]));

  for (const item of items) {
    const stock = stockById.get(item.productId);
    // produto removido do cardápio entre o pedido e a confirmação
    if (stock === undefined) {
      throw new ConflictError(
        `O produto "${item.name}" saiu do cardápio e o pedido não pode ser confirmado`,
      );
    }
    if (stock < item.quantity) {
      throw new ConflictError(
        `Estoque insuficiente de "${item.name}": ${item.quantity} pedidos, ${stock} disponíveis`,
      );
    }
  }

  for (const item of items) {
    await productsRepository.decrementStock(
      item.productId,
      item.quantity,
      client,
    );
  }
}

/**
 * Devolve ao estoque o que o pedido tinha debitado.
 *
 * Trava as mesmas linhas, na mesma ordem por id, pelo mesmo motivo do débito —
 * sem o lock, dois cancelamentos concorrentes do mesmo pedido devolveriam as
 * unidades duas vezes.
 *
 * Produto que saiu do cardápio no meio do caminho é ignorado em silêncio: não
 * há linha viva para devolver, e barrar o cancelamento por isso deixaria o
 * pedido preso num estado que ninguém pediu.
 */
async function devolverEstoque(
  orderId: string,
  client: PoolClient,
): Promise<void> {
  const items = await ordersRepository.findItems(orderId, client);
  const stocks = await productsRepository.selectStocksForUpdate(
    items.map((item) => item.productId),
    client,
  );
  const vivos = new Set(stocks.map((row) => row.id));

  for (const item of items) {
    if (!vivos.has(item.productId)) continue;
    await productsRepository.incrementStock(
      item.productId,
      item.quantity,
      client,
    );
  }
}

/**
 * A transição de status, e o único caminho por onde o pedido muda de estado.
 *
 * Tudo numa transação, com o pedido travado desde a leitura: sem isso duas
 * transições simultâneas leem o mesmo estado, as duas se acham legais, e as
 * duas gravam — o que na confirmação significaria debitar estoque duas vezes.
 *
 * As regras de quem pode ir para onde moram no mapa de `domain/order.ts`. Aqui
 * só se aplica o mapa e se decide o efeito colateral de cada destino.
 */
async function transitionTo(
  restaurantId: string,
  orderId: string,
  to: OrderStatus,
): Promise<Order> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(orderId)) throw orderNotFound(orderId);

  return withTransaction(async (client) => {
    const atual = await ordersRepository.selectForUpdate(
      restaurantId,
      orderId,
      client,
    );
    if (atual === null) throw orderNotFound(orderId);

    if (!canTransition(atual.type, atual.status, to)) {
      // duas mensagens diferentes porque as causas são diferentes, e dizer
      // "não pode ir de preparing para out_for_delivery" num pedido de
      // retirada esconderia que o problema é a modalidade, não o estado
      throw new ConflictError(
        isReachable(atual.type, to)
          ? `Pedido não pode ir para "${to}": está em "${atual.status}"`
          : `Pedido de ${NOME_DA_MODALIDADE[atual.type]} não passa por "${to}"`,
      );
    }

    if (to === "confirmed") {
      await debitarEstoque(orderId, client);
    }
    if (to === "cancelled" && cancellingReturnsStock(atual.status)) {
      await devolverEstoque(orderId, client);
    }

    await ordersRepository.updateStatus(orderId, to, client);

    const order = await ordersRepository.findById(restaurantId, orderId, client);
    return order as Order;
  });
}

/**
 * Aplica a transição e anuncia o novo estado.
 *
 * O `publish` acontece **fora** do `withTransaction`, e isso não é estilo: de
 * dentro dele o evento sairia antes do commit, e um rollback deixaria o cliente
 * vendo um estado que não aconteceu.
 */
async function transitionAndPublish(
  restaurantId: string,
  orderId: string,
  to: OrderStatus,
): Promise<Order> {
  const order = await transitionTo(restaurantId, orderId, to);
  orderEvents.publish(order);
  return order;
}

/**
 * Aceita o pedido e debita o estoque — o único ponto do sistema que tira
 * unidade de `products.stock`.
 *
 * Consequência de debitar só aqui: pedido `pending` não é reserva. Dois pedidos
 * podem existir para a última unidade — o primeiro a confirmar leva, o segundo
 * recebe 409. É o custo escolhido para não segurar estoque de pedido que talvez
 * nunca seja confirmado.
 */
export async function confirm(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "confirmed");
}

/** Manda o pedido para a cozinha. Não mexe em estoque. */
export async function startPreparing(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "preparing");
}

/** Saiu para entrega. Só existe na trilha de `delivery`. */
export async function dispatch(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "out_for_delivery");
}

/** Pronto no balcão. Só existe na trilha de `takeaway`. */
export async function markReady(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "ready_for_pickup");
}

/** Fim do ciclo: entregue, retirado ou servido, conforme a modalidade. */
export async function complete(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "completed");
}

/**
 * Cancela o pedido, devolvendo o estoque quando ainda faz sentido.
 *
 * O corte é "a comida já existe": em `confirmed` e `preparing` as unidades
 * voltam, em `out_for_delivery` e `ready_for_pickup` não — o prato foi feito, e
 * devolvê-lo ao estoque seria mentir sobre o que há na cozinha. A regra mora em
 * `cancellingReturnsStock`, no domínio.
 */
export async function cancel(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "cancelled");
}
