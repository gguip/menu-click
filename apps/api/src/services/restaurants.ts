import { randomBytes } from "node:crypto";
import { withTransaction } from "../db/pool.ts";
import type {
  CreateRestaurantInput,
  Restaurant,
  UpdateRestaurantInput,
} from "../domain/restaurant.ts";
import type { Page, Pagination } from "../domain/pagination.ts";
import { SLUG_MAX_LENGTH, slugify } from "../domain/slug.ts";
import { isUuid } from "../domain/uuid.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
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

/** Tamanho do sufixo aleatório (`-a1b2c3`) usado para desempatar slug. */
const SLUG_SUFFIX_BYTES = 3;
const SLUG_SUFFIX_LENGTH = SLUG_SUFFIX_BYTES * 2 + 1;

/** Quantas vezes tentar antes de desistir. Colidir 5 vezes seguidas em 2^24 */
/* combinações significa que algo está errado, não que deu azar. */
const MAX_SLUG_ATTEMPTS = 5;

/**
 * Cria o restaurante, resolvendo o slug público.
 *
 * Duas políticas diferentes, de propósito:
 *
 * - **Slug explícito que colide é 409.** O cliente pediu aquele endereço exato
 *   (é o que vai no QR code impresso); entregar outro em silêncio seria pior
 *   que falhar.
 * - **Slug derivado do nome que colide ganha sufixo e tenta de novo.** Duas
 *   "Cantina da Nona" é situação normal, e travar o cadastro por isso seria
 *   hostil com quem nem sabe que slug existe.
 *
 * A colisão é detectada pelo índice único (o repositório devolve `null`), não
 * por um `select` antes: entre checar e inserir cabe outra requisição.
 */
export async function create(
  input: CreateRestaurantInput,
): Promise<Restaurant> {
  if (input.slug !== undefined) {
    const created = await restaurantsRepository.insert({
      ...input,
      slug: input.slug,
    });
    if (created === null) {
      throw new ConflictError(`O slug "${input.slug}" já está em uso`);
    }
    return created;
  }

  // `slugify` pode devolver vazio (nome só de emoji, por exemplo); nesse caso
  // o slug é só o sufixo aleatório.
  const base = slugify(input.name).slice(0, SLUG_MAX_LENGTH - SLUG_SUFFIX_LENGTH);

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const suffix = randomBytes(SLUG_SUFFIX_BYTES).toString("hex");
    const slug =
      attempt === 0 && base !== "" ? base : [base, suffix].filter(Boolean).join("-");

    const created = await restaurantsRepository.insert({ ...input, slug });
    if (created !== null) return created;
  }

  throw new ConflictError(
    "Não foi possível gerar um slug único para esse nome; envie um `slug` explícito",
  );
}

/** Restaurante pelo slug público (a busca do cardápio do QR code). */
export async function getBySlug(slug: string): Promise<Restaurant> {
  const restaurant = await restaurantsRepository.findBySlug(slug);
  if (restaurant === null) {
    throw new NotFoundError(`Restaurante "${slug}" não encontrado`);
  }
  return restaurant;
}

/** Lista todos os vivos. Lista vazia é resultado válido, não erro. */
export async function list(
  pagination: Pagination,
): Promise<Page<Restaurant>> {
  const { rows, total } = await restaurantsRepository.findAll(pagination);
  return { data: rows, ...pagination, total };
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
