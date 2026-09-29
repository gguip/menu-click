import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";

/**
 * O `seed.sql` roda contra o schema atual, e duas vezes seguidas (é
 * idempotente). Nem o CI nem outro teste rodavam o seed: a coluna
 * `orders.order_number`, `not null`, quebrou-o sem ninguém ver.
 */
describe("seed de exemplo", () => {
  it("aplica duas vezes, com número de pedido e contador coerentes", async () => {
    const seed = await readFile(new URL("../src/db/seed.sql", import.meta.url), "utf8");
    // S6: SQL multi-statement só a partir de arquivo versionado
    await pool.query(seed);
    await pool.query(seed);

    const { rows: incoerentes } = await pool.query(
      `select r.slug
         from restaurants r
         join orders o on o.restaurant_id = r.id
        group by r.id, r.slug, r.last_order_number
       having r.last_order_number < max(o.order_number)`,
    );
    expect(incoerentes).toEqual([]);

    const { rows: semHistorico } = await pool.query(
      `select o.id from orders o
        where not exists (select 1 from order_status_events e where e.order_id = o.id)`,
    );
    expect(semHistorico).toEqual([]);
  });
});
