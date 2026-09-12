import type { PoolClient } from "pg";
import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { DeliveryNeighborhood } from "../domain/delivery.ts";

/**
 * Repositório de bairros atendidos: **só acesso a dados**.
 *
 * Todo o SQL da tabela `delivery_neighborhoods` está aqui, e soft delete em
 * toda consulta (`deleted_at is null`) — ver `.claude/rules/database.md`.
 */

/** Linha da tabela `delivery_neighborhoods`, em snake_case como vem do Postgres. */
type DeliveryNeighborhoodRow = {
  id: string;
  restaurant_id: string;
  name: string;
  normalized_name: string;
  fee_in_cents: number;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase usado fora daqui (D12). */
function toDeliveryNeighborhood(row: DeliveryNeighborhoodRow): DeliveryNeighborhood {
  return {
    name: row.name,
    feeInCents: row.fee_in_cents,
  };
}

/**
 * O que o serviço já resolveu antes de escrever: nome como digitado, a chave
 * de comparação (`normalizeNeighborhood`, calculada no serviço porque é regra
 * de domínio) e o preço.
 */
export type DeliveryNeighborhoodRecord = {
  name: string;
  normalizedName: string;
  feeInCents: number;
};

/** Ordenação: alfabética. Quem lê a lista de bairros quer achar pelo nome. */
const ORDER_BY = "order by name";

/**
 * Troca a lista inteira pela informada.
 *
 * Apaga tudo e reinsere, em vez de calcular diferença — o mesmo desenho da
 * grade de horário: é tabela de configuração, a rotatividade de linha não
 * custa nada, e código que calcula diferença é onde mora o bug que ninguém vê.
 *
 * Recebe o `client` porque as duas metades valem juntas ou não valem.
 */
export async function replaceForRestaurant(
  restaurantId: string,
  neighborhoods: DeliveryNeighborhoodRecord[],
  client: PoolClient,
): Promise<void> {
  await client.query(
    `update delivery_neighborhoods set deleted_at = now()
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );

  if (neighborhoods.length === 0) return;

  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const neighborhood of neighborhoods) {
    values.push(
      restaurantId,
      neighborhood.name,
      neighborhood.normalizedName,
      neighborhood.feeInCents,
    );
    // os `$n` saem do TAMANHO do array, nunca de algo vindo do cliente (S2)
    const n = values.length;
    tuples.push(`($${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
  }

  await client.query(
    `insert into delivery_neighborhoods (restaurant_id, name, normalized_name, fee_in_cents)
     values ${tuples.join(", ")}`,
    values,
  );
}

/** A lista viva do restaurante, em ordem alfabética. */
export async function findByRestaurant(
  restaurantId: string,
  db: Queryable = pool,
): Promise<DeliveryNeighborhood[]> {
  const { rows } = await db.query<DeliveryNeighborhoodRow>(
    `select * from delivery_neighborhoods
      where restaurant_id = $1 and deleted_at is null
      ${ORDER_BY}`,
    [restaurantId],
  );
  return rows.map(toDeliveryNeighborhood);
}

/**
 * Soft delete de toda a lista de um restaurante (a cascata do D3).
 * Recebe o `client` porque só faz sentido junto com a remoção do restaurante,
 * na mesma transação.
 */
export async function softDeleteByRestaurant(
  restaurantId: string,
  db: Queryable,
): Promise<void> {
  await db.query(
    `update delivery_neighborhoods set deleted_at = now()
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );
}
