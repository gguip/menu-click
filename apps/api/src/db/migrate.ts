import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { connectionConfig } from "./pool.ts";

/**
 * Roda as migrations de `apps/api/migrations` (arquivos `.sql` com as seções
 * `-- Up Migration` e `-- Down Migration`).
 *
 *   pnpm --filter @menuclick/api migrate:up      # aplica tudo que falta
 *   pnpm --filter @menuclick/api migrate:down    # desfaz a última
 *
 * Existe em vez de chamar o CLI direto por um motivo: o `node-pg-migrate`
 * espera a conexão em `DATABASE_URL`, e aqui a config vem do mesmo lugar que a
 * da API (`pool.ts`), que também aceita as variáveis `DB_*`. Assim não dá pra
 * migrar um banco e servir outro.
 *
 * É script de linha de comando (fora do app Fastify), por isso escreve em
 * stdout em vez de usar o logger do Fastify.
 */
const direction = process.argv[2] === "down" ? "down" : "up";

// `down` desfaz só a última migration; `up` aplica todas as pendentes.
const count = direction === "down" ? 1 : Infinity;

const migrated = await runner({
  databaseUrl: connectionConfig,
  dir: fileURLToPath(new URL("../../migrations", import.meta.url)),
  direction,
  count,
  migrationsTable: "pgmigrations",
  verbose: false,
});

if (migrated.length === 0) {
  console.log(
    direction === "up"
      ? "nenhuma migration pendente"
      : "nenhuma migration para desfazer",
  );
} else {
  const verbo = direction === "up" ? "aplicada" : "desfeita";
  for (const migration of migrated) {
    console.log(`${verbo}: ${migration.name}`);
  }
}
