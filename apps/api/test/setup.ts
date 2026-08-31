import { afterEach } from "vitest";
import { pool } from "../src/db/pool.ts";

/**
 * Limpeza entre testes: zera as tabelas depois de cada teste, então nenhum
 * teste depende (nem é afetado por) dado deixado pelo anterior.
 *
 * As tabelas são listadas explicitamente — `cascade` sozinho no `restaurants`
 * limparia `orders` por tabela, mas deixaria `customers` de pé, e o índice
 * único parcial do telefone faria o próximo teste reaproveitar um cliente do
 * teste anterior.
 */
afterEach(async () => {
  await pool.query(
    `truncate table order_items, orders, customers,
                    sessions, restaurant_users,
                    products, restaurants
       restart identity cascade`,
  );
});
