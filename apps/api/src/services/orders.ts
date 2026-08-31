import { withTransaction } from "../db/pool.ts";
import type { Page, Pagination } from "../domain/pagination.ts";
import type {
  CreateOrderInput,
  Order,
  OrderStatus,
  OrderSummary,
} from "../domain/order.ts";
import { isUuid } from "../domain/uuid.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import * as customersRepository from "../repositories/customers.ts";
import * as ordersRepository from "../repositories/orders.ts";
import * as productsRepository from "../repositories/products.ts";
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

/**
 * Cria o pedido inteiro numa transação: cliente, pedido e itens valem juntos ou
 * nenhum vale. Sem ela, um erro na gravação dos itens deixaria um pedido órfão
 * com total já calculado e nenhuma linha.
 */
export async function create(
  restaurantId: string,
  input: CreateOrderInput,
): Promise<Order> {
  const restaurant = await restaurantsService.getById(restaurantId);

  if (input.deliveryAddress !== undefined && !restaurant.isDelivery) {
    throw new ConflictError(
      "Este restaurante não faz entrega; peça sem endereço de entrega",
    );
  }

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
        totalInCents,
        deliveryAddress: input.deliveryAddress,
      },
      client,
    );
    await ordersRepository.insertItems(orderId, items, client);

    // relido pela mesma conexão da transação, então enxerga o que acabou de ser
    // gravado (e sai já no formato da resposta, com cliente e itens)
    const order = await ordersRepository.findById(restaurantId, orderId, client);
    return order as Order;
  });
}

/** Pedidos de um restaurante, opcionalmente filtrados por status. */
export async function listByRestaurant(
  restaurantId: string,
  pagination: Pagination,
  status?: OrderStatus,
): Promise<Page<OrderSummary>> {
  await restaurantsService.ensureExists(restaurantId);
  const { rows, total } = await ordersRepository.findByRestaurant(
    restaurantId,
    pagination,
    status,
  );
  return { data: rows, ...pagination, total };
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
 * Confirma o pedido e debita o estoque — o único ponto do sistema que tira
 * unidade de `products.stock`.
 *
 * A transação faz três coisas que precisam valer juntas: travar o pedido,
 * travar os produtos e gravar. A ordem importa:
 *
 *  1. `selectStatusForUpdate` trava o PEDIDO. Duas confirmações simultâneas do
 *     mesmo pedido se serializam aqui — a segunda acorda vendo `confirmed`.
 *  2. `selectStocksForUpdate` trava os PRODUTOS, sempre na mesma ordem (por
 *     id), senão dois pedidos com produtos em comum entrariam em deadlock.
 *  3. Só depois de conferir TODOS os itens é que algum é debitado. O rollback
 *     resolveria de qualquer jeito, mas conferir antes deixa a regra explícita
 *     em vez de depender do desfazer.
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
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(orderId)) throw orderNotFound(orderId);

  return withTransaction(async (client) => {
    const status = await ordersRepository.selectStatusForUpdate(
      restaurantId,
      orderId,
      client,
    );
    if (status === null) throw orderNotFound(orderId);
    if (status !== "pending") {
      throw new ConflictError(
        `Pedido não pode ser confirmado: já está "${status}"`,
      );
    }

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
    await ordersRepository.updateStatus(orderId, "confirmed", client);

    const order = await ordersRepository.findById(restaurantId, orderId, client);
    return order as Order;
  });
}

/**
 * Cancela um pedido pendente. Não mexe em estoque, porque pedido pendente nunca
 * chegou a debitar nada.
 *
 * Pedido já confirmado não é cancelável: devolver estoque é uma operação
 * própria (e uma decisão de negócio — devolve sempre? só antes de sair para
 * entrega?), e fazer isso por tabela aqui seria adivinhar.
 */
export async function cancel(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(orderId)) throw orderNotFound(orderId);

  return withTransaction(async (client) => {
    const status = await ordersRepository.selectStatusForUpdate(
      restaurantId,
      orderId,
      client,
    );
    if (status === null) throw orderNotFound(orderId);
    if (status !== "pending") {
      throw new ConflictError(
        `Pedido não pode ser cancelado: já está "${status}"`,
      );
    }

    await ordersRepository.updateStatus(orderId, "cancelled", client);

    const order = await ordersRepository.findById(restaurantId, orderId, client);
    return order as Order;
  });
}
