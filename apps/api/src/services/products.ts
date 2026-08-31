import type {
  CreateProductInput,
  Product,
  UpdateProductInput,
} from "../domain/product.ts";
import type { Page, Pagination } from "../domain/pagination.ts";
import { isUuid } from "../domain/uuid.ts";
import { NotFoundError } from "../errors.ts";
import * as productsRepository from "../repositories/products.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de produtos: **a regra de negócio**.
 *
 * Uma regra vive aqui e em nenhum outro lugar: produto só existe dentro de um
 * restaurante vivo — por isso toda operação começa checando o pai
 * (`restaurantsService.ensureExists`).
 *
 * Dar baixa em estoque NÃO é responsabilidade daqui. Quem debita é a
 * confirmação de pedido (`services/orders.ts`), o único caminho do sistema que
 * tira unidade de `products.stock`.
 *
 * Como o serviço de restaurantes, não conhece Fastify nem escreve SQL.
 */

/** Erro padrão de produto inexistente — mesma mensagem em toda a API. */
function productNotFound(id: string): NotFoundError {
  return new NotFoundError(`Produto com id "${id}" não encontrado`);
}

export async function create(
  restaurantId: string,
  input: CreateProductInput,
): Promise<Product> {
  await restaurantsService.ensureExists(restaurantId);
  return productsRepository.insert(restaurantId, input);
}

/** Produtos de um restaurante. Restaurante sem produtos devolve página vazia. */
export async function listByRestaurant(
  restaurantId: string,
  pagination: Pagination,
): Promise<Page<Product>> {
  await restaurantsService.ensureExists(restaurantId);
  const { rows, total } = await productsRepository.findByRestaurant(
    restaurantId,
    pagination,
  );
  return { data: rows, ...pagination, total };
}

export async function getById(
  restaurantId: string,
  id: string,
): Promise<Product> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw productNotFound(id);

  const product = await productsRepository.findById(restaurantId, id);
  if (product === null) throw productNotFound(id);
  return product;
}

export async function update(
  restaurantId: string,
  id: string,
  input: UpdateProductInput,
): Promise<Product> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw productNotFound(id);

  const product = await productsRepository.update(restaurantId, id, input);
  if (product === null) throw productNotFound(id);
  return product;
}

export async function remove(restaurantId: string, id: string): Promise<void> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw productNotFound(id);

  const removed = await productsRepository.softDelete(restaurantId, id);
  if (!removed) throw productNotFound(id);
}
