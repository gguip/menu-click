import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { Pagination } from "../domain/pagination.ts";
import type {
  Address,
  CreateRestaurantInput,
  Restaurant,
  UpdateRestaurantInput,
} from "../domain/restaurant.ts";
import type { DeliveryFeeMode } from "../domain/delivery.ts";

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
  slug: string;
  cuisine_type: string;
  logo_url: string | null;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  is_delivery: boolean;
  is_takeaway: boolean;
  is_qrcode: boolean;
  timezone: string;
  accepting_orders: boolean;
  accepts_cash: boolean;
  accepts_card_on_delivery: boolean;
  accepts_pix: boolean;
  accepts_meal_voucher: boolean;
  delivery_fee_mode: DeliveryFeeMode;
  delivery_fixed_fee_in_cents: number;
  free_delivery_above_in_cents: number | null;
  delivery_fee_to_arrange: boolean;
  minimum_order_in_cents: number;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase usado fora daqui (D12). */
function toRestaurant(row: RestaurantRow): Restaurant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
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
    isTakeaway: row.is_takeaway,
    isQrcode: row.is_qrcode,
    timezone: row.timezone,
    acceptingOrders: row.accepting_orders,
    acceptsCash: row.accepts_cash,
    acceptsCardOnDelivery: row.accepts_card_on_delivery,
    acceptsPix: row.accepts_pix,
    acceptsMealVoucher: row.accepts_meal_voucher,
    deliveryFeeMode: row.delivery_fee_mode,
    deliveryFixedFeeInCents: row.delivery_fixed_fee_in_cents,
    // freeDeliveryAboveInCents é opcional: quando é NULL no banco (a promoção
    // não existe), a chave nem entra na resposta — mesmo padrão do logoUrl.
    ...(row.free_delivery_above_in_cents === null
      ? {}
      : { freeDeliveryAboveInCents: row.free_delivery_above_in_cents }),
    deliveryFeeToArrange: row.delivery_fee_to_arrange,
    minimumOrderInCents: row.minimum_order_in_cents,
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
  isTakeaway: "is_takeaway",
  isQrcode: "is_qrcode",
  timezone: "timezone",
  acceptingOrders: "accepting_orders",
  acceptsCash: "accepts_cash",
  acceptsCardOnDelivery: "accepts_card_on_delivery",
  acceptsPix: "accepts_pix",
  acceptsMealVoucher: "accepts_meal_voucher",
  deliveryFeeMode: "delivery_fee_mode",
  deliveryFixedFeeInCents: "delivery_fixed_fee_in_cents",
  freeDeliveryAboveInCents: "free_delivery_above_in_cents",
  deliveryFeeToArrange: "delivery_fee_to_arrange",
  minimumOrderInCents: "minimum_order_in_cents",
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

/** Violação de unicidade no Postgres. */
const UNIQUE_VIOLATION = "23505";

/**
 * Insere e devolve o restaurante criado — ou `null` se o `slug` já está em uso.
 *
 * O conflito é detectado pelo índice único, não por um `select` antes: entre a
 * checagem e o insert cabe outra requisição com o mesmo slug, e aí quem
 * decidiria seria o banco de qualquer jeito (com um 500 em vez de um 409).
 *
 * Traduzir o código `23505` para `null` é trabalho do repositório justamente
 * para o serviço não precisar conhecer código de erro do Postgres — do lado de
 * fora isso é só mais um "não deu", igual ao `null` de "não achei".
 */
