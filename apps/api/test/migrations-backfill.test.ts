import { readdir, readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp, createOrder, createProduct, createRestaurant, type TestRestaurant } from "./helpers.ts";

/**
 * O backfill das migrations roda num banco COM pedidos — o banco de teste
 * migra vazio, então sem isto o backfill nunca rodaria sobre dado nenhum.
 *
 * Como: o `Down` e o `Up` da migration, dentro de uma transação desfeita no
 * fim (DDL é transacional no Postgres). O arquivo roda sozinho
 * (`fileParallelism: false`), então nenhum outro teste vê o schema no meio.
 */
async function migration(suffix: string): Promise<{ up: string; down: string }> {
  const dir = new URL("../migrations/", import.meta.url);
  const file = (await readdir(dir)).find((name) => name.endsWith(`_${suffix}.sql`));
  if (file === undefined) throw new Error(`migration ${suffix} não encontrada`);
  const text = await readFile(new URL(file, dir), "utf8");
  const [up, down] = text.split("-- Down Migration");
  return { up: up.replace("-- Up Migration", ""), down };
}

async function inRolledBackTransaction(work: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await work(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

describe("backfill das migrations de pedido", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function pedidos(r: TestRestaurant, quantos: number) {
    const p = await createProduct(app, r, { stock: 100 });
    const orders = [];
    for (let i = 0; i < quantos; i++) {
      orders.push(await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }]));
    }
    return orders;
  }

  it("add-order-number numera por loja, pela ordem de criação, e acerta o contador", async () => {
    const a = await createRestaurant(app);
    const b = await createRestaurant(app);
    const [a1, a2, a3] = await pedidos(a, 3);
    const [b1] = await pedidos(b, 1);
    const { up, down } = await migration("add-order-number");

    await inRolledBackTransaction(async (client) => {
      // o terceiro pedido passa a ser o MAIS ANTIGO: o backfill tem de seguir
      // `created_at`, não a ordem de inserção nem o número de hoje
      await client.query(`update orders set created_at = created_at - interval '1 day' where id = $1`, [a3.id]);
      await client.query(down);
      await client.query(up);

      const { rows } = await client.query<{ id: string; order_number: number }>(
        `select id, order_number from orders where id = any($1::uuid[])`,
        [[a1.id, a2.id, a3.id, b1.id]],
      );
      const byId = Object.fromEntries(rows.map((row) => [row.id, row.order_number]));
      expect([byId[a3.id], byId[a1.id], byId[a2.id], byId[b1.id]]).toEqual([1, 2, 3, 1]);

      const { rows: counters } = await client.query<{ id: string; last_order_number: number }>(
        `select id, last_order_number from restaurants where id = any($1::uuid[])`,
        [[a.id, b.id]],
      );
      const counterById = Object.fromEntries(counters.map((row) => [row.id, row.last_order_number]));
      expect([counterById[a.id], counterById[b.id]]).toEqual([3, 1]);
    });
  });

  it("add-order-status-events guarda só a chegada e o status atual, sem inventar etapas", async () => {
    const r = await createRestaurant(app);
    const [novo, emPreparo] = await pedidos(r, 2);
    for (const passo of ["confirm", "start-preparing"]) {
      await app.inject({
        method: "POST",
        url: `/restaurants/${r.id}/orders/${emPreparo.id}/${passo}`,
        headers: r.headers,
      });
    }
    const { up, down } = await migration("add-order-status-events");

    await inRolledBackTransaction(async (client) => {
      await client.query(down);
      await client.query(up);

      const { rows } = await client.query<{ order_id: string; status: string; bate: boolean }>(
        `select e.order_id, e.status,
                e.occurred_at = case when e.status = 'pending' then o.created_at else o.updated_at end as bate
           from order_status_events e join orders o on o.id = e.order_id
          where e.order_id = any($1::uuid[])
          order by e.occurred_at, e.status`,
        [[novo.id, emPreparo.id]],
      );
      const statuses = (id: string) => rows.filter((row) => row.order_id === id).map((row) => row.status);
      expect(statuses(novo.id)).toEqual(["pending"]);
      // `confirmed` aconteceu, mas o schema anterior não guardou quando: fica de fora
      expect(statuses(emPreparo.id)).toEqual(["pending", "preparing"]);
      expect(rows.every((row) => row.bate)).toBe(true);
    });
  });
});
