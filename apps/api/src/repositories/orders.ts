import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { PoolClient } from "pg";
import type { CustomerRow } from "./customers.ts";
import { toCustomer } from "./customers.ts";
import type { Pagination } from "../domain/pagination.ts";
import type { OrderPeriod, PeriodFilter } from "../domain/period.ts";
import type {
  Order,
  OrderItem,
  OrderStatus,
  OrderSummary,
  OrderType,
} from "../domain/order.ts";
import type { Address } from "../domain/restaurant.ts";

/**
 * Repositório de pedidos: **só acesso a dados**. Ver `restaurants.ts` para as
 * convenções gerais.
 *
 * Uma peculiaridade desta tabela: o pedido guarda cópias congeladas (nome e
 * preço do produto, endereço de entrega) em vez de ler tudo por FK. Isso é
 * decisão de modelagem, documentada na migration `add-orders` — aqui o efeito
 * prático é que nenhuma consulta de leitura junta `products`.
 */

/** Linha da tabela `orders`, em snake_case como vem do Postgres. */
type OrderRow = {
  id: string;
  restaurant_id: string;
  customer_id: string;
  type: OrderType;
  status: OrderStatus;
  total_in_cents: number;
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  created_at: Date;
  updated_at: Date;
};

/** `orders` mais as colunas do cliente, com prefixo para não colidir. */
type OrderWithCustomerRow = OrderRow & {
  customer_name: string;
  customer_phone: string;
  customer_created_at: Date;
  customer_updated_at: Date;
};

/** Linha da tabela `order_items`. */
type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string;
  name: string;
  price_in_cents: number;
  quantity: number;
};

/**
 * O cliente entra na consulta por join, mas **sem** filtrar `deleted_at` — a
 * única leitura do projeto que não aplica D2, e de propósito.
 *
 * Pedido é histórico: remover um cliente impede pedidos NOVOS (o serviço checa
 * o cliente vivo na criação), mas não pode fazer os antigos sumirem da
 * listagem do restaurante. Filtrar aqui apagaria o passado junto com o
 * cadastro.
 */
const selectOrderWithCustomer = `
  select o.*,
         c.name       as customer_name,
         c.phone      as customer_phone,
         c.created_at as customer_created_at,
         c.updated_at as customer_updated_at
    from orders o
    join customers c on c.id = o.customer_id`;

function toAddress(row: OrderRow): Address | null {
  // o check `orders_address_check` garante tudo-ou-nada; testar uma coluna basta
  if (row.street === null) return null;
  return {
    street: row.street,
    number: row.number as string,
    neighborhood: row.neighborhood as string,
    city: row.city as string,
    state: row.state as string,
    zipCode: row.zip_code as string,
  };
}

/** Converte a linha (pedido + cliente) no formato camelCase (D12). */
function toOrderSummary(row: OrderWithCustomerRow): OrderSummary {
  const customerRow: CustomerRow = {
    id: row.customer_id,
    name: row.customer_name,
    phone: row.customer_phone,
    created_at: row.customer_created_at,
    updated_at: row.customer_updated_at,
  };

  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    customer: toCustomer(customerRow),
    type: row.type,
    status: row.status,
    totalInCents: row.total_in_cents,
    deliveryAddress: toAddress(row),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    priceInCents: row.price_in_cents,
    quantity: row.quantity,
  };
}

/** O que o serviço já resolveu antes de gravar o pedido. */
export type InsertOrderData = {
  customerId: string;
  type: OrderType;
  totalInCents: number;
  deliveryAddress?: Address;
  /** Hash do token de acompanhamento. `null` em `dine_in`. */
  trackingTokenHash: string | null;
};

/** Uma linha de `order_items` pronta para gravar, com os valores congelados. */
export type InsertOrderItemData = {
  productId: string;
  name: string;
  priceInCents: number;
  quantity: number;
};

/**
 * Grava o pedido (sem os itens) e devolve o id.
 *
 * Só o id porque o pedido completo é montado por `findById` depois — inclusive
 * o cliente, que aqui não está carregado.
 */