export async function insert(
  input: CreateRestaurantInput & { slug: string },
  db: Queryable = pool,
): Promise<Restaurant | null> {
  try {
    // id/createdAt/updatedAt saem dos defaults da tabela — daí o RETURNING (D9)
    const { rows } = await db.query<RestaurantRow>(
      `insert into restaurants
         (name, slug, cuisine_type, logo_url,
          street, number, neighborhood, city, state, zip_code,
          is_delivery, is_takeaway, is_qrcode, timezone, accepting_orders,
          accepts_cash, accepts_card_on_delivery, accepts_pix, accepts_meal_voucher,
          delivery_fee_mode, delivery_fixed_fee_in_cents, delivery_fee_to_arrange,
          free_delivery_above_in_cents, minimum_order_in_cents)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               coalesce($14, 'America/Sao_Paulo'), coalesce($15, true),
               coalesce($16, true), coalesce($17, true), coalesce($18, true),
               coalesce($19, false),
               coalesce($20, 'fixed'), coalesce($21, 0), coalesce($22, false),
               $23, coalesce($24, 0))
       returning *`,
      [
        input.name,
        input.slug,
        input.cuisineType,
        input.logoUrl ?? null,
        input.address.street,
        input.address.number,
        input.address.neighborhood,
        input.address.city,
        input.address.state,
        input.address.zipCode,
        input.isDelivery,
        input.isTakeaway,
        input.isQrcode,
        // null deixa o `coalesce` cair no default da coluna: o fuso é opcional
        // no cadastro, e repetir a constante aqui criaria um segundo default
        input.timezone ?? null,
        // idem: hoje o corpo de criação não oferece o campo, então isto é
        // sempre null. Vai como parâmetro mesmo assim porque o tipo de entrada
        // aceita `acceptingOrders` — descartá-lo aqui faria o insert prometer
        // no tipo o que não cumpre no SQL.
        input.acceptingOrders ?? null,
        // as quatro formas de pagamento: null cai no default da coluna
        // (true nas três primeiras, false no vale-refeição)
        input.acceptsCash ?? null,
        input.acceptsCardOnDelivery ?? null,
        input.acceptsPix ?? null,
        input.acceptsMealVoucher ?? null,
        // os quatro do frete: mesmo raciocínio do `acceptingOrders` acima — o
        // corpo de criação não os oferece hoje, então isto é sempre null, mas
        // descartá-los aqui faria o insert prometer no tipo o que não cumpre
        // no SQL. `free_delivery_above_in_cents` vai sem `coalesce`: a coluna é
        // nulável de verdade, e null ali significa "não há promoção".
        input.deliveryFeeMode ?? null,
        input.deliveryFixedFeeInCents ?? null,
        input.deliveryFeeToArrange ?? null,
        input.freeDeliveryAboveInCents ?? null,
        // mesmo raciocínio dos quatro acima: o corpo de criação não oferece o
        // campo, mas descartá-lo aqui faria o insert prometer no tipo o que
        // não cumpre no SQL
        input.minimumOrderInCents ?? null,
      ],
    );
    return toRestaurant(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
    throw error;
  }
}

/** Restaurante vivo com esse slug, ou `null`. É a busca do cardápio público. */
export async function findBySlug(
  slug: string,
  db: Queryable = pool,
): Promise<Restaurant | null> {
  const { rows } = await db.query<RestaurantRow>(
    "select * from restaurants where slug = $1 and deleted_at is null",
    [slug],
  );
  return rows.length === 0 ? null : toRestaurant(rows[0]);
}

/**
 * Uma página dos restaurantes informados que estejam vivos, em ordem de criação
 * (D11), mais o total.
 *
 * Recebe ids em vez de listar a tabela inteira porque não existe mais listagem
 * geral: quem chama sempre parte de "os restaurantes desta sessão".
 *
 * São duas queries de propósito: `count(*) over ()` traria o total na mesma
 * ida, mas devolve zero linhas quando a página está vazia — e aí um `offset`
 * além do fim reportaria `total: 0`, escondendo que há registros antes.
 */
export async function findAllByIds(
  ids: string[],
  { limit, offset }: Pagination,
  db: Queryable = pool,
): Promise<{ rows: Restaurant[]; total: number }> {
  // S4: array parametrizado, nunca um `in (...)` montado por concatenação
  const { rows } = await db.query<RestaurantRow>(
    `select * from restaurants
      where id = any($1::uuid[]) and deleted_at is null
      order by created_at, id
      limit $2 offset $3`,
    [ids, limit, offset],
  );

  // count(*) volta como string (bigint não cabe em number com segurança); aqui
  // o valor é uma contagem de linhas, então a conversão é segura.
  const { rows: countRows } = await db.query<{ total: string }>(
    `select count(*) as total from restaurants
      where id = any($1::uuid[]) and deleted_at is null`,
    [ids],
  );

  return { rows: rows.map(toRestaurant), total: Number(countRows[0].total) };
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
