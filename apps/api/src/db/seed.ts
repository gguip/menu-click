import { readFile } from "node:fs/promises";
import { pool } from "./pool.ts";

/**
 * Popula o banco com os dados de exemplo do `seed.sql`.
 * Rode depois das migrations: `pnpm --filter @menuclick/api db:seed`.
 *
 * É idempotente (ids fixos + `on conflict do nothing`), então rodar de novo
 * não duplica nada. É script de linha de comando (fora do app Fastify), por
 * isso escreve em stdout em vez de usar o logger do Fastify.
 */
if (process.env.NODE_ENV === "production") {
  throw new Error("seed é só para ambiente de desenvolvimento");
}

const seed = await readFile(new URL("./seed.sql", import.meta.url), "utf8");

try {
  await pool.query(seed);

  const { rows } = await pool.query<{ restaurantes: string; produtos: string }>(
    `select
       (select count(*) from restaurants where deleted_at is null) as restaurantes,
       (select count(*) from products     where deleted_at is null) as produtos`,
  );

  const { restaurantes, produtos } = rows[0];
  console.log(
    `seed aplicado — banco com ${restaurantes} restaurante(s) e ${produtos} produto(s)`,
  );
} finally {
  await pool.end();
}
