import type {
  CreateTableInput,
  Table,
  TableWithQrUrl,
  UpdateTableInput,
} from "../domain/table.ts";
import { generateTableHash } from "../domain/table.ts";
import type { Page, Pagination } from "../domain/pagination.ts";
import { isUuid } from "../domain/uuid.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import { tableQrUrl } from "../menu-url.ts";
import * as tablesRepository from "../repositories/tables.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de mesas: **a regra de negócio**.
 *
 * Mesma regra das categorias — mesa só existe dentro de restaurante vivo,
 * então toda operação começa checando o pai. Não conhece Fastify nem SQL.
 */

function tableNotFound(id: string): NotFoundError {
  return new NotFoundError(`Mesa com id "${id}" não encontrada`);
}

/**
 * Rótulo repetido é **409**, nunca sufixo automático — mesma decisão das
 * categorias. "Mesa 7 (2)" aparecendo no painel seria o servidor inventando
 * uma mesa que ninguém tem no salão.
 */
function labelTaken(label: string): ConflictError {
  return new ConflictError(`Já existe uma mesa chamada "${label}"`);
}

/**
 * A mesa como a API a devolve: com a URL do QR montada.
 *
 * O `slug` vem junto porque a URL o carrega, e ele mora no restaurante — por
 * isso toda leitura de mesa resolve o pai antes. É uma consulta a mais, e ela
 * já aconteceria de qualquer jeito: `ensureExists` roda em toda operação.
 */
function withQrUrl(table: Table, slug: string): TableWithQrUrl {
  return { ...table, qrUrl: tableQrUrl(slug, table.hash) };
}

export async function create(
  restaurantId: string,
  input: CreateTableInput,
): Promise<TableWithQrUrl> {
  const restaurant = await restaurantsService.getById(restaurantId);

  const table = await tablesRepository.insert(
    restaurantId,
    input,
    generateTableHash(),
  );
  if (table === null) throw labelTaken(input.label);
  return withQrUrl(table, restaurant.slug);
}

/** Mesas do restaurante. Sem mesas devolve página vazia. */
export async function listByRestaurant(
  restaurantId: string,
  pagination: Pagination,
): Promise<Page<TableWithQrUrl>> {
  const restaurant = await restaurantsService.getById(restaurantId);
  const { rows, total } = await tablesRepository.findByRestaurant(
    restaurantId,
    pagination,
  );
  return {
    data: rows.map((table) => withQrUrl(table, restaurant.slug)),
    ...pagination,
    total,
  };
}

export async function getById(
  restaurantId: string,
  id: string,
): Promise<TableWithQrUrl> {
  const restaurant = await restaurantsService.getById(restaurantId);
  if (!isUuid(id)) throw tableNotFound(id);

  const table = await tablesRepository.findById(restaurantId, id);
  if (table === null) throw tableNotFound(id);
  return withQrUrl(table, restaurant.slug);
}

export async function update(
  restaurantId: string,
  id: string,
  input: UpdateTableInput,
): Promise<TableWithQrUrl> {
  const restaurant = await restaurantsService.getById(restaurantId);
  if (!isUuid(id)) throw tableNotFound(id);

  const result = await tablesRepository.update(restaurantId, id, input);
  if (result.outcome === "not-found") throw tableNotFound(id);
  if (result.outcome === "label-taken") {
    throw labelTaken(input.label as string);
  }
  return withQrUrl(result.table, restaurant.slug);
}

/**
 * Sorteia um hash novo para a mesa, invalidando o anterior.
 *
 * É o caminho de volta de um adesivo comprometido ou trocado — e a razão de o
 * hash poder ficar em claro no banco: o que o protege não é sigilo (ele está
 * colado na parede, à vista de todos), é entropia mais a possibilidade de
 * revogar.
 */
export async function rotateHash(
  restaurantId: string,
  id: string,
): Promise<TableWithQrUrl> {
  const restaurant = await restaurantsService.getById(restaurantId);
  if (!isUuid(id)) throw tableNotFound(id);

  const table = await tablesRepository.rotateHash(
    restaurantId,
    id,
    generateTableHash(),
  );
  if (table === null) throw tableNotFound(id);
  return withQrUrl(table, restaurant.slug);
}

export async function remove(restaurantId: string, id: string): Promise<void> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw tableNotFound(id);

  const removed = await tablesRepository.softDelete(restaurantId, id);
  if (!removed) throw tableNotFound(id);
}

/**
 * Resolve o hash de um QR code para a mesa, a partir do slug do restaurante —
 * o caminho público, usado pela tela que acabou de ser escaneada para poder
 * dizer "você está na Mesa 7".
 *
 * Hash de outra loja responde 404 como hash inexistente: do lado de fora as
 * duas coisas têm que ser indistinguíveis (S19).
 */
export async function resolveBySlugAndHash(
  slug: string,
  hash: string,
): Promise<Table> {
  const table = await tablesRepository.findByHashAndSlug(slug, hash);
  if (table === null) {
    throw new NotFoundError("Mesa não encontrada");
  }
  return table;
}
