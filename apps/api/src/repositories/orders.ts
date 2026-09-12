import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { PoolClient } from "pg";
import type { CustomerRow } from "./customers.ts";
import { toCustomer } from "./customers.ts";
import type { Pagination } from "../domain/pagination.ts";
import type { OrderPeriod, PeriodFilter } from "../domain/period.ts";
import type { OrderSortField, SortDirection } from "../domain/order.ts";
import type {
  Order,
  OrderItem,
  OrderItemOption,
  OrderStatus,
  OrderSummary,
  OrderType,
} from "../domain/order.ts";
import type { Address } from "../domain/restaurant.ts";
import type { PaymentMethod } from "../domain/payment.ts";

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
  /** `null` fora de `delivery`, e também em `delivery` "a combinar". */
  delivery_fee_in_cents: number | null;
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  payment_method: PaymentMethod;
  change_for_in_cents: number | null;
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
  /** Preço de uma unidade já com as opções escolhidas (ver `add-option-groups`). */
  unit_price_in_cents: number;
  quantity: number;
};

/** Linha da tabela `order_item_options` — o congelamento de uma escolha. */
type OrderItemOptionRow = {
  id: string;
  order_item_id: string;
  option_id: string;
  group_name: string;
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
    // presente e `null` (não ausente) fora de delivery e no "a combinar" —
    // diferente de `changeForInCents` logo abaixo, cuja ausência É a
    // informação. Aqui `null` já é a informação: "sem frete a mostrar".
    deliveryFeeInCents: row.delivery_fee_in_cents,
    deliveryAddress: toAddress(row),
    paymentMethod: row.payment_method,
    // ausente, não `null`: no dinheiro sem troco significa "tenho o valor
    // certo", e o `fast-json-stringify` só omite o campo se ele faltar aqui
    ...(row.change_for_in_cents === null
      ? {}
      : { changeForInCents: row.change_for_in_cents }),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toOrderItem(row: OrderItemRow, options: OrderItemOption[]): OrderItem {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    priceInCents: row.price_in_cents,
    unitPriceInCents: row.unit_price_in_cents,
    quantity: row.quantity,
    options,
  };
}

