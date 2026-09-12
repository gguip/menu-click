import { withTransaction } from "../db/pool.ts";
import type {
  DeliveryNeighborhood,
  DeliveryNeighborhoodInput,
} from "../domain/delivery.ts";
import { normalizeNeighborhood } from "../domain/delivery.ts";
import { ConflictError } from "../errors.ts";
import * as deliveryNeighborhoodsRepository from "../repositories/delivery-neighborhoods.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de bairros atendidos: **a regra de negócio**.
 *
 * Como o de horário de funcionamento, começa checando o restaurante: a lista
 * só existe dentro de restaurante vivo. Não conhece Fastify nem escreve SQL.
 */

/**
 * Nome repetido é **409**, nunca sufixo automático.
 *
 * Mesmo raciocínio do nome de categoria: o nome foi digitado por quem edita o
 * cardápio, e inventar um "Centro (2)" seria o servidor criando um bairro que
 * ninguém pediu.
 */
function duplicateNeighborhood(name: string): ConflictError {
  return new ConflictError(`O bairro "${name}" está duplicado na lista enviada`);
}

/**
 * Recusa lista com dois bairros que colidem na chave de comparação.
 *
 * A checagem acontece **antes** do insert, comparando os normalizados do
 * próprio payload: o índice único parcial do banco é a rede de segurança, não
 * a primeira barreira — deixar o 23505 subir daria 500 em vez de 409.
 */
function assertSemDuplicatas(neighborhoods: DeliveryNeighborhoodInput[]): void {
  const vistos = new Set<string>();
  for (const neighborhood of neighborhoods) {
    const chave = normalizeNeighborhood(neighborhood.name);
    if (vistos.has(chave)) throw duplicateNeighborhood(neighborhood.name);
    vistos.add(chave);
  }
}

/**
 * Troca a lista inteira do restaurante e devolve a lista relida.
 *
 * Lista vazia é válida e limpa a configuração — mesmo desenho da grade de
 * horário, onde ausência de faixa significa fechado.
 */
export async function replaceForRestaurant(
  restaurantId: string,
  neighborhoods: DeliveryNeighborhoodInput[],
): Promise<DeliveryNeighborhood[]> {
  await restaurantsService.ensureExists(restaurantId);
  assertSemDuplicatas(neighborhoods);

  // o `normalized_name` é regra de domínio (o que conta como "mesmo bairro"),
  // então é calculado aqui, não no repositório
  const records = neighborhoods.map((neighborhood) => ({
    name: neighborhood.name,
    normalizedName: normalizeNeighborhood(neighborhood.name),
    feeInCents: neighborhood.feeInCents,
  }));

  await withTransaction(async (client) => {
    await deliveryNeighborhoodsRepository.replaceForRestaurant(
      restaurantId,
      records,
      client,
    );
  });

  return deliveryNeighborhoodsRepository.findByRestaurant(restaurantId);
}

/** A lista de bairros do restaurante. Sem bairros devolve lista vazia. */
export async function listByRestaurant(
  restaurantId: string,
): Promise<DeliveryNeighborhood[]> {
  await restaurantsService.ensureExists(restaurantId);
  return deliveryNeighborhoodsRepository.findByRestaurant(restaurantId);
}
