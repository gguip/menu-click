import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "../domain/category.ts";
import type { Pagination } from "../domain/pagination.ts";

/**
 * Repositório de categorias: **só acesso a dados**.
 *
 * Todo o SQL da tabela `categories` está aqui, e soft delete em toda consulta
 * (`deleted_at is null`) — ver `.claude/rules/database.md`.
 */

/** Linha da tabela `categories`, em snake_case como vem do Postgres. */
type CategoryRow = {
  id: string;
  restaurant_id: string;
  name: string;
  position: number;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase usado fora daqui (D12). */
function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    position: row.position,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Campos editáveis via PATCH → coluna correspondente na tabela. */
const categoryColumns = {
  name: "name",
  position: "position",
} as const;

/** Violação de unicidade no Postgres — aqui, o nome repetido no restaurante. */
const UNIQUE_VIOLATION = "23505";

/**
 * A ordem do cardápio: a posição que o restaurante escolheu, e o nome como
 * desempate — sem ele, duas categorias na mesma posição trocariam de lugar
 * entre uma requisição e outra. O `id` fecha o determinismo (D11).
 */
const ORDER_BY = "order by position, name, id";

/**
 * Insere uma categoria — ou devolve `null` se o nome já está em uso naquele
 * restaurante (o índice é `lower(name)`, então "Bebidas" colide com "bebidas").
 *
 * O conflito é detectado pelo índice único, nunca por um `select` antes: entre
 * checar e inserir cabe outra requisição com o mesmo nome. Traduzir o `23505`
 * para `null` é trabalho do repositório justamente para o serviço não precisar
 * conhecer código de erro do Postgres.
 *
 * Sem `position`, a categoria vai para o **fim** — e o cálculo acontece dentro
 * do próprio insert, não numa consulta separada antes. Duas criações
 * simultâneas ainda podem ler o mesmo `max(position)` e nascer empatadas; isso
 * não é erro, porque o desempate por nome mantém a ordem estável.
 */
export async function insert(
  restaurantId: string,
  input: CreateCategoryInput,
  db: Queryable = pool,
): Promise<Category | null> {
  try {
    const { rows } = await db.query<CategoryRow>(
      `insert into categories (restaurant_id, name, position)
       values (
         $1,
         $2,
         coalesce(
           $3::integer,
           (select coalesce(max(position) + 1, 0) from categories
             where restaurant_id = $1 and deleted_at is null)
         )
       )
       returning *`,
      [restaurantId, input.name, input.position ?? null],
    );
    return toCategory(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
    throw error;
  }
}

/**
 * Uma página de categorias vivas do restaurante, mais o total de vivas daquele
 * restaurante. Duas queries pelo mesmo motivo dos outros repositórios: um
 * `count(*) over ()` não devolve linha nenhuma quando a página está vazia, e aí
 * um `offset` além do fim reportaria `total: 0`.
 */
export async function findByRestaurant(
  restaurantId: string,
  { limit, offset }: Pagination,
  db: Queryable = pool,
): Promise<{ rows: Category[]; total: number }> {
  const { rows } = await db.query<CategoryRow>(
    `select * from categories
      where restaurant_id = $1 and deleted_at is null
      ${ORDER_BY}
      limit $2 offset $3`,
    [restaurantId, limit, offset],
  );

  const { rows: countRows } = await db.query<{ total: string }>(
    `select count(*) as total from categories
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );

  return { rows: rows.map(toCategory), total: Number(countRows[0].total) };
}

/**
 * Categoria viva, **escopada pelo restaurante** — a autorização vai na própria
 * query (`and restaurant_id = $2`), não numa checagem separada depois (S23).
 */
export async function findById(
  restaurantId: string,
  id: string,
  db: Queryable = pool,
): Promise<Category | null> {
  const { rows } = await db.query<CategoryRow>(
    `select * from categories
      where id = $1 and restaurant_id = $2 and deleted_at is null`,
    [id, restaurantId],
  );
  return rows.length === 0 ? null : toCategory(rows[0]);
}

/**
 * O que aconteceu numa tentativa de edição.
 *
 * Aqui o `null` de "não achei" não bastaria: renomear pode esbarrar no nome de
 * outra categoria, e os dois casos viram status diferentes (404 e 409). O
 * repositório continua sem decidir nada — ele relata o que o banco respondeu, e
 * quem escolhe o status code é o serviço.
 */
export type UpdateOutcome =
  | { outcome: "updated"; category: Category }
  | { outcome: "not-found" }
  | { outcome: "name-taken" };

/** Aplica os campos enviados. */
export async function update(
  restaurantId: string,
  id: string,
  input: UpdateCategoryInput,
  db: Queryable = pool,
): Promise<UpdateOutcome> {
  // SET dinâmico percorrendo o mapa fixo de colunas, nunca as chaves do input
  // (S8/D8): assim `id` ou `createdAt` no corpo não têm por onde entrar.
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [field, column] of Object.entries(categoryColumns)) {
    const value = input[field as keyof typeof categoryColumns];
    if (value === undefined) continue;
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }

  assignments.push("updated_at = now()");
  values.push(id, restaurantId);

  try {
    const { rows } = await db.query<CategoryRow>(
      `update categories
          set ${assignments.join(", ")}
        where id = $${values.length - 1}
          and restaurant_id = $${values.length}
          and deleted_at is null
        returning *`,
      values,
    );
    return rows.length === 0
      ? { outcome: "not-found" }
      : { outcome: "updated", category: toCategory(rows[0]) };
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      return { outcome: "name-taken" };
    }
    throw error;
  }
}

/** Soft delete de uma categoria. `false` = não existe ou já foi removida (D1). */
export async function softDelete(
  restaurantId: string,
  id: string,
  db: Queryable = pool,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update categories set deleted_at = now()
      where id = $1 and restaurant_id = $2 and deleted_at is null`,
    [id, restaurantId],
  );
  return rowCount === 1;
}

/**
 * Soft delete de todas as categorias de um restaurante (a cascata do D3).
 * Recebe o `client` porque só faz sentido junto com a remoção do restaurante,
 * na mesma transação.
 */
export async function softDeleteByRestaurant(
  restaurantId: string,
  db: Queryable,
): Promise<void> {
  await db.query(
    `update categories set deleted_at = now()
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );
}
