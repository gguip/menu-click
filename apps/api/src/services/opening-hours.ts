import { withTransaction } from "../db/pool.ts";
import type { OpeningHour, OpeningHourInput } from "../domain/opening-hours.ts";
import { ValidationError } from "../errors.ts";
import * as openingHoursRepository from "../repositories/opening-hours.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de horário de funcionamento: **a regra de negócio**.
 *
 * Como o de categorias, começa checando o restaurante: grade só existe dentro
 * de restaurante vivo. Não conhece Fastify nem escreve SQL.
 */

/**
 * Recusa faixa de duração zero.
 *
 * `closesAt < opensAt` é legítimo — significa que fecha no dia seguinte. Só a
 * igualdade não descreve nada. O `check` do banco é a rede de segurança; a
 * mensagem útil é escrita aqui.
 */
function assertFaixasValidas(faixas: OpeningHourInput[]): void {
  for (const faixa of faixas) {
    if (faixa.opensAt === faixa.closesAt) {
      throw new ValidationError(
        `A faixa de ${faixa.opensAt} não tem duração: abre e fecha na mesma hora`,
      );
    }
  }
}

/**
 * Troca a grade inteira do restaurante e devolve a grade relida.
 *
 * Lista vazia é válida e fecha a semana inteira — é o próprio desenho da
 * ausência de faixa significar "fechado".
 */
export async function replaceForRestaurant(
  restaurantId: string,
  faixas: OpeningHourInput[],
): Promise<OpeningHour[]> {
  await restaurantsService.ensureExists(restaurantId);
  assertFaixasValidas(faixas);

  await withTransaction(async (client) => {
    await openingHoursRepository.replaceForRestaurant(
      restaurantId,
      faixas,
      client,
    );
  });

  return openingHoursRepository.findByRestaurant(restaurantId);
}

/** A grade do restaurante. Sem faixas devolve lista vazia. */
export async function listByRestaurant(
  restaurantId: string,
): Promise<OpeningHour[]> {
  await restaurantsService.ensureExists(restaurantId);
  return openingHoursRepository.findByRestaurant(restaurantId);
}