export async function insertOrder(
  restaurantId: string,
  data: InsertOrderData,
  db: Queryable = pool,
): Promise<string> {
  const address = data.deliveryAddress;
  const { rows } = await db.query<{ id: string }>(
    `insert into orders
       (restaurant_id, customer_id, type, total_in_cents, tracking_token_hash,
        street, number, neighborhood, city, state, zip_code)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      restaurantId,
      data.customerId,
      data.type,
      data.totalInCents,
      data.trackingTokenHash,
      // o check do banco garante a coerência com `type`: as seis colunas vêm
      // preenchidas em delivery e NULL nas outras duas modalidades
      address?.street ?? null,
      address?.number ?? null,
      address?.neighborhood ?? null,
      address?.city ?? null,
      address?.state ?? null,
      address?.zipCode ?? null,
    ],
  );
  return rows[0].id;
}

/** Grava todos os itens do pedido numa query só. */
export async function insertItems(
  orderId: string,
  items: InsertOrderItemData[],
  db: Queryable = pool,
): Promise<void> {
  const values: unknown[] = [];
  const tuples: string[] = [];

  for (const item of items) {
    values.push(
      orderId,
      item.productId,
      item.name,
      item.priceInCents,
      item.quantity,
    );
    // os `$n` são gerados a partir do TAMANHO do array, não de nada que veio do
    // cliente — o conteúdo continua indo 100% por parâmetro (S2/S8).
    const n = values.length;
    tuples.push(`($${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
  }

  await db.query(
    `insert into order_items (order_id, product_id, name, price_in_cents, quantity)
     values ${tuples.join(", ")}`,
    values,
  );
}

/** Pedido vivo do restaurante, com os itens. `null` se não existe. */
export async function findById(
  restaurantId: string,
  orderId: string,
  db: Queryable = pool,
): Promise<Order | null> {
  const { rows } = await db.query<OrderWithCustomerRow>(
    `${selectOrderWithCustomer}
      where o.id = $1 and o.restaurant_id = $2 and o.deleted_at is null`,
    [orderId, restaurantId],
  );
  if (rows.length === 0) return null;

  return {
    ...toOrderSummary(rows[0]),
    items: await findItems(orderId, db),
  };
}

/** Itens vivos do pedido, em ordem de criação (D11). */
export async function findItems(
  orderId: string,
  db: Queryable = pool,
): Promise<OrderItem[]> {
  const { rows } = await db.query<OrderItemRow>(
    `select * from order_items
      where order_id = $1 and deleted_at is null
      order by created_at, id`,
    [orderId],
  );
  return rows.map(toOrderItem);
}

/**
 * Status e modalidade do pedido, com a linha **travada** até o fim da transação.
 *
 * É o que serializa duas transições simultâneas do mesmo pedido: a segunda fica
 * bloqueada nesta leitura até a primeira commitar, e aí enxerga o estado novo.
 * Sem o lock, as duas leriam `pending` e as duas debitariam estoque.
 *
 * A modalidade vem junto porque é ela que decide quais transições são legais —
 * buscá-la numa segunda query seria ler fora do lock.
 */
export async function selectForUpdate(
  restaurantId: string,
  orderId: string,
  client: PoolClient,
): Promise<{ status: OrderStatus; type: OrderType } | null> {
  const { rows } = await client.query<{ status: OrderStatus; type: OrderType }>(
    `select status, type from orders
      where id = $1 and restaurant_id = $2 and deleted_at is null
      for update`,
    [orderId, restaurantId],
  );
  return rows.length === 0 ? null : rows[0];
}

/** Grava a transição de status. Quem valida a transição é o serviço. */
export async function updateStatus(
  orderId: string,
  status: OrderStatus,
  client: PoolClient,
): Promise<void> {
  await client.query(
    `update orders set status = $1, updated_at = now()
      where id = $2 and deleted_at is null`,
    [status, orderId],
  );
}

/**
 * O começo de cada período nomeado, como expressão SQL.
 *
 * As contas são feitas **no Postgres**, não no Node, e por um motivo concreto:
 * "meia-noite de hoje em America/Sao_Paulo" depende do banco de fusos (horário
 * de verão inclusive), e o Postgres já o consulta no `at time zone`. Refazer
 * isso em JavaScript seria manter uma segunda implementação da mesma regra,
 * que discordaria da primeira exatamente nos dias de virada.
 *
 * Cada expressão devolve um `timestamp` **local** (sem fuso); quem a usa a
 * converte de volta para `timestamptz` com `at time zone`. `%TZ%` é
 * substituído pelo número do parâmetro que carrega o fuso — o fuso é VALOR,
 * então vai como `$n` (S1), nunca interpolado.
 */
const PERIOD_START: Record<OrderPeriod, string> = {
  today: "date_trunc('day', now() at time zone %TZ%)",
  yesterday: "date_trunc('day', now() at time zone %TZ%) - interval '1 day'",
  // 7 dias contando hoje — "últimos 7 dias" incluindo o dia em curso
  last7days: "date_trunc('day', now() at time zone %TZ%) - interval '6 days'",
  thisMonth: "date_trunc('month', now() at time zone %TZ%)",
};

/** O fim, quando o período tem um. Os demais vão até agora. */
const PERIOD_END: Partial<Record<OrderPeriod, string>> = {
  yesterday: "date_trunc('day', now() at time zone %TZ%)",
};

/**
 * Monta as condições de período e empurra os valores em `values`.
 *
 * Devolve os pedaços de `where` já prontos. O que se concatena aqui são
 * strings fixas escritas neste arquivo; data e fuso vão como parâmetro (S2).
 */
function periodConditions(
  filter: PeriodFilter | undefined,
  timezone: string,
  coluna: string,
  values: unknown[],
): string[] {
  if (filter === undefined) return [];

  values.push(timezone);
  const tz = `$${values.length}`;
  const emFuso = (expressao: string) =>
    `(${expressao.split("%TZ%").join(tz)}) at time zone ${tz}`;

  if (filter.kind === "named") {
    const conditions = [`${coluna} >= ${emFuso(PERIOD_START[filter.name])}`];
    const fim = PERIOD_END[filter.name];
    if (fim !== undefined) conditions.push(`${coluna} < ${emFuso(fim)}`);
    return conditions;
  }

  const conditions: string[] = [];
  if (filter.from !== undefined) {
    values.push(filter.from);
    conditions.push(`${coluna} >= ${emFuso(`($${values.length}::date)::timestamp`)}`);
  }
  if (filter.to !== undefined) {
    values.push(filter.to);
    // `+ 1` porque o intervalo é fechado: o dia do `to` entra inteiro, e o
    // corte fica na meia-noite seguinte
    conditions.push(
      `${coluna} < ${emFuso(`($${values.length}::date + 1)::timestamp`)}`,
    );
  }
  return conditions;
}

/** Os filtros da listagem de pedidos, além da paginação. */
export type OrderFilters = {
  status?: OrderStatus;
  period?: PeriodFilter;
};

/**
 * Uma página de pedidos vivos do restaurante, mais o total — já considerando
 * os filtros, que valem também para o `total`: filtrar e continuar reportando
 * o total do restaurante inteiro faria a paginação mentir.
 *
 * Duas queries, pelo mesmo motivo de `restaurants.findAll`: `count(*) over ()`
 * devolveria zero linhas numa página vazia.
 */
export async function findByRestaurant(
  restaurantId: string,
  { limit, offset }: Pagination,
  filters: OrderFilters,
  timezone: string,
  db: Queryable = pool,
): Promise<{ rows: OrderSummary[]; total: number }> {
  /** Monta as condições para um prefixo de coluna (a listagem usa alias, o count não). */
  const condicoes = (prefixo: string, values: unknown[]) => {
    const lista = [`${prefixo}restaurant_id = $1`, `${prefixo}deleted_at is null`];
    if (filters.status !== undefined) {
      values.push(filters.status);
      lista.push(`${prefixo}status = $${values.length}`);
    }
    lista.push(
      ...periodConditions(filters.period, timezone, `${prefixo}created_at`, values),
    );
    return lista.join(" and ");
  };

  const values: unknown[] = [restaurantId];
  const where = condicoes("o.", values);

  const { rows } = await db.query<OrderWithCustomerRow>(
    `${selectOrderWithCustomer}
      where ${where}
      order by o.created_at, o.id
      limit $${values.length + 1} offset $${values.length + 2}`,
    [...values, limit, offset],
  );

  const countValues: unknown[] = [restaurantId];
  const { rows: countRows } = await db.query<{ total: string }>(
    `select count(*) as total from orders where ${condicoes("", countValues)}`,
    countValues,
  );

  return { rows: rows.map(toOrderSummary), total: Number(countRows[0].total) };
}

/**
 * Resolve o hash de um token de acompanhamento no pedido correspondente.
 *
 * É a consulta do handshake do WebSocket. Devolve o restaurante junto porque o
 * `findById` é escopado por ele — e o cliente que está acompanhando não sabe
 * (nem precisa saber) em qual restaurante pediu.
 */
export async function findByTrackingTokenHash(
  tokenHash: string,
  db: Queryable = pool,
): Promise<{ id: string; restaurantId: string } | null> {
  const { rows } = await db.query<{ id: string; restaurant_id: string }>(
    `select id, restaurant_id from orders
      where tracking_token_hash = $1 and deleted_at is null`,
    [tokenHash],
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id, restaurantId: rows[0].restaurant_id };
}
