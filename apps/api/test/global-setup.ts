import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { runner } from "node-pg-migrate";
import { TEST_DB_NAME } from "./test-db.ts";

/**
 * Roda uma vez antes de toda a suíte (`globalSetup` do Vitest): garante que
 * o banco de teste existe e está com as migrations em dia.
 *
 * Conecta direto com `pg.Client` no banco de manutenção `postgres` — não dá
 * pra usar o `pool.ts` da app aqui, porque ele já abre conexão no banco de
 * teste (`DB_NAME=capstone_test`, injetado via `vitest.config.ts`), que é
 * justamente o banco que este arquivo pode precisar criar antes de existir.
 */
export default async function setup() {
  const {
    DB_HOST = "localhost",
    DB_PORT = "5432",
    DB_USER = "postgres",
    DB_PASSWORD = "postgres",
  } = process.env;

  const admin = new Client({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: "postgres",
  });
  await admin.connect();

  const { rowCount } = await admin.query(
    "select 1 from pg_database where datname = $1",
    [TEST_DB_NAME],
  );
  if (rowCount === 0) {
    // TEST_DB_NAME é constante deste repo, nunca input externo — identificador
    // não aceita `$n` (S3), por isso vai direto na string.
    await admin.query(`create database ${TEST_DB_NAME}`);
  }
  await admin.end();

  await runner({
    databaseUrl: {
      host: DB_HOST,
      port: Number(DB_PORT),
      user: DB_USER,
      password: DB_PASSWORD,
      database: TEST_DB_NAME,
    },
    dir: fileURLToPath(new URL("../migrations", import.meta.url)),
    direction: "up",
    count: Infinity,
    migrationsTable: "pgmigrations",
    verbose: false,
  });
}
