import type { PoolClient } from "pg";
import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { OpeningHour, OpeningHourInput } from "../domain/opening-hours.ts";

/**
 * Repositório de horário de funcionamento: **só acesso a dados**.
 *
 * Todo o SQL da tabela `opening_hours` está aqui, e soft delete em toda
 * consulta (`deleted_at is null`) — ver `.claude/rules/database.md`.
 */

/** Linha da tabela `opening_hours`, em snake_case como vem do Postgres. */
type OpeningHourRow = {
  id: string;
  restaurant_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
  created_at: Date;
  updated_at: Date;
};

/**
 * Converte a linha do banco no formato camelCase usado fora daqui (D12).
 *
 * O driver traz `time` como string `"18:00:00"`, e o contrato da API é
 * `HH:MM` — a conversão acontece aqui, num lugar só.
 */
function toOpeningHour(row: OpeningHourRow): OpeningHour {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    weekday: row.weekday as OpeningHour["weekday"],
    opensAt: row.opens_at.slice(0, 5),
    closesAt: row.closes_at.slice(0, 5),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Ordenação determinística (D11): dia, depois início da faixa, depois id. */
const ORDER_BY = "order by weekday, opens_at, id";

/**
 * Troca a grade inteira pela informada.
 *
 * Apaga tudo e reinsere, em vez de calcular diferença — é o mesmo desenho do
 * `replaceProductLinks` do vínculo produto↔grupo, e pelo mesmo motivo: é
 * tabela de configuração, a rotatividade de linha não custa nada, e código que
 * calcula diferença é onde mora o bug que ninguém vê.
 *
 * Recebe o `client` porque as duas metades valem juntas ou não valem.
 */
export async function replaceForRestaurant(
  restaurantId: string,
  faixas: OpeningHourInput[],
  client: PoolClient,
): Promise<void> {
  await client.query(
    `update opening_hours set deleted_at = now()
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );

  if (faixas.length === 0) return;

  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const faixa of faixas) {
    values.push(restaurantId, faixa.weekday, faixa.opensAt, faixa.closesAt);
    // os `$n` saem do TAMANHO do array, nunca de algo vindo do cliente (S2)
    const n = values.length;
    tuples.push(`($${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
  }

  await client.query(
    `insert into opening_hours (restaurant_id, weekday, opens_at, closes_at)
     values ${tuples.join(", ")}`,
    values,
  );
}

/** A grade viva do restaurante, na ordem de exibição. */
export async function findByRestaurant(
  restaurantId: string,
  db: Queryable = pool,
): Promise<OpeningHour[]> {
  const { rows } = await db.query<OpeningHourRow>(
    `select * from opening_hours
      where restaurant_id = $1 and deleted_at is null
      ${ORDER_BY}`,
    [restaurantId],
  );
  return rows.map(toOpeningHour);
}

/**
 * Soft delete de toda a grade de um restaurante (a cascata do D3).
 * Recebe o `client` porque só faz sentido junto com a remoção do restaurante,
 * na mesma transação.
 */
export async function softDeleteByRestaurant(
  restaurantId: string,
  db: Queryable,
): Promise<void> {
  await db.query(
    `update opening_hours set deleted_at = now()
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );
}
