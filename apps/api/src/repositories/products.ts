import type { PoolClient } from "pg";
import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type {
  CreateProductInput,
  Product,
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
  category: string;
  price_in_cents: number;
  description: string | null;
  photo_url: string | null;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase usado fora daqui (D12). */
function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    category: row.category,
    priceInCents: row.price_in_cents,
    // opcionais: quando são NULL no banco, a chave nem entra na resposta.
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.photo_url === null ? {} : { photoUrl: row.photo_url }),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Campos editáveis via PATCH → coluna correspondente na tabela. */
const productColumns = {
  name: "name",
  category: "category",
  priceInCents: "price_in_cents",
  description: "description",
  photoUrl: "photo_url",
} as const;

/** Insere um produto no restaurante e devolve o que foi criado. */
export async function insert(
  restaurantId: string,
  input: CreateProductInput,
  db: Queryable = pool,
): Promise<Product> {
  const { rows } = await db.query<ProductRow>(
    `insert into products
       (restaurant_id, name, category, price_in_cents, description, photo_url)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      restaurantId,
      input.name,
      input.category,
      input.priceInCents,
      input.description ?? null,
      input.photoUrl ?? null,
    ],
  );

  return toProduct(rows[0]);
}

/** Produtos vivos de um restaurante, em ordem de criação (D11). */
export async function findByRestaurant(
  restaurantId: string,
  db: Queryable = pool,
): Promise<Product[]> {
  const { rows } = await db.query<ProductRow>(
    `select * from products
      where restaurant_id = $1 and deleted_at is null
      order by created_at, id`,
    [restaurantId],
  );
  return rows.map(toProduct);
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
 * Lê o estoque travando a linha até o fim da transação. Exige um `client` (não
 * o pool): `for update` fora de uma transação libera o lock na hora e não
 * protege nada. Devolve `null` se o produto não existe.
 */
export async function selectStockForUpdate(
  id: string,
  client: PoolClient,
): Promise<number | null> {
  const { rows } = await client.query<{ stock: number }>(
    `select stock from products
      where id = $1 and deleted_at is null
      for update`,
    [id],
  );
  return rows.length === 0 ? null : rows[0].stock;
}

/** Grava o novo estoque e devolve o valor gravado. Roda dentro da transação. */
export async function updateStock(
  id: string,
  stock: number,
  client: PoolClient,
): Promise<number> {
  const { rows } = await client.query<{ stock: number }>(
    `update products set stock = $1, updated_at = now()
      where id = $2 and deleted_at is null
      returning stock`,
    [stock, id],
  );
  return rows[0].stock;
}
