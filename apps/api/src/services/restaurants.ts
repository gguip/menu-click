import { randomBytes } from "node:crypto";
import { isTransactionClient, pool, withTransaction } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type {
  CreateRestaurantInput,
  Restaurant,
  UpdateRestaurantInput,
} from "../domain/restaurant.ts";
import type { Page, Pagination } from "../domain/pagination.ts";
import { SLUG_MAX_LENGTH, slugify } from "../domain/slug.ts";
import { isUuid } from "../domain/uuid.ts";
import { isValidTimezone } from "../domain/timezone.ts";
import { ConflictError, NotFoundError, ValidationError } from "../errors.ts";
import * as categoriesRepository from "../repositories/categories.ts";
import * as optionGroupsRepository from "../repositories/option-groups.ts";
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
 *
 * Aceita um `Queryable` opcional pelo mesmo motivo que os repositórios: o
 * cadastro (`POST /auth/register`) cria restaurante e primeiro usuário na
 * mesma transação, e as duas escritas precisam sair pela mesma conexão.
 */
/**
 * Uma tentativa de inserir com um slug, protegida contra o efeito colateral de
 * falhar dentro de uma transação.
 *
 * Sem o savepoint, a primeira colisão aborta a transação do cadastro inteiro e
 * a tentativa seguinte estoura `current transaction is aborted` — um 500 no
 * lugar do retry. Fora de transação (pool) não há o que proteger.
 */
async function tryInsert(
  input: CreateRestaurantInput,
  slug: string,
  db: Queryable,
): Promise<Restaurant | null> {
  if (!isTransactionClient(db)) {
    return restaurantsRepository.insert({ ...input, slug }, db);
  }

  // nome fixo, escrito no código: identificador não aceita $n (S3)
  await db.query("savepoint slug_attempt");
  const created = await restaurantsRepository.insert({ ...input, slug }, db);
  await db.query(
    created === null
      ? "rollback to savepoint slug_attempt"
      : "release savepoint slug_attempt",
  );
  return created;
}

/**
 * Recusa um fuso que o sistema não conhece, com **400**.
 *
 * O JSON Schema não tem como expressar isto — a lista de fusos é do sistema
 * operacional, não do contrato —, então a checagem mora aqui, como a do limite
 * de bytes da senha. Sem ela, um `Marte/Olympus` entraria na coluna e só
 * apareceria depois, como erro do Postgres na primeira consulta do painel.
 */
function assertTimezoneValida(timezone: string | undefined): void {
  if (timezone === undefined) return;
  if (!isValidTimezone(timezone)) {
    throw new ValidationError(
      `Fuso horário "${timezone}" não existe. Use um nome IANA, como "America/Sao_Paulo"`,
    );
  }
}

export async function create(
  input: CreateRestaurantInput,
  db: Queryable = pool,
): Promise<Restaurant> {
  assertTimezoneValida(input.timezone);

  if (input.slug !== undefined) {
    const created = await tryInsert(input, input.slug, db);
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

    const created = await tryInsert(input, slug, db);
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

/**
 * Os restaurantes que a sessão administra. Hoje é sempre um (um usuário
 * pertence a um restaurante), mas o contrato é de lista: o dia em que existir
 * usuário de rede, muda o serviço e não a resposta.
 *
 * Restaurante removido some da lista, como em toda leitura (D2).
 */
export async function listForSession(
  restaurantId: string,
  pagination: Pagination,
): Promise<Page<Restaurant>> {
  const { rows, total } = await restaurantsRepository.findAllByIds(
    [restaurantId],
    pagination,
  );
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
  assertTimezoneValida(input.timezone);

  const restaurant = await restaurantsRepository.update(id, input);
  if (restaurant === null) throw restaurantNotFound(id);
  return restaurant;
}

/**
 * Remove o restaurante **e o cardápio dele** — produtos, categorias, grupos de
 * opções, opções e os vínculos entre produto e grupo (soft delete em
 * cascata, D3).
 *
 * Os updates valem juntos ou não valem: se um falhar, o rollback
 * traz o restaurante de volta. Lançar o `NotFoundError` de dentro da transação
 * também dispara rollback — o que é correto, já que nada foi marcado.
 */
export async function remove(id: string): Promise<void> {
  if (!isUuid(id)) throw restaurantNotFound(id);

  await withTransaction(async (client) => {
    const removed = await restaurantsRepository.softDelete(id, client);
    if (!removed) throw restaurantNotFound(id);

    await productsRepository.softDeleteByRestaurant(id, client);
    await categoriesRepository.softDeleteByRestaurant(id, client);

    // vínculos e opções são marcados antes dos grupos — a mesma ordem em que
    // a cascata é descrita: cada um é alcançado pela subconsulta que sobe até
    // o pai (produto ou grupo), nunca por um `restaurant_id` próprio deles.
    await optionGroupsRepository.softDeleteLinksByRestaurant(id, client);
    await optionGroupsRepository.softDeleteOptionsByRestaurant(id, client);
    await optionGroupsRepository.softDeleteByRestaurant(id, client);
  });
}
