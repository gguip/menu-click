import { withTransaction } from "../db/pool.ts";
import type {
  CreateOptionGroupInput,
  CreateOptionInput,
  Option,
  OptionGroup,
  UpdateOptionGroupInput,
  UpdateOptionInput,
} from "../domain/option.ts";
import type { Page, Pagination } from "../domain/pagination.ts";
import { isUuid } from "../domain/uuid.ts";
import { ConflictError, NotFoundError, ValidationError } from "../errors.ts";
import * as optionGroupsRepository from "../repositories/option-groups.ts";
import * as productsService from "./products.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de grupos de opções: **a regra de negócio**.
 *
 * Vale a mesma regra de categorias — grupo só existe dentro de restaurante
 * vivo, então toda operação começa checando o pai. Não conhece Fastify nem
 * escreve SQL.
 */

/** Erro padrão de grupo inexistente — mesma mensagem em toda a API. */
function optionGroupNotFound(id: string): NotFoundError {
  return new NotFoundError(`Grupo de opções com id "${id}" não encontrado`);
}

/** Erro padrão de opção inexistente — mesma mensagem em toda a API. */
function optionNotFound(id: string): NotFoundError {
  return new NotFoundError(`Opção com id "${id}" não encontrada`);
}

/**
 * Nome repetido é **409**, nunca sufixo automático. Mesma política de
 * categoria, e pelo mesmo motivo: o nome foi digitado por quem edita o
 * cardápio.
 */
function nameTaken(name: string): ConflictError {
  return new ConflictError(`Já existe um grupo de opções chamado "${name}"`);
}

/**
 * Recusa limites que descrevem um grupo impossível de satisfazer.
 *
 * Checa o valor **resultante**, não o enviado: baixar só o `maxOptions` num
 * PATCH pode deixá-lo abaixo do `minOptions` que já estava gravado, e a
 * requisição sozinha não mostra isso. O banco tem o mesmo check como rede de
 * segurança, mas ele responderia 500 — a mensagem útil é escrita aqui.
 */
function assertLimitesCoerentes(minOptions: number, maxOptions: number): void {
  if (maxOptions < 1) {
    throw new ValidationError("O grupo precisa aceitar ao menos uma opção");
  }
  if (minOptions > maxOptions) {
    throw new ValidationError(
      `O grupo exige ${minOptions} opções mas aceita no máximo ${maxOptions}`,
    );
  }
}

export async function create(
  restaurantId: string,
  input: CreateOptionGroupInput,
): Promise<OptionGroup> {
  await restaurantsService.ensureExists(restaurantId);
  assertLimitesCoerentes(input.minOptions ?? 0, input.maxOptions);

  const optionGroup = await optionGroupsRepository.insert(restaurantId, input);
  if (optionGroup === null) throw nameTaken(input.name);
  return optionGroup;
}

/** Grupos do restaurante. Sem grupos devolve página vazia. */
export async function listByRestaurant(
  restaurantId: string,
  pagination: Pagination,
): Promise<Page<OptionGroup>> {
  await restaurantsService.ensureExists(restaurantId);
  const { rows, total } = await optionGroupsRepository.findByRestaurant(
    restaurantId,
    pagination,
  );
  await attachOptions(rows);
  return { data: rows, ...pagination, total };
}

export async function getById(
  restaurantId: string,
  id: string,
): Promise<OptionGroup> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw optionGroupNotFound(id);

  const optionGroup = await optionGroupsRepository.findById(restaurantId, id);
  if (optionGroup === null) throw optionGroupNotFound(id);
  await attachOptions([optionGroup]);
  return optionGroup;
}

/**
 * Preenche `options` em cada grupo, em uma query só (é quem compõe — o
 * repositório devolve as duas coisas cruas, sem montar formato de resposta).
 * Muta os grupos recebidos.
 */
