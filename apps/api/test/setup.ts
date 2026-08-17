import { afterEach } from "vitest";
import { pool } from "../src/db/pool.ts";

/**
 * Limpeza entre testes: zera as tabelas depois de cada teste, então nenhum
 * teste depende (nem é afetado por) dado deixado pelo anterior. `cascade`
 * cobre a FK de `products` em `restaurants` independente da ordem da lista.
 */
afterEach(async () => {
  await pool.query(
    "truncate table products, restaurants restart identity cascade",
  );
});
