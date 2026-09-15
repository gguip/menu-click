import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type {
  CreateTableInput,
  Table,
  UpdateTableInput,
} from "../domain/table.ts";
import type { Pagination } from "../domain/pagination.ts";

/**
 * Repositório de mesas: **só acesso a dados**.
 *
 * Todo o SQL da tabela `tables` está aqui, e soft delete em toda consulta
 * (`deleted_at is null`) — ver `.claude/rules/database.md`.
 */

/** Linha da tabela `tables`, em snake_case como vem do Postgres. */
type TableRow = {
  id: string;
  restaurant_id: string;
  label: string;
  hash: string;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase usado fora daqui (D12). */
function toTable(row: TableRow): Table {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    label: row.label,
    hash: row.hash,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Campos editáveis via PATCH → coluna. O `hash` não está aqui de propósito. */
const tableColumns = { label: "label" } as const;

/** Violação de unicidade — aqui, o rótulo repetido dentro do restaurante. */
const UNIQUE_VIOLATION = "23505";

/** Ordem determinística do projeto (D11). */
const ORDER_BY = "order by created_at, id";

/**
 * Insere uma mesa — ou `null` se o rótulo já está em uso naquele restaurante
 * (o índice é sobre `lower(label)`, então "Mesa 7" colide com "mesa 7").
 *
 * O conflito vem do índice único, nunca de um `select` antes: entre checar e
 * inserir cabe outra requisição com o mesmo rótulo. Traduzir o `23505` para
 * `null` é trabalho do repositório, para o serviço não conhecer código de erro
 * do Postgres.
 */
export async function insert(
  restaurantId: string,
  input: CreateTableInput,
  hash: string,
  db: Queryable = pool,
): Promise<Table | null> {
  try {
    const { rows } = await db.query<TableRow>(
      `insert into tables (restaurant_id, label, hash)
       values ($1, $2, $3)
       returning *`,
      [restaurantId, input.label, hash],
    );
    return toTable(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
    throw error;
  }
}

/**
 * Uma página de mesas vivas do restaurante, mais o total. Duas queries pelo
 * mesmo motivo dos outros repositórios: `count(*) over ()` não devolve linha
 * quando a página está vazia, e aí um `offset` além do fim reportaria zero.
 */
export async function findByRestaurant(
  restaurantId: string,
  { limit, offset }: Pagination,
  db: Queryable = pool,
): Promise<{ rows: Table[]; total: number }> {
  const { rows } = await db.query<TableRow>(
    `select * from tables
      where restaurant_id = $1 and deleted_at is null
      ${ORDER_BY}
      limit $2 offset $3`,
    [restaurantId, limit, offset],
  );

  const { rows: countRows } = await db.query<{ total: string }>(
    `select count(*) as total from tables
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );

  return { rows: rows.map(toTable), total: Number(countRows[0].total) };
}

/**
 * Mesa viva, **escopada pelo restaurante** — a autorização vai na própria
 * query, não numa checagem separada depois (S23).
 */
export async function findById(
  restaurantId: string,
  id: string,
  db: Queryable = pool,
): Promise<Table | null> {
  const { rows } = await db.query<TableRow>(
    `select * from tables
      where id = $1 and restaurant_id = $2 and deleted_at is null`,
    [id, restaurantId],
  );
  return rows.length === 0 ? null : toTable(rows[0]);
}

/**
 * Mesa viva pelo hash **dentro de um restaurante**.
 *
 * O `restaurant_id` na cláusula não é redundante com a unicidade global do
 * hash: ele é o que impede um hash legítimo de etiquetar pedido em loja alheia
 * (S23). O índice global garante que o hash não signifique duas mesas; esta
 * condição garante que ele signifique uma mesa **desta** loja.
 */
export async function findByHash(
  restaurantId: string,
  hash: string,
  db: Queryable = pool,
): Promise<Table | null> {
  const { rows } = await db.query<TableRow>(
    `select * from tables
      where hash = $1 and restaurant_id = $2 and deleted_at is null`,
    [hash, restaurantId],
  );
  return rows.length === 0 ? null : toTable(rows[0]);
}

/**
 * Mesa viva pelo hash a partir do SLUG do restaurante — o caminho da
 * resolução pública, que não conhece id nenhum.
 *
 * O join filtra o restaurante vivo **e verificado**: loja que não provou o
 * e-mail é indistinguível de loja que não existe em toda a superfície pública
 * (S32), e o rótulo da mesa é superfície pública.
 */
export async function findByHashAndSlug(
  slug: string,
  hash: string,
  db: Queryable = pool,
): Promise<Table | null> {
  const { rows } = await db.query<TableRow>(
    `select t.* from tables t
       join restaurants r on r.id = t.restaurant_id
      where t.hash = $1
        and r.slug = $2
        and t.deleted_at is null
        and r.deleted_at is null
        and r.email_verified_at is not null`,
    [hash, slug],
  );
  return rows.length === 0 ? null : toTable(rows[0]);
}

/**
 * O que aconteceu numa tentativa de edição — o `null` de "não achei" não
 * bastaria, porque renomear pode esbarrar no rótulo de outra mesa, e os dois
 * casos viram status diferentes (404 e 409).
 */
export type UpdateOutcome =
  | { outcome: "updated"; table: Table }
  | { outcome: "not-found" }
  | { outcome: "label-taken" };

export async function update(
  restaurantId: string,
  id: string,
  input: UpdateTableInput,
  db: Queryable = pool,
): Promise<UpdateOutcome> {
  // SET dinâmico percorrendo o mapa fixo de colunas, nunca as chaves do input
  // (S8/D8): assim `hash` ou `createdAt` no corpo não têm por onde entrar.
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [field, column] of Object.entries(tableColumns)) {
    const value = input[field as keyof typeof tableColumns];
    if (value === undefined) continue;
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }

  assignments.push("updated_at = now()");
  values.push(id, restaurantId);

  try {
    const { rows } = await db.query<TableRow>(
      `update tables
          set ${assignments.join(", ")}
        where id = $${values.length - 1}
          and restaurant_id = $${values.length}
          and deleted_at is null
        returning *`,
      values,
    );
    return rows.length === 0
      ? { outcome: "not-found" }
      : { outcome: "updated", table: toTable(rows[0]) };
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      return { outcome: "label-taken" };
    }
    throw error;
  }
}

/**
 * Troca o hash da mesa por um novo. `null` = não existe ou já foi removida.
 *
 * É operação própria, e não um campo do PATCH, porque o efeito dela é físico:
 * o adesivo colado na mesa para de resolver no instante do commit. Renomear
 * "Mesa 7" para "Mesa 8" não pode matar um QR impresso como efeito colateral —
 * é a mesma razão que mantém o `slug` fora do PATCH do restaurante.
 */
export async function rotateHash(
  restaurantId: string,
  id: string,
  hash: string,
  db: Queryable = pool,
): Promise<Table | null> {
  const { rows } = await db.query<TableRow>(
    `update tables set hash = $1, updated_at = now()
      where id = $2 and restaurant_id = $3 and deleted_at is null
      returning *`,
    [hash, id, restaurantId],
  );
  return rows.length === 0 ? null : toTable(rows[0]);
}

/** Soft delete de uma mesa. `false` = não existe ou já foi removida (D1). */
export async function softDelete(
  restaurantId: string,
  id: string,
  db: Queryable = pool,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update tables set deleted_at = now()
      where id = $1 and restaurant_id = $2 and deleted_at is null`,
    [id, restaurantId],
  );
  return rowCount === 1;
}

/**
 * Soft delete de todas as mesas de um restaurante (a cascata do D3). Recebe o
 * `client` porque só faz sentido junto com a remoção do restaurante, na mesma
 * transação.
 */
export async function softDeleteByRestaurant(
  restaurantId: string,
  db: Queryable,
): Promise<void> {
  await db.query(
    `update tables set deleted_at = now()
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );
}
