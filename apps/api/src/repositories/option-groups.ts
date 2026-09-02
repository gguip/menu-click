import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type {
  CreateOptionGroupInput,
  Option,
  OptionGroup,
  PriceRule,
  UpdateOptionGroupInput,
} from "../domain/option.ts";
import type { Pagination } from "../domain/pagination.ts";

/**
 * Repositório de grupos de opções: **só acesso a dados**.
 *
 * Todo o SQL da tabela `option_groups` está aqui, e soft delete em toda
 * consulta (`deleted_at is null`) — ver `.claude/rules/database.md`. Espelha
 * `repositories/categories.ts`; as diferenças estão nos comentários locais.
 */

/** Linha da tabela `option_groups`, em snake_case como vem do Postgres. */
export type OptionGroupRow = {
  id: string;
  restaurant_id: string;
  name: string;
  min_options: number;
  max_options: number;
  price_rule: PriceRule;
  created_at: Date;
  updated_at: Date;
};

/** Linha da tabela `options` (usada pela Task 5, que preenche `options`). */
export type OptionRow = {
  id: string;
  option_group_id: string;
  name: string;
  price_in_cents: number;
  max_quantity: number;
  available: boolean;
  position: number;
  created_at: Date;
  updated_at: Date;
};

/**
 * Converte a linha do banco no formato camelCase usado fora daqui (D12).
 *
 * `options` sai sempre `[]` — a lista é preenchida por quem lê (Task 4), o
 * mapper não a inventa.
 */
export function toOptionGroup(row: OptionGroupRow): OptionGroup {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    minOptions: row.min_options,
    maxOptions: row.max_options,
    priceRule: row.price_rule,
    options: [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Converte a linha do banco no formato camelCase usado fora daqui (D12). */
export function toOption(row: OptionRow): Option {
  return {
    id: row.id,
    optionGroupId: row.option_group_id,
    name: row.name,
    priceInCents: row.price_in_cents,
    maxQuantity: row.max_quantity,
    available: row.available,
    position: row.position,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Campos editáveis via PATCH → coluna correspondente na tabela. */
const optionGroupColumns = {
  name: "name",
  minOptions: "min_options",
  maxOptions: "max_options",
  priceRule: "price_rule",
} as const;

/** Violação de unicidade no Postgres — aqui, o nome repetido no restaurante. */
const UNIQUE_VIOLATION = "23505";

/**
 * A ordem do grupo é por nome: ele não tem `position` própria, porque a
 * ordem de exibição é por PRODUTO e mora na junção (`product_option_groups`).
 */
const ORDER_BY = "order by name, id";

/**
 * Insere um grupo — ou devolve `null` se o nome já está em uso naquele
 * restaurante (o índice é `lower(name)`, então "Sabores" colide com "sabores").
 *
 * O conflito é detectado pelo índice único, nunca por um `select` antes: entre
 * checar e inserir cabe outra requisição com o mesmo nome.
 */
export async function insert(
  restaurantId: string,
  input: CreateOptionGroupInput,
  db: Queryable = pool,
): Promise<OptionGroup | null> {
  try {
    const { rows } = await db.query<OptionGroupRow>(
      `insert into option_groups (restaurant_id, name, min_options, max_options, price_rule)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [
        restaurantId,
        input.name,
        input.minOptions ?? 0,
        input.maxOptions,
        input.priceRule,
      ],
    );
    return toOptionGroup(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
    throw error;
  }
}

/**
 * Uma página de grupos vivos do restaurante, mais o total de vivos daquele
 * restaurante. Duas queries pelo mesmo motivo dos outros repositórios: um
 * `count(*) over ()` não devolve linha nenhuma quando a página está vazia, e aí
 * um `offset` além do fim reportaria `total: 0`.
 */
export async function findByRestaurant(
  restaurantId: string,
  { limit, offset }: Pagination,
  db: Queryable = pool,
): Promise<{ rows: OptionGroup[]; total: number }> {
  const { rows } = await db.query<OptionGroupRow>(
    `select * from option_groups
      where restaurant_id = $1 and deleted_at is null
      ${ORDER_BY}
      limit $2 offset $3`,
    [restaurantId, limit, offset],
  );

  const { rows: countRows } = await db.query<{ total: string }>(
    `select count(*) as total from option_groups
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );

  return { rows: rows.map(toOptionGroup), total: Number(countRows[0].total) };
}

/**
 * Grupo vivo, **escopado pelo restaurante** — a autorização vai na própria
 * query (`and restaurant_id = $2`), não numa checagem separada depois (S23).
 */
export async function findById(
  restaurantId: string,
  id: string,
  db: Queryable = pool,
): Promise<OptionGroup | null> {
  const { rows } = await db.query<OptionGroupRow>(
    `select * from option_groups
      where id = $1 and restaurant_id = $2 and deleted_at is null`,
    [id, restaurantId],
  );
  return rows.length === 0 ? null : toOptionGroup(rows[0]);
}

/**
 * O que aconteceu numa tentativa de edição.
 *
 * Aqui o `null` de "não achei" não bastaria: renomear pode esbarrar no nome de
 * outro grupo, e os dois casos viram status diferentes (404 e 409). O
 * repositório continua sem decidir nada — ele relata o que o banco respondeu, e
 * quem escolhe o status code é o serviço.
 */
export type UpdateOutcome =
  | { outcome: "updated"; optionGroup: OptionGroup }
  | { outcome: "not-found" }
  | { outcome: "name-taken" };

/** Aplica os campos enviados. */
export async function update(
  restaurantId: string,
  id: string,
  input: UpdateOptionGroupInput,
  db: Queryable = pool,
): Promise<UpdateOutcome> {
  // SET dinâmico percorrendo o mapa fixo de colunas, nunca as chaves do input
  // (S8/D8): assim `id` ou `createdAt` no corpo não têm por onde entrar.
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [field, column] of Object.entries(optionGroupColumns)) {
    const value = input[field as keyof typeof optionGroupColumns];
    if (value === undefined) continue;
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }

  assignments.push("updated_at = now()");
  values.push(id, restaurantId);

  try {
    const { rows } = await db.query<OptionGroupRow>(
      `update option_groups
          set ${assignments.join(", ")}
        where id = $${values.length - 1}
          and restaurant_id = $${values.length}
          and deleted_at is null
        returning *`,
      values,
    );
    return rows.length === 0
      ? { outcome: "not-found" }
      : { outcome: "updated", optionGroup: toOptionGroup(rows[0]) };
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      return { outcome: "name-taken" };
    }
    throw error;
  }
}

/** Soft delete de um grupo. `false` = não existe ou já foi removido (D1). */
export async function softDelete(
  restaurantId: string,
  id: string,
  db: Queryable = pool,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update option_groups set deleted_at = now()
      where id = $1 and restaurant_id = $2 and deleted_at is null`,
    [id, restaurantId],
  );
  return rowCount === 1;
}

/**
 * Soft delete de todos os grupos de um restaurante (a cascata do D3).
 * Recebe o `client` porque só faz sentido junto com a remoção do restaurante,
 * na mesma transação.
 */
export async function softDeleteByRestaurant(
  restaurantId: string,
  db: Queryable,
): Promise<void> {
  await db.query(
    `update option_groups set deleted_at = now()
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );
}

