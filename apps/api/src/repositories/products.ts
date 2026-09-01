import type { PoolClient } from "pg";
import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { Pagination } from "../domain/pagination.ts";
import type {
  CreateProductInput,
  Product,
  ProductFilters,
  UpdateProductInput,
} from "../domain/product.ts";

/**
 * Repositório de produtos: **só acesso a dados**.
 *
 * Todo o SQL da tabela `products` está aqui. Sem regra de negócio: "não achei"
 * volta como `null`/`false` e quem transforma isso em 404 é o serviço.
 *
 * Soft delete em toda consulta (`deleted_at is null`) — ver
 * `.claude/rules/database.md`.
 */

/** Linha da tabela `products`, em snake_case como vem do Postgres. */
type ProductRow = {
  id: string;
  restaurant_id: string;
  name: string;
  category_id: string | null;
  price_in_cents: number;
  description: string | null;
  photo_url: string | null;
  stock: number;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase usado fora daqui (D12). */
function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    priceInCents: row.price_in_cents,
    // opcionais: quando são NULL no banco, a chave nem entra na resposta.
    ...(row.category_id === null ? {} : { categoryId: row.category_id }),
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.photo_url === null ? {} : { photoUrl: row.photo_url }),
    stock: row.stock,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Campos editáveis via PATCH → coluna correspondente na tabela. */
const productColumns = {
  name: "name",
  categoryId: "category_id",
  priceInCents: "price_in_cents",
  description: "description",
  photoUrl: "photo_url",
  stock: "stock",
} as const;

