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
