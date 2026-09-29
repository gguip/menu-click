import type { PoolClient } from "pg";
import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { OpeningHour, OpeningHourInput, OpeningStatus } from "../domain/opening-hours.ts";

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

/**
 * O restaurante está dentro de alguma faixa **agora**, no fuso dele?
 *
 * A conta roda no Postgres, e não no Node, pelo mesmo motivo do filtro de
 * período do painel: ela depende do banco de fusos, que o `at time zone` já
 * consulta. Refazê-la em JavaScript seria uma segunda implementação da mesma
 * regra, discordando da primeira nos dias de virada de horário de verão.
 *
 * ⚠️ Isto responde só pela GRADE. A pausa manual é outra condição, e quem
 * junta as duas é o serviço — misturá-las aqui esconderia da tela a diferença
 * entre "fechado agora" e "a loja pausou os pedidos".
 */
export async function isOpenNow(
  restaurantId: string,
  timezone: string,
  db: Queryable = pool,
): Promise<boolean> {
  const { rows } = await db.query<{ aberto: boolean }>(
    `select exists (
       select 1
         from opening_hours h,
              lateral (select now() at time zone $2 as local) agora
        where h.restaurant_id = $1
          and h.deleted_at is null
          and (
            -- faixa normal, dentro do mesmo dia
            (h.closes_at > h.opens_at
              and extract(dow from agora.local) = h.weekday
              and agora.local::time >= h.opens_at
              and agora.local::time <  h.closes_at)
            or
            -- faixa que atravessa a meia-noite: vale no fim do próprio dia e
            -- na madrugada do dia seguinte
            (h.closes_at < h.opens_at
              and (
                (extract(dow from agora.local) = h.weekday
                  and agora.local::time >= h.opens_at)
                or
                (extract(dow from agora.local) = (h.weekday + 1) % 7
                  and agora.local::time < h.closes_at)
              ))
          )
     ) as aberto`,
    [restaurantId, timezone],
  );
  return rows[0].aberto;
}

/** Quantos dias à frente a conta olha. Trecho aberto até aqui = "aberta direto". */
const WINDOW_DAYS = 7;

/**
 * O status de funcionamento no instante `at` (padrão: agora), no fuso da loja.
 *
 * Mesma decisão de `isOpenNow`: a conta é do Postgres, que conhece o banco de
 * fusos. Cada faixa vira um intervalo de instantes concretos, de ontem até
 * `WINDOW_DAYS` dias à frente (a faixa que atravessa a meia-noite termina no
 * dia seguinte); intervalos encostados ou sobrepostos se FUNDEM — sem isso, a
 * grade 24x7 do backfill (`00:00–23:59` + `23:59–00:00`) diria "fecha 23:59"
 * numa loja que nunca fecha.
 */
export async function findOpeningStatus(
  restaurantId: string,
  timezone: string,
  at: Date | null = null,
  db: Queryable = pool,
): Promise<OpeningStatus> {
  const { rows } = await db.query<{
    is_open: boolean;
    closes_at: Date | null;
    opens_at: Date | null;
    open_through_window: boolean;
  }>(
    `with ref as (
       select coalesce($3::timestamptz, now()) as at, $2::text as tz
     ),
     days as (
       select ((ref.at at time zone ref.tz)::date + d) as day
         from ref, generate_series(-1, $4::int) as d
     ),
     spans as (
       select ((days.day + h.opens_at) at time zone ref.tz) as starts_at,
              ((days.day + h.closes_at
                + case when h.closes_at < h.opens_at then interval '1 day' else interval '0' end)
                at time zone ref.tz) as ends_at
         from days
         join opening_hours h
           on h.restaurant_id = $1
          and h.deleted_at is null
          and h.weekday = extract(dow from days.day)
         cross join ref
     ),
     marked as (
       select starts_at, ends_at,
              max(ends_at) over (order by starts_at, ends_at
                                 rows between unbounded preceding and 1 preceding) as prev_end
         from spans
     ),
     islands as (
       select starts_at, ends_at,
              sum(case when prev_end is null or starts_at > prev_end then 1 else 0 end)
                over (order by starts_at, ends_at) as island
         from marked
     ),
     merged as (
       select min(starts_at) as starts_at, max(ends_at) as ends_at from islands group by island
     ),
     current_span as (
       select merged.* from merged, ref where merged.starts_at <= ref.at and ref.at < merged.ends_at
     )
     select exists (select 1 from current_span) as is_open,
            (select ends_at from current_span) as closes_at,
            (select min(merged.starts_at) from merged, ref where merged.starts_at > ref.at) as opens_at,
            coalesce((select ends_at >= ref.at + make_interval(days => $4::int)
                        from current_span, ref), false) as open_through_window`,
    [restaurantId, timezone, at, WINDOW_DAYS],
  );
  const row = rows[0];
  if (row.is_open) {
    return row.open_through_window || row.closes_at === null
      ? { isOpen: true }
      : { isOpen: true, closesAt: row.closes_at.toISOString() };
  }
  return row.opens_at === null ? { isOpen: false } : { isOpen: false, opensAt: row.opens_at.toISOString() };
}