/** Insere um produto no restaurante e devolve o que foi criado. */
export async function insert(
  restaurantId: string,
  input: CreateProductInput,
  db: Queryable = pool,
): Promise<Product> {
  const { rows } = await db.query<ProductRow>(
    `insert into products
       (restaurant_id, name, category_id, price_in_cents, description, photo_url, stock)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      restaurantId,
      input.name,
      input.categoryId ?? null,
      input.priceInCents,
      input.description ?? null,
      input.photoUrl ?? null,
      // a coluna é `not null default 0`; sem valor explícito o driver mandaria
      // NULL (que não é "ausente") e a inserção estouraria.
      input.stock ?? 0,
    ],
  );

  return toProduct(rows[0]);
}

/**
 * Escapa os curingas do `LIKE` vindos do cliente (S5).
 *
 * `%` e `_` não são injection — o termo continua indo como parâmetro —, mas
 * são operadores: buscar por "%" sem escapar casa com o cardápio inteiro, e
 * "_" casaria com qualquer caractere. Escapados, valem como o texto que a
 * pessoa digitou. A barra invertida entra na lista porque ela é o próprio
 * caractere de escape do Postgres.
 */
function escapeLikeWildcards(termo: string): string {
  return termo.replace(/[\\%_]/g, (curinga) => `\\${curinga}`);
}

/**
 * Uma página de produtos vivos do restaurante (D11), mais o total de vivos
 * daquele restaurante — não da tabela inteira — **já considerando os filtros**.
 *
 * Sem filtro, o `order by`/`limit` casa exatamente com o índice parcial
 * `products_active_by_restaurant_idx (restaurant_id, created_at, id)`.
 * Duas queries pelo mesmo motivo do repositório de restaurantes.
 *
 * As condições são montadas aqui, mas todo valor continua indo como `$n`: o
 * que a lista abaixo concatena são pedaços fixos de SQL escritos neste arquivo,
 * nunca algo vindo da requisição (S2).
 */
export async function findByRestaurant(
  restaurantId: string,
  { limit, offset }: Pagination,
  filters: ProductFilters = {},
  db: Queryable = pool,
): Promise<{ rows: Product[]; total: number }> {
  const conditions = ["restaurant_id = $1", "deleted_at is null"];
  const filterValues: unknown[] = [restaurantId];

  if (filters.categoryId !== undefined) {
    filterValues.push(filters.categoryId);
    conditions.push(`category_id = $${filterValues.length}`);
  }

  if (filters.search !== undefined) {
    filterValues.push(`%${escapeLikeWildcards(filters.search)}%`);
    // ilike: quem procura "coca" espera achar "Coca-Cola"
    conditions.push(`name ilike $${filterValues.length}`);
  }

  const where = conditions.join(" and ");

  const { rows } = await db.query<ProductRow>(
    `select * from products
      where ${where}
      order by created_at, id
      limit $${filterValues.length + 1} offset $${filterValues.length + 2}`,
    [...filterValues, limit, offset],
  );

  const { rows: countRows } = await db.query<{ total: string }>(
    `select count(*) as total from products where ${where}`,
    filterValues,
  );

  return { rows: rows.map(toProduct), total: Number(countRows[0].total) };
}

/**
 * Todos os produtos vivos das categorias informadas, em uma query só.
 *
 * É a segunda metade do cardápio público: a primeira busca a página de
 * categorias, esta traz os produtos de todas elas de uma vez, em vez de uma
 * consulta por seção. Quem agrupa é o serviço — repositório não monta formato
 * de resposta.
 *
 * Sem `limit`, e não por esquecimento: a paginação existe para impedir que um
 * **cliente** peça uma resposta sem fim, e o cliente não escolhe quantos
 * produtos cabem numa seção — quem escolhe é o restaurante, montando o próprio
 * cardápio. Cortar em N esconderia prato do cardápio, que é pior do que a
 * resposta grande.
 */
export async function findByCategoryIds(
  restaurantId: string,
  categoryIds: string[],
  db: Queryable = pool,
): Promise<Product[]> {
  const { rows } = await db.query<ProductRow>(
    `select * from products
      where restaurant_id = $1
        and category_id = any($2::uuid[])
        and deleted_at is null
      order by created_at, id`,
    [restaurantId, categoryIds],
  );
  return rows.map(toProduct);
}

/**
 * Os produtos vivos que não estão em seção nenhuma — o grupo "Sem categoria"
 * do cardápio. Existem porque a seção deles foi removida, ou porque nunca
 * receberam uma.
 */
export async function findUncategorized(
  restaurantId: string,
  db: Queryable = pool,
): Promise<Product[]> {
  const { rows } = await db.query<ProductRow>(
    `select * from products
      where restaurant_id = $1
        and category_id is null
        and deleted_at is null
      order by created_at, id`,
    [restaurantId],
  );
  return rows.map(toProduct);
}

/**
 * Tira os produtos de uma categoria (`category_id = null`), sem removê-los.
 *
 * É o que acontece quando a seção é apagada: o produto continua no cardápio,
 * agrupado em "Sem categoria". Recebe o `client` porque só faz sentido junto
 * com a remoção da categoria, na mesma transação (D3).
 */
export async function clearCategory(
  restaurantId: string,
  categoryId: string,
  db: Queryable,
): Promise<void> {
  await db.query(
    `update products set category_id = null, updated_at = now()
      where restaurant_id = $1 and category_id = $2 and deleted_at is null`,
    [restaurantId, categoryId],
  );
}

/**
 * Produto vivo, **escopado pelo restaurante** — a autorização vai na própria
 * query (`and restaurant_id = $2`), não numa checagem separada depois.
 */
export async function findById(
  restaurantId: string,
  id: string,
  db: Queryable = pool,
): Promise<Product | null> {
  const { rows } = await db.query<ProductRow>(
    `select * from products
      where id = $1 and restaurant_id = $2 and deleted_at is null`,
    [id, restaurantId],
  );
  return rows.length === 0 ? null : toProduct(rows[0]);
}

/** Aplica os campos enviados; `null` se o produto não existe nesse restaurante. */
export async function update(
  restaurantId: string,
  id: string,
  input: UpdateProductInput,
  db: Queryable = pool,
): Promise<Product | null> {
  // Mesmo SET dinâmico do repositório de restaurantes: só os campos enviados,
  // percorrendo o mapa de colunas (nunca as chaves do input).
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [field, column] of Object.entries(productColumns)) {
    const value = input[field as keyof typeof productColumns];
    if (value === undefined) continue;
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }

  // id, restaurantId e createdAt ficam intocados; updatedAt renova (D10).
  assignments.push("updated_at = now()");
  values.push(id, restaurantId);

  const { rows } = await db.query<ProductRow>(
    `update products
        set ${assignments.join(", ")}
      where id = $${values.length - 1}
        and restaurant_id = $${values.length}
        and deleted_at is null
      returning *`,
    values,
  );
  return rows.length === 0 ? null : toProduct(rows[0]);
}

/** Soft delete de um produto. `false` = não existe ou já estava removido (D1). */
export async function softDelete(
  restaurantId: string,
  id: string,
  db: Queryable = pool,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update products set deleted_at = now()
      where id = $1 and restaurant_id = $2 and deleted_at is null`,
    [id, restaurantId],
  );
  return rowCount === 1;
}

