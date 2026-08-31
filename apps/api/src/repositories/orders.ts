import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { PoolClient } from "pg";
import type { CustomerRow } from "./customers.ts";
import { toCustomer } from "./customers.ts";
import type { Pagination } from "../domain/pagination.ts";
import type {
  Order,
  OrderItem,
  OrderStatus,
  OrderSummary,
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
  totalInCents: number;
  deliveryAddress?: Address;
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
       (restaurant_id, customer_id, total_in_cents,
        street, number, neighborhood, city, state, zip_code)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      restaurantId,
      data.customerId,
      data.totalInCents,
      // endereço é tudo-ou-nada: sem entrega, as seis colunas vão NULL
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
 * Status do pedido com a linha **travada** até o fim da transação.
 *
 * É o que serializa duas confirmações simultâneas do mesmo pedido: a segunda
 * fica bloqueada nesta leitura até a primeira commitar, e aí enxerga
 * `confirmed` em vez de `pending`. Sem o lock, as duas leriam `pending` e as
 * duas debitariam estoque.
 */
export async function selectStatusForUpdate(
  restaurantId: string,
  orderId: string,
  client: PoolClient,
): Promise<OrderStatus | null> {
  const { rows } = await client.query<{ status: OrderStatus }>(
    `select status from orders
      where id = $1 and restaurant_id = $2 and deleted_at is null
      for update`,
    [orderId, restaurantId],
  );
  return rows.length === 0 ? null : rows[0].status;
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
 * Uma página de pedidos vivos do restaurante, mais o total.
 *
 * `status` é filtro opcional. Ele entra como parâmetro `$n` comparado a uma
 * coluna — não é identificador dinâmico — e o valor já veio validado contra o
 * `enum` do JSON Schema na rota.
 *
 * Duas queries, pelo mesmo motivo de `restaurants.findAll`: `count(*) over ()`
 * devolveria zero linhas numa página vazia.
 */
export async function findByRestaurant(
  restaurantId: string,
  { limit, offset }: Pagination,
  status: OrderStatus | undefined,
  db: Queryable = pool,
): Promise<{ rows: OrderSummary[]; total: number }> {
  const filter = status === undefined ? "" : " and o.status = $4";
  const params: unknown[] = [restaurantId, limit, offset];
  if (status !== undefined) params.push(status);

  const { rows } = await db.query<OrderWithCustomerRow>(
    `${selectOrderWithCustomer}
      where o.restaurant_id = $1 and o.deleted_at is null${filter}
      order by o.created_at, o.id
      limit $2 offset $3`,
    params,
  );

  const countParams: unknown[] = [restaurantId];
  if (status !== undefined) countParams.push(status);
  const { rows: countRows } = await db.query<{ total: string }>(
    `select count(*) as total from orders
      where restaurant_id = $1 and deleted_at is null${
        status === undefined ? "" : " and status = $2"
      }`,
    countParams,
  );

  return { rows: rows.map(toOrderSummary), total: Number(countRows[0].total) };
}
