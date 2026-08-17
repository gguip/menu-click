import { withTransaction } from "../db/pool.ts";
import type {
  CreateProductInput,
  Product,
  Purchase,
  UpdateProductInput,
} from "../domain/product.ts";
import { isUuid } from "../domain/uuid.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import * as productsRepository from "../repositories/products.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de produtos: **a regra de negócio**.
 *
 * Duas regras vivem aqui e em nenhum outro lugar:
 *  1. produto só existe dentro de um restaurante vivo — por isso toda operação
 *     começa checando o pai (`restaurantsService.ensureExists`);
 *  2. a compra dá baixa no estoque dentro de uma transação, com a linha travada.
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

/** Produtos de um restaurante. Restaurante vazio devolve lista vazia. */
export async function listByRestaurant(
  restaurantId: string,
): Promise<Product[]> {
  await restaurantsService.ensureExists(restaurantId);
  return productsRepository.findByRestaurant(restaurantId);
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

/**
 * Compra uma unidade, protegida contra a race condition do check-then-act.
 *
 * O `select ... for update` do repositório trava a linha até o commit/rollback,
 * então uma segunda transação concorrente que tente ler o mesmo produto fica
 * bloqueada na sua própria leitura até esta terminar — nunca as duas leem o
 * mesmo `stock` ao mesmo tempo. Ler, decidir e gravar precisam sair pela MESMA
 * conexão, por isso tudo roda com o `client` da transação.
 *
 * Sair por exceção (`NotFoundError`/`ConflictError`) faz o `withTransaction`
 * dar rollback e soltar o lock antes de o erro subir.
 */
export async function purchase(id: string): Promise<Purchase> {
  if (!isUuid(id)) throw productNotFound(id);

  return withTransaction(async (client) => {
    const stock = await productsRepository.selectStockForUpdate(id, client);
    if (stock === null) throw productNotFound(id);
    if (stock <= 0) throw new ConflictError("Produto sem estoque");

    const stockRemaining = await productsRepository.updateStock(
      id,
      stock - 1,
      client,
    );
    return { productId: id, stockRemaining };
  });
}