/**
 * Soft delete de todos os produtos de um restaurante (a cascata do D3). Recebe
 * o `client` porque só faz sentido junto com a remoção do restaurante, na mesma
 * transação.
 */
export async function softDeleteByRestaurant(
  restaurantId: string,
  db: Queryable,
): Promise<void> {
  await db.query(
    `update products set deleted_at = now()
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );
}

/**
 * Produtos vivos do restaurante entre os ids informados, em uma query só.
 *
 * Os ids vão como array parametrizado (`= any($2::uuid[])`), nunca montando um
 * `in (...)` por concatenação (S4). Quem chama compara o tamanho do resultado
 * com o que pediu para descobrir o que faltou — o repositório não decide que
 * "faltou" é erro.
 */
export async function findManyByIds(
  restaurantId: string,
  ids: string[],
  db: Queryable = pool,
): Promise<Product[]> {
  const { rows } = await db.query<ProductRow>(
    `select * from products
      where restaurant_id = $1 and id = any($2::uuid[]) and deleted_at is null`,
    [restaurantId, ids],
  );
  return rows.map(toProduct);
}

/**
 * Estoque dos produtos informados, com as linhas **travadas** até o fim da
 * transação. É o `select ... for update` da confirmação de pedido.
 *
 * O `order by id` fixa a ordem em que as linhas são travadas. Sem ele a ordem
 * fica por conta do plano de execução: hoje o plano é o mesmo nas duas
 * transações e nada acontece, mas duas transações que travem os mesmos
 * produtos em ordens diferentes esperam uma pela outra em ciclo — deadlock,
 * que o Postgres resolve matando uma delas. É proteção contra um plano futuro
 * (index scan virando seq scan com a tabela maior), não contra um bug
 * observável hoje: nenhum teste falha se esta linha sair.
 *
 * Produto removido não volta na lista; quem chama decide o que fazer com isso.
 */
export async function selectStocksForUpdate(
  ids: string[],
  client: PoolClient,
): Promise<{ id: string; stock: number }[]> {
  const { rows } = await client.query<{ id: string; stock: number }>(
    `select id, stock from products
      where id = any($1::uuid[]) and deleted_at is null
      order by id
      for update`,
    [ids],
  );
  return rows;
}

/**
 * Devolve `quantity` ao estoque, no cancelamento de um pedido que já havia
 * debitado. Roda na mesma transação e com a linha já travada, como o débito.
 */
export async function incrementStock(
  id: string,
  quantity: number,
  client: PoolClient,
): Promise<number> {
  const { rows } = await client.query<{ stock: number }>(
    `update products set stock = stock + $1, updated_at = now()
      where id = $2 and deleted_at is null
      returning stock`,
    [quantity, id],
  );
  return rows[0].stock;
}

/**
 * Debita `quantity` do estoque e devolve o que sobrou. Roda dentro da
 * transação, com a linha já travada por `selectStocksForUpdate` — é o lock, e
 * não o `stock - $1`, que garante que ninguém leu o mesmo valor no meio.
 */
export async function decrementStock(
  id: string,
  quantity: number,
  client: PoolClient,
): Promise<number> {
  const { rows } = await client.query<{ stock: number }>(
    `update products set stock = stock - $1, updated_at = now()
      where id = $2 and deleted_at is null
      returning stock`,
    [quantity, id],
  );
  return rows[0].stock;
}