async function attachOptions(optionGroups: OptionGroup[]): Promise<void> {
  const porGrupo = await optionGroupsRepository.findOptionsByGroupIds(
    optionGroups.map((optionGroup) => optionGroup.id),
  );
  for (const optionGroup of optionGroups) {
    optionGroup.options = porGrupo.get(optionGroup.id) ?? [];
  }
}

export async function update(
  restaurantId: string,
  id: string,
  input: UpdateOptionGroupInput,
): Promise<OptionGroup> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw optionGroupNotFound(id);

  // O valor RESULTANTE, não o enviado: um PATCH que só manda `maxOptions`
  // precisa ser checado contra o `minOptions` que já estava gravado.
  const atual = await optionGroupsRepository.findById(restaurantId, id);
  if (atual === null) throw optionGroupNotFound(id);
  assertLimitesCoerentes(
    input.minOptions ?? atual.minOptions,
    input.maxOptions ?? atual.maxOptions,
  );

  const result = await optionGroupsRepository.update(restaurantId, id, input);
  if (result.outcome === "not-found") throw optionGroupNotFound(id);
  if (result.outcome === "name-taken") throw nameTaken(input.name as string);
  return result.optionGroup;
}

/**
 * Remove o grupo, **as opções dele** e os vínculos com produtos, na mesma
 * transação (D3).
 */
export async function remove(restaurantId: string, id: string): Promise<void> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(id)) throw optionGroupNotFound(id);

  await withTransaction(async (client) => {
    const removed = await optionGroupsRepository.softDelete(
      restaurantId,
      id,
      client,
    );
    if (!removed) throw optionGroupNotFound(id);

    await optionGroupsRepository.softDeleteOptionsByGroups([id], client);
    await optionGroupsRepository.softDeleteLinksByGroups([id], client);
  });
}

/**
 * Cria uma opção dentro do grupo.
 *
 * `getById` já garante o escopo (404 para grupo alheio ou inexistente) — não
 * há segunda checagem aqui.
 */
export async function createOption(
  restaurantId: string,
  groupId: string,
  input: CreateOptionInput,
): Promise<Option> {
  await getById(restaurantId, groupId);
  return optionGroupsRepository.insertOption(groupId, input);
}

export async function updateOption(
  restaurantId: string,
  groupId: string,
  id: string,
  input: UpdateOptionInput,
): Promise<Option> {
  await getById(restaurantId, groupId);
  if (!isUuid(id)) throw optionNotFound(id);

  const option = await optionGroupsRepository.updateOption(groupId, id, input);
  if (option === null) throw optionNotFound(id);
  return option;
}

export async function removeOption(
  restaurantId: string,
  groupId: string,
  id: string,
): Promise<void> {
  await getById(restaurantId, groupId);
  if (!isUuid(id)) throw optionNotFound(id);

  const removed = await optionGroupsRepository.softDeleteOption(groupId, id);
  if (!removed) throw optionNotFound(id);
}

/**
 * Define a lista ordenada de grupos de um produto.
 *
 * Id repetido é 400, não deduplicação silenciosa: a tela que produz esta
 * chamada não consegue gerar repetição, então repetição é erro do cliente — e
 * aceitar em silêncio esconderia o erro em vez de mostrá-lo.
 */
export async function replaceProductGroups(
  restaurantId: string,
  productId: string,
  optionGroupIds: string[],
): Promise<OptionGroup[]> {
  await productsService.getById(restaurantId, productId); // 404 se não for dele

  if (new Set(optionGroupIds).size !== optionGroupIds.length) {
    throw new ValidationError("A lista de grupos tem ids repetidos");
  }

  // cada grupo é conferido contra o restaurante da rota; grupo alheio é 404
  for (const id of optionGroupIds) {
    await getById(restaurantId, id);
  }

  await withTransaction(async (client) => {
    await optionGroupsRepository.replaceProductLinks(
      productId,
      optionGroupIds,
      client,
    );
  });

  const porProduto = await optionGroupsRepository.findGroupsByProductIds(
    restaurantId,
    [productId],
  );
  return porProduto.get(productId) ?? [];
}
