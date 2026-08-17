import { withTransaction } from "../db/pool.ts";
import type {
  CreateRestaurantInput,
  Restaurant,
  UpdateRestaurantInput,
} from "../domain/restaurant.ts";
import { isUuid } from "../domain/uuid.ts";
import { NotFoundError } from "../errors.ts";
import * as productsRepository from "../repositories/products.ts";
import * as restaurantsRepository from "../repositories/restaurants.ts";

/**
 * Serviço de restaurantes: **a regra de negócio**.
 *
 * Não conhece Fastify — não recebe `request`, não devolve `reply` e não sabe o
 * que é status code. Quando algo não pode acontecer, lança um erro tipado
 * (`NotFoundError`), e o error handler central do `app.ts` traduz para HTTP.
 * Também não escreve SQL: isso é trabalho do repositório.
 */

/** Erro padrão de restaurante inexistente — mesma mensagem em toda a API. */
export function restaurantNotFound(id: string): NotFoundError {
  return new NotFoundError(`Restaurante com id "${id}" não encontrado`);
}

/**
 * Garante que existe um restaurante vivo com esse id, ou lança.
 * É a regra que o serviço de produtos usa antes de mexer em qualquer produto:
 * restaurante removido não pode ter filhos novos nem devolver os antigos (D2).
 */
export async function ensureExists(id: string): Promise<void> {
  // Formato errado nunca vira query: id inválido é 404, não 500 (S9).
  if (!isUuid(id)) throw restaurantNotFound(id);
  if (!(await restaurantsRepository.exists(id))) throw restaurantNotFound(id);
}

export async function create(
  input: CreateRestaurantInput,
): Promise<Restaurant> {
  return restaurantsRepository.insert(input);
}

/** Lista todos os vivos. Lista vazia é resultado válido, não erro. */
export async function list(): Promise<Restaurant[]> {
  return restaurantsRepository.findAll();
}

export async function getById(id: string): Promise<Restaurant> {
  if (!isUuid(id)) throw restaurantNotFound(id);

  const restaurant = await restaurantsRepository.findById(id);
  if (restaurant === null) throw restaurantNotFound(id);
  return restaurant;
}

export async function update(
  id: string,
  input: UpdateRestaurantInput,
): Promise<Restaurant> {
  if (!isUuid(id)) throw restaurantNotFound(id);

  const restaurant = await restaurantsRepository.update(id, input);
  if (restaurant === null) throw restaurantNotFound(id);
  return restaurant;
}

/**
 * Remove o restaurante **e os produtos dele** (soft delete em cascata, D3).
 *
 * Os dois updates valem juntos ou não valem: se o segundo falhar, o rollback
 * traz o restaurante de volta. Lançar o `NotFoundError` de dentro da transação
 * também dispara rollback — o que é correto, já que nada foi marcado.
 */
export async function remove(id: string): Promise<void> {
  if (!isUuid(id)) throw restaurantNotFound(id);

  await withTransaction(async (client) => {
    const removed = await restaurantsRepository.softDelete(id, client);
    if (!removed) throw restaurantNotFound(id);

    await productsRepository.softDeleteByRestaurant(id, client);
  });
}
