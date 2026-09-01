import type {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "../domain/category.ts";
import type { Page, Pagination } from "../domain/pagination.ts";
import { isUuid } from "../domain/uuid.ts";
import { withTransaction } from "../db/pool.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import * as categoriesRepository from "../repositories/categories.ts";
import * as productsRepository from "../repositories/products.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de categorias: **a regra de negócio**.
 *
 * Vale a mesma regra dos produtos — categoria só existe dentro de restaurante
 * vivo, então toda operação começa checando o pai. Como o serviço de produtos,
 * não conhece Fastify nem escreve SQL.
 */

/** Erro padrão de categoria inexistente — mesma mensagem em toda a API. */
function categoryNotFound(id: string): NotFoundError {
  return new NotFoundError(`Categoria com id "${id}" não encontrada`);
}

/**
 * Nome repetido é **409**, nunca sufixo automático.
 *
 * É o oposto da política do `slug`, e de propósito: lá o nome derivado é um
 * palpite do servidor, então ajustá-lo é serviço prestado. Aqui o nome foi
 * digitado por quem edita o cardápio, e "Bebidas (2)" aparecendo na tela seria
 * o servidor inventando uma seção que ninguém pediu.
 */
function nameTaken(name: string): ConflictError {
  return new ConflictError(`Já existe uma categoria chamada "${name}"`);
}

export async function create(
  restaurantId: string,
  input: CreateCategoryInput,
): Promise<Category> {
  await restaurantsService.ensureExists(restaurantId);

  const category = await categoriesRepository.insert(restaurantId, input);
  if (category === null) throw nameTaken(input.name);
  return category;
}

/** Categorias do restaurante. Sem categorias devolve página vazia. */
export async function listByRestaurant(
  restaurantId: string,
  pagination: Pagination,
): Promise<Page<Category>> {
  await restaurantsService.ensureExists(restaurantId);
  const { rows, total } = await categoriesRepository.findByRestaurant(
    restaurantId,
    pagination,
  );
  return { data: rows, ...pagination, total };
}

export async function getById(
  restaurantId: string,
  id: string,
): Promise<Category> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw categoryNotFound(id);

  const category = await categoriesRepository.findById(restaurantId, id);
  if (category === null) throw categoryNotFound(id);
  return category;
}

export async function update(
  restaurantId: string,
  id: string,
  input: UpdateCategoryInput,
): Promise<Category> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw categoryNotFound(id);

  const result = await categoriesRepository.update(restaurantId, id, input);
  if (result.outcome === "not-found") throw categoryNotFound(id);
  if (result.outcome === "name-taken") throw nameTaken(input.name as string);
  return result.category;
}

/**
 * Remove a seção e **solta os produtos dela**, na mesma transação (D3).
 *
 * Os produtos não são removidos junto: continuam no cardápio, agrupados no fim
 * em "Sem categoria". É a diferença entre apagar uma seção e apagar a comida —
 * e é o que permite corrigir um nome digitado errado sem recategorizar o
 * cardápio inteiro à mão.
 *
 * A cascata é explícita porque não há `on delete cascade` no projeto: nada é
 * apagado de verdade, então o gatilho do banco nunca dispararia. Lançar o
 * `NotFoundError` de dentro da transação também dispara rollback, o que é
 * correto — nada foi marcado.
 */
export async function remove(restaurantId: string, id: string): Promise<void> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw categoryNotFound(id);

  await withTransaction(async (client) => {
    const removed = await categoriesRepository.softDelete(
      restaurantId,
      id,
      client,
    );
    if (!removed) throw categoryNotFound(id);

    await productsRepository.clearCategory(restaurantId, id, client);
  });
}

/**
 * Garante que a categoria existe e é **deste** restaurante, sem devolver nada.
 *
 * É o que o serviço de produtos chama antes de gravar um `categoryId`: sem
 * isso, um id de categoria de outro restaurante entraria no produto e apareceria
 * no cardápio de quem não a criou (S23 — a checagem é no banco, não no cliente).
 */
export async function ensureExists(
  restaurantId: string,
  id: string,
): Promise<void> {
  if (!isUuid(id)) throw categoryNotFound(id);
  const category = await categoriesRepository.findById(restaurantId, id);
  if (category === null) throw categoryNotFound(id);
}
