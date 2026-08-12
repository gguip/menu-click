import { readFile } from "node:fs/promises";
import { pool } from "./pool.ts";

/**
 * Aplica o `schema.sql` no banco configurado pelas variáveis de ambiente.
 * Rode uma vez antes de subir a API: `pnpm --filter @menuclick/api db:setup`.
 *
 * É um script de linha de comando (não faz parte do app Fastify), por isso
 * escreve em stdout em vez de usar o logger do Fastify.
 */

/**
 * Colunas que o código espera encontrar. `create table if not exists` não
 * altera tabela existente: se o banco já tiver um `restaurants` de outro
 * formato, o schema.sql passa batido e o erro só aparece na primeira query.
 * Por isso conferimos aqui e falhamos alto.
 */
const expectedColumns = {
  restaurants: [
    "id",
    "name",
    "cuisine_type",
    "logo_url",
    "street",
    "number",
    "neighborhood",
    "city",
    "state",
    "zip_code",
    "is_delivery",
    "is_qrcode",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  products: [
    "id",
    "restaurant_id",
    "name",
    "category",
    "price_in_cents",
    "description",
    "photo_url",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
};

const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");

try {
  await pool.query(schema);

  const problems: string[] = [];

  for (const [table, columns] of Object.entries(expectedColumns)) {
    const { rows } = await pool.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public' and table_name = $1`,
      [table],
    );

    if (rows.length === 0) {
      problems.push(`tabela "${table}" não existe`);
      continue;
    }

    const found = new Set(rows.map((row) => row.column_name));
    const missing = columns.filter((column) => !found.has(column));
    if (missing.length > 0) {
      problems.push(`tabela "${table}" sem as colunas: ${missing.join(", ")}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `o banco não bate com o schema esperado:\n  - ${problems.join("\n  - ")}\n` +
        "Uma tabela com esse nome já existia em outro formato? " +
        "Ajuste com ALTER TABLE (ou aponte para outro banco) e rode de novo.",
    );
  }

  console.log("schema aplicado e conferido com sucesso");
} finally {
  await pool.end();
}
