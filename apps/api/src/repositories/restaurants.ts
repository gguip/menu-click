import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type {
  Address,
  CreateRestaurantInput,
  Restaurant,
  UpdateRestaurantInput,
} from "../domain/restaurant.ts";

/**
 * Repositório de restaurantes: **só acesso a dados**.
 *
 * Aqui mora todo o SQL da tabela `restaurants` — e só aqui. Não há regra de
 * negócio: um id que não existe volta como `null`/`false`, e quem decide que
 * isso é um 404 é o serviço. Nada neste arquivo conhece Fastify.
 *
 * Soft delete: nada é apagado de verdade. `deleted_at` NULL = registro vivo;
 * preenchido = removido. TODA consulta filtra `deleted_at is null`, e o DELETE
 * vira `update ... set deleted_at = now()`. Ver `.claude/rules/database.md`.
 */

/** Linha da tabela `restaurants`, em snake_case como vem do Postgres. */
type RestaurantRow = {
  id: string;
  name: string;
  cuisine_type: string;
  logo_url: string | null;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  is_delivery: boolean;
  is_qrcode: boolean;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase usado fora daqui (D12). */
function toRestaurant(row: RestaurantRow): Restaurant {
  return {
    id: row.id,
    name: row.name,
    cuisineType: row.cuisine_type,
    // logoUrl é opcional: quando é NULL no banco, a chave nem entra na resposta.
    ...(row.logo_url === null ? {} : { logoUrl: row.logo_url }),
    address: {
      street: row.street,
      number: row.number,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      zipCode: row.zip_code,
    },
    isDelivery: row.is_delivery,
    isQrcode: row.is_qrcode,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Campos simples editáveis via PATCH → coluna correspondente na tabela. */
const restaurantColumns = {
  name: "name",
  cuisineType: "cuisine_type",
  logoUrl: "logo_url",
  isDelivery: "is_delivery",
  isQrcode: "is_qrcode",
} as const;

/** O endereço mora em colunas planas: campo do value object → coluna. */
const addressColumns = {
  street: "street",
  number: "number",
  neighborhood: "neighborhood",
  city: "city",
  state: "state",
  zipCode: "zip_code",
} as const;

/** Insere e devolve o restaurante criado. */
export async function insert(
  input: CreateRestaurantInput,
  db: Queryable = pool,
): Promise<Restaurant> {
  // id/createdAt/updatedAt saem dos defaults da tabela — daí o RETURNING * (D9).
  const { rows } = await db.query<RestaurantRow>(
    `insert into restaurants
       (name, cuisine_type, logo_url,
        street, number, neighborhood, city, state, zip_code,
        is_delivery, is_qrcode)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning *`,
    [
      input.name,
      input.cuisineType,
      input.logoUrl ?? null,
      input.address.street,
      input.address.number,
      input.address.neighborhood,
      input.address.city,
      input.address.state,
      input.address.zipCode,
      input.isDelivery,
      input.isQrcode,
    ],
  );

  return toRestaurant(rows[0]);
}

/** Todos os restaurantes vivos, em ordem de criação (D11). */
export async function findAll(db: Queryable = pool): Promise<Restaurant[]> {
  const { rows } = await db.query<RestaurantRow>(
    `select * from restaurants
      where deleted_at is null
      order by created_at, id`,
  );
  return rows.map(toRestaurant);
}

/** Restaurante vivo com esse id, ou `null`. */
export async function findById(
  id: string,
  db: Queryable = pool,
): Promise<Restaurant | null> {
  const { rows } = await db.query<RestaurantRow>(
    "select * from restaurants where id = $1 and deleted_at is null",
    [id],
  );
  return rows.length === 0 ? null : toRestaurant(rows[0]);
}

/** Existe restaurante vivo com esse id? Não traz a linha inteira. */
export async function exists(
  id: string,
  db: Queryable = pool,
): Promise<boolean> {
  const { rowCount } = await db.query(
    "select 1 from restaurants where id = $1 and deleted_at is null",
    [id],
  );
  return rowCount === 1;
}

/**
 * Aplica os campos enviados e devolve a linha atualizada — ou `null` se não
 * existe (ou já foi removido).
 */
export async function update(
  id: string,
  input: UpdateRestaurantInput,
  db: Queryable = pool,
): Promise<Restaurant | null> {
  // SET dinâmico com só os campos enviados. Percorremos o mapa de colunas
  // (nunca as chaves do input) para nada vindo do cliente virar SQL, e os
  // valores vão sempre como parâmetro $n (S3/S8).
  const assignments: string[] = [];
  const values: unknown[] = [];

  function assign(column: string, value: unknown) {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }

  for (const [field, column] of Object.entries(restaurantColumns)) {
    const value = input[field as keyof typeof restaurantColumns];
    if (value === undefined) continue;
    assign(column, value);
  }

  // Endereço é value object: quando vem no PATCH vem inteiro, então as seis
  // colunas são atualizadas de uma vez.
  const { address } = input;
  if (address !== undefined) {
    for (const [field, column] of Object.entries(addressColumns)) {
      assign(column, address[field as keyof Address]);
    }
  }

  // updatedAt renova em todo UPDATE (D10); id e createdAt ficam intocados.
  assignments.push("updated_at = now()");
  values.push(id);

  const { rows } = await db.query<RestaurantRow>(
    `update restaurants
        set ${assignments.join(", ")}
      where id = $${values.length} and deleted_at is null
      returning *`,
    values,
  );
  return rows.length === 0 ? null : toRestaurant(rows[0]);
}

/**
 * Soft delete do restaurante. Devolve `false` quando não havia registro vivo
 * com esse id — o `and deleted_at is null` é o que impede sobrescrever a data
 * original numa segunda remoção (D1).
 */
export async function softDelete(
  id: string,
  db: Queryable = pool,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update restaurants set deleted_at = now()
      where id = $1 and deleted_at is null`,
    [id],
  );
  return rowCount === 1;
}
