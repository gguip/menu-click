import { Pool } from "pg";
import type { PoolClient } from "pg";

/**
 * Pool de conexões com o Postgres, compartilhado por toda a API.
 *
 * Configuração 100% por variável de ambiente: use `DATABASE_URL`
 * (`postgres://usuario:senha@host:porta/banco`) **ou** as variáveis `DB_*`
 * separadas — veja `.env.example`. Os scripts do pacote carregam o `.env` com
 * `node --env-file-if-exists=.env`, então não há dependência de dotenv.
 *
 * O pool conecta preguiçosamente: a primeira query é que abre a conexão.
 * Quem fecha é o hook `onClose` do Fastify (ver `server.ts`).
 */
const {
  DATABASE_URL,
  DB_HOST = "localhost",
  DB_PORT = "5432",
  DB_USER = "postgres",
  DB_PASSWORD = "postgres",
  DB_NAME = "menuclick",
  DB_POOL_MAX = "10",
} = process.env;

export const pool = new Pool({
  ...(DATABASE_URL
    ? { connectionString: DATABASE_URL }
    : {
        host: DB_HOST,
        port: Number(DB_PORT),
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
      }),
  // Máximo de conexões simultâneas mantidas por processo.
  max: Number(DB_POOL_MAX),
});

/**
 * Roda `fn` dentro de uma transação, com commit no fim e rollback se der erro.
 * Use quando duas ou mais escritas precisam valer juntas — por exemplo o soft
 * delete de um restaurante e o dos produtos dele.
 *
 * Todas as queries de dentro precisam usar o `client` recebido; se usar o
 * `pool` direto, a query sai por OUTRA conexão e fica fora da transação.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    // devolve a conexão pro pool (não fecha)
    client.release();
  }
}
