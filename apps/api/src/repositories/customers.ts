import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { CreateCustomerInput, Customer } from "../domain/customer.ts";

/**
 * Repositório de clientes: **só acesso a dados**. Ver `restaurants.ts` para as
 * convenções (mapper snake_case → camelCase, soft delete, `Queryable`).
 */

/** Linha da tabela `customers`, em snake_case como vem do Postgres. */
export type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase usado fora daqui (D12). */
export function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Acha o cliente vivo com esse telefone ou cria um novo, numa query só.
 *
 * O `on conflict` mira o índice **parcial** `customers_phone_active_key` — daí
 * o `where deleted_at is null` repetido na cláusula: sem ele o Postgres não
 * sabe qual índice usar (`there is no unique or exclusion constraint matching`).
 * Como o índice só cobre vivos, um cliente removido com o mesmo telefone não
 * conflita: nasce uma linha nova, e a antiga continua parada no histórico.
 *
 * Fazer isso em uma query (em vez de `select` e depois `insert`) fecha a janela
 * em que dois pedidos simultâneos do mesmo telefone criariam dois clientes.
 *
 * O nome é sobrescrito a cada pedido: cliente aqui é contato, não conta — o
 * último nome informado é o mais atual.
 */
export async function upsertByPhone(
  input: CreateCustomerInput,
  db: Queryable = pool,
): Promise<Customer> {
  const { rows } = await db.query<CustomerRow>(
    `insert into customers (name, phone)
     values ($1, $2)
     on conflict (phone) where deleted_at is null
       do update set name = excluded.name, updated_at = now()
     returning *`,
    [input.name, input.phone],
  );
  return toCustomer(rows[0]);
}

/** Cliente vivo com esse id, ou `null`. */
export async function findById(
  id: string,
  db: Queryable = pool,
): Promise<Customer | null> {
  const { rows } = await db.query<CustomerRow>(
    "select * from customers where id = $1 and deleted_at is null",
    [id],
  );
  return rows.length === 0 ? null : toCustomer(rows[0]);
}
