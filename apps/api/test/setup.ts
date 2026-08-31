import { afterEach, beforeEach } from "vitest";
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

/**
 * Um IP diferente por teste.
 *
 * O `app.inject()` sempre vem de 127.0.0.1, então a suíte inteira contaria como
 * UM cliente e estouraria o rate limit por IP — 127 testes contra um teto de
 * 100/min. Dar um IP por teste não é truque para escapar do limite: é o que
 * eles conceitualmente são, clientes diferentes. E o efeito é que a suíte roda
 * contra os valores REAIS de produção, em vez de contra um limite afrouxado só
 * para os testes passarem.
 *
 * Quem quer exercitar o limite (`rate-limit.test.ts`) passa `remoteAddress`
 * explicitamente e repete o mesmo IP de propósito.
 */
let testCounter = 0;
beforeEach(() => {
  testCounter += 1;
});

/** IP do teste em execução. Usado pelo `inject` de `buildTestApp()`. */
export function currentTestIp(): string {
  // 10.x.y.z: faixa privada, sem chance de colidir com algo real
  return `10.0.${Math.floor(testCounter / 256) % 256}.${testCounter % 256}`;
}