/** Converte a linha de `order_item_options` no formato camelCase (D12). */
function toOrderItemOption(row: OrderItemOptionRow): OrderItemOption {
  return {
    optionId: row.option_id,
    groupName: row.group_name,
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
  /** O frete já decidido pelo serviço. `null` fora de `delivery` e no "a combinar". */
  deliveryFeeInCents: number | null;
  deliveryAddress?: Address;
  /** Hash do token de acompanhamento. `null` em `dine_in`. */
  trackingTokenHash: string | null;
  paymentMethod: PaymentMethod;
  changeForInCents?: number;
};

/** Uma linha de `order_items` pronta para gravar, com os valores congelados. */
export type InsertOrderItemData = {
  productId: string;
  name: string;
  priceInCents: number;
  /** Preço de uma unidade já com as opções escolhidas — ver `domain/option.ts`. */
  unitPriceInCents: number;
  quantity: number;
};

/** Uma linha de `order_item_options` pronta para gravar, já com o item dono. */
export type InsertOrderItemOptionData = {
  orderItemId: string;
  optionId: string;
  groupName: string;
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
       (restaurant_id, customer_id, type, total_in_cents, delivery_fee_in_cents,
        tracking_token_hash, street, number, neighborhood, city, state, zip_code,
        payment_method, change_for_in_cents)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     returning id`,
    [
      restaurantId,
      data.customerId,
      data.type,
      data.totalInCents,
      // o check `orders_delivery_fee_check` garante a coerência com `type`:
      // só delivery pode ter valor não-nulo aqui
      data.deliveryFeeInCents,
      data.trackingTokenHash,
      // o check do banco garante a coerência com `type`: as seis colunas vêm
      // preenchidas em delivery e NULL nas outras duas modalidades
      address?.street ?? null,
      address?.number ?? null,
      address?.neighborhood ?? null,
      address?.city ?? null,
      address?.state ?? null,
      address?.zipCode ?? null,
      data.paymentMethod,
      data.changeForInCents ?? null,
    ],
  );
  return rows[0].id;
}

/**
 * Grava todos os itens do pedido numa query só, e devolve os ids gerados — é
 * por esse id que cada opção escolhida (gravada a seguir, por
 * `insertItemOptions`) sabe a qual item pertence.
 *
 * ⚠️ **Pressuposto que sustenta isso: a linha N do `RETURNING` corresponde à
 * tupla N do `VALUES`.** Não é coincidência nem sorte de plano de execução —
 * um único `INSERT ... VALUES ... RETURNING` não paraleliza nem reordena o
 * `VALUES`, e o Postgres emite as linhas na ordem literal em que foram
 * escritas. O que quebraria isso não é reordenar, é **omitir** uma linha:
 * `ON CONFLICT DO NOTHING` ou um trigger `BEFORE INSERT` que devolva `NULL`
 * nesta tabela fariam o `RETURNING` sair mais curto que `items`, deslocando
 * todo índice seguinte — e a opção paga por um item seria gravada como se
 * fosse de outro (ver o guard em `services/orders.ts`, logo depois da
 * chamada). Nenhum dos dois existe hoje em `order_items`. Se um dia existir,
 * este mapeamento por posição para de valer e vira `order_items.position`
 * (fora do escopo desta tarefa).
 */
export async function insertItems(
  orderId: string,
  items: InsertOrderItemData[],
  db: Queryable = pool,
): Promise<string[]> {
  const values: unknown[] = [];
  const tuples: string[] = [];

  for (const item of items) {
    values.push(
      orderId,
      item.productId,
      item.name,
      item.priceInCents,
      item.unitPriceInCents,
      item.quantity,
    );
    // os `$n` são gerados a partir do TAMANHO do array, não de nada que veio do
    // cliente — o conteúdo continua indo 100% por parâmetro (S2/S8).
    const n = values.length;
    tuples.push(
      `($${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`,
    );
  }

  const { rows } = await db.query<{ id: string }>(
    `insert into order_items
       (order_id, product_id, name, price_in_cents, unit_price_in_cents, quantity)
     values ${tuples.join(", ")}
     returning id`,
    values,
  );
  return rows.map((row) => row.id);
}

/**
 * Grava as opções escolhidas de vários itens numa query só — mesmo padrão de
 * tuplas de `insertItems`. Chamada uma vez para o pedido inteiro, nunca uma
 * vez por item.
 */
export async function insertItemOptions(
  rows: InsertOrderItemOptionData[],
  db: Queryable = pool,
): Promise<void> {
  if (rows.length === 0) return;

  const values: unknown[] = [];
  const tuples: string[] = [];

  for (const row of rows) {
    values.push(
      row.orderItemId,
      row.optionId,
      row.groupName,
      row.name,
      row.priceInCents,
      row.quantity,
    );
    const n = values.length;
    tuples.push(
      `($${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`,
    );
  }

  await db.query(
    `insert into order_item_options
       (order_item_id, option_id, group_name, name, price_in_cents, quantity)
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

/**
 * As opções congeladas de vários itens, agrupadas por item — **uma** query
 * para o pedido inteiro, nunca uma por item (mesmo padrão de
 * `findGroupsByProductIds`).
 */
async function findItemOptions(
  orderItemIds: string[],
  db: Queryable = pool,
): Promise<Map<string, OrderItemOption[]>> {
  const porItem = new Map<string, OrderItemOption[]>();
  if (orderItemIds.length === 0) return porItem;

  const { rows } = await db.query<OrderItemOptionRow>(
    `select * from order_item_options
      where order_item_id = any($1::uuid[]) and deleted_at is null
      order by created_at, id`,
    [orderItemIds],
  );

  for (const row of rows) {
    const lista = porItem.get(row.order_item_id) ?? [];
    lista.push(toOrderItemOption(row));
    porItem.set(row.order_item_id, lista);
  }
  return porItem;
}

/** Itens vivos do pedido, em ordem de criação (D11), com as opções de cada um. */
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

  const optionsByItem = await findItemOptions(
    rows.map((row) => row.id),
    db,
  );
  return rows.map((row) => toOrderItem(row, optionsByItem.get(row.id) ?? []));
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
 * Os dois limites do período, como **expressões SQL** já prontas, e os valores
 * empurrados em `values`.
 *
 * Devolver as expressões (em vez das condições montadas) é o que permite o
 * mesmo cálculo servir a dois usos: o `where` da listagem e o `select` que o
 * resumo usa para dizer quais instantes ele considerou. Uma segunda conta em
 * JavaScript discordaria desta nos dias de virada de horário de verão.
 *
 * O que se concatena aqui são strings fixas deste arquivo; data e fuso vão como
 * parâmetro (S2).
 */
function periodBounds(
  filter: PeriodFilter,
  timezone: string,
  values: unknown[],
): { from?: string; to?: string } {
  values.push(timezone);
  const tz = `$${values.length}`;
  const emFuso = (expressao: string) =>
    `(${expressao.split("%TZ%").join(tz)}) at time zone ${tz}`;

  if (filter.kind === "named") {
    const fim = PERIOD_END[filter.name];
    return {
      from: emFuso(PERIOD_START[filter.name]),
      ...(fim === undefined ? {} : { to: emFuso(fim) }),
    };
  }

  const bounds: { from?: string; to?: string } = {};
  if (filter.from !== undefined) {
    values.push(filter.from);
    bounds.from = emFuso(`($${values.length}::date)::timestamp`);
  }
  if (filter.to !== undefined) {
    values.push(filter.to);
    // `+ 1` porque o intervalo é fechado: o dia do `to` entra inteiro, e o
    // corte fica na meia-noite seguinte
    bounds.to = emFuso(`($${values.length}::date + 1)::timestamp`);
  }
  return bounds;
}

/** As condições de `where` do período, para a coluna informada. */
function periodConditions(
  filter: PeriodFilter | undefined,
  timezone: string,
  coluna: string,
  values: unknown[],
): string[] {
  if (filter === undefined) return [];

  const { from, to } = periodBounds(filter, timezone, values);
  const conditions: string[] = [];
  if (from !== undefined) conditions.push(`${coluna} >= ${from}`);
  if (to !== undefined) conditions.push(`${coluna} < ${to}`);
  return conditions;
}

/** Os filtros da listagem de pedidos, além da paginação. */
export type OrderFilters = {
  status?: OrderStatus;
  period?: PeriodFilter;
};

/**
 * Campo pedido pelo cliente → coluna real. O mapa é a fronteira: o que não
 * está aqui não existe, e o texto da querystring nunca vira SQL (S3).
 */
const ORDER_SORT_COLUMNS: Record<OrderSortField, string> = {
  createdAt: "created_at",
  totalInCents: "total_in_cents",
};

/** Como a listagem é ordenada. */
export type OrderSort = { field: OrderSortField; direction: SortDirection };

/**
 * O `order by` da listagem, montado só a partir de constantes deste arquivo.
 *
 * A direção sai de um ternário, não do input: mesmo com o valor já validado
 * pelo `enum` do schema, interpolar a string recebida deixaria a proteção
 * dependendo de um schema que alguém pode afrouxar depois.
 *
 * O `id` desempata **na mesma direção** do campo pedido. Dois pedidos com o
 * mesmo total não têm ordem definida sem ele, e aí eles poderiam trocar de
 * lugar entre uma página e a seguinte — um apareceria duas vezes e o outro
 * sumiria.
 *
 * Como o `order by id` do lock de estoque, isto é proteção contra um plano de
 * execução futuro, **não** contra um bug observável hoje: com a tabela pequena
 * o Postgres devolve as linhas empatadas sempre na mesma ordem, e nenhum teste
 * falha se esta parte sair (verificado). O que garante é o `order by`, não a
 * sorte do plano.
 */
function orderByClause(sort: OrderSort, prefixo: string): string {
  const coluna = ORDER_SORT_COLUMNS[sort.field];
  const direcao = sort.direction === "desc" ? "desc" : "asc";
  return `order by ${prefixo}${coluna} ${direcao}, ${prefixo}id ${direcao}`;
}

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
  sort: OrderSort,
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
      ${orderByClause(sort, "o.")}
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

/** Uma linha do agrupamento por status: quantos, e quanto somam. */
export type StatusTally = {
  status: OrderStatus;
  count: number;
  totalInCents: number;
};

/**
 * Agrupa os pedidos vivos do período **por status**, com a contagem e a soma.
 *
 * Devolve o cru e nada mais: quais status contam como faturamento é regra de
 * negócio e mora no domínio (`REVENUE_STATUSES`), não neste SQL. Se estivesse
 * aqui, mudar a regra viraria mudar uma query — e a regra sumiria de onde
 * alguém a procura.
 */
export async function tallyByStatus(
  restaurantId: string,
  period: PeriodFilter | undefined,
  timezone: string,
  db: Queryable = pool,
): Promise<StatusTally[]> {
  const values: unknown[] = [restaurantId];
  const conditions = [
    "restaurant_id = $1",
    "deleted_at is null",
    ...periodConditions(period, timezone, "created_at", values),
  ];

  const { rows } = await db.query<{
    status: OrderStatus;
    count: string;
    total: string;
  }>(
    `select status, count(*) as count, coalesce(sum(total_in_cents), 0) as total
       from orders
      where ${conditions.join(" and ")}
      group by status`,
    values,
  );

  return rows.map((row) => ({
    status: row.status,
    count: Number(row.count),
    totalInCents: Number(row.total),
  }));
}

/**
 * Os instantes em que o período pedido realmente começa e termina.
 *
 * Existe para o resumo poder devolvê-los: sem isso, "por que o faturamento de
 * hoje está zerado?" não tem como ser respondido sem abrir o banco. `null` de
 * um lado é intervalo aberto daquele lado.
 *
 * Usa as mesmas expressões do filtro — é o mesmo cálculo, no mesmo lugar.
 */
export async function selectPeriodBounds(
  period: PeriodFilter | undefined,
  timezone: string,
  db: Queryable = pool,
): Promise<{ from: Date | null; to: Date | null }> {
  if (period === undefined) return { from: null, to: null };

  const values: unknown[] = [];
  const { from, to } = periodBounds(period, timezone, values);

  const { rows } = await db.query<{ from: Date | null; to: Date | null }>(
    `select ${from ?? "null::timestamptz"} as from,
            ${to ?? "null::timestamptz"} as to`,
    values,
  );
  return rows[0];
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
