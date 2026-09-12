import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import {
  buildTestApp,
  createRestaurant,
  setDeliveryNeighborhoods,
} from "./helpers.ts";

/**
 * Os bairros atendidos e o preço de cada um.
 *
 * Um `PUT` troca a lista inteira, como a grade de horário: a pessoa edita e
 * salva. O nome é digitado por quem edita o cardápio, então repetido é
 * conflito (409), nunca sufixo automático — o oposto da política do slug.
 */
describe("bairros atendidos", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  /**
   * ⚠️ A ordenação deste teste NÃO é prendida por mutação, e isso é sabido.
   *
   * Tirar o `order by name` do repositório não derruba nada: existe um índice
   * parcial em `(restaurant_id, name)` — o de busca, criado junto com a
   * tabela —, e o planejador o escolhe para esta consulta, devolvendo as
   * linhas já ordenadas sem nó de Sort. Confirmado por `EXPLAIN ANALYZE`, e
   * também à mão: três bairros inseridos em ordem não alfabética voltam
   * alfabéticos sem nenhum `order by`.
   *
   * Não há como construir divergência: o índice ordena pela MESMA coluna que o
   * `order by` pede. Mudar o teste para forçar a falha exigiria remover ou
   * alterar o índice, que é mexer no que está sendo testado. O `order by` explícito fica como cinto além do suspensório:
   * não depender do plano de execução é barato, e o dia em que o índice mudar
   * de forma a ordem continua definida.
   *
   * O que este teste prende de verdade é o `replace` devolvendo a lista
   * inteira com os preços certos.
   */
  it("substitui a lista inteira e devolve na ordem do nome", async () => {
    const restaurant = await createRestaurant(app, { slug: "bairros" });

    const put = await app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
      payload: {
        neighborhoods: [
          { name: "Jardim América", feeInCents: 900 },
          { name: "Centro", feeInCents: 500 },
        ],
      },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().neighborhoods).toEqual([
      { name: "Centro", feeInCents: 500 },
      { name: "Jardim América", feeInCents: 900 },
    ]);
  });

  it("recusa dois bairros que só diferem por acento ou caixa", async () => {
    const restaurant = await createRestaurant(app, { slug: "bairro-dup" });

    const response = await app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
      payload: {
        neighborhoods: [
          { name: "Jardim América", feeInCents: 900 },
          { name: "jardim america", feeInCents: 400 },
        ],
      },
    });

    // 409: é o mesmo raciocínio do nome de categoria — o nome foi digitado por
    // quem edita, então repetido é conflito, nunca sufixo automático
    expect(response.statusCode).toBe(409);
  });

  it("recusa dois bairros que só diferem por espaço duplicado", async () => {
    const restaurant = await createRestaurant(app, { slug: "bairro-espaco" });

    const response = await app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
      payload: {
        neighborhoods: [
          { name: "Vila Nova", feeInCents: 900 },
          { name: "Vila  Nova", feeInCents: 400 },
        ],
      },
    });

    // mesma razão do teste de acento/caixa, mas cobrindo o eixo do
    // trim/colapso de espaço, que aquele não exercita
    expect(response.statusCode).toBe(409);
  });

  it("bairro com taxa zero é entrega grátis, e é aceito", async () => {
    const restaurant = await createRestaurant(app, { slug: "bairro-gratis" });

    const response = await app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
      payload: { neighborhoods: [{ name: "Vizinhança", feeInCents: 0 }] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().neighborhoods[0].feeInCents).toBe(0);
  });

  it("lista vazia limpa a configuração", async () => {
    const restaurant = await createRestaurant(app, { slug: "bairro-limpa" });
    await setDeliveryNeighborhoods(app, restaurant, [
      { name: "Centro", feeInCents: 500 },
    ]);

    await app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
      payload: { neighborhoods: [] },
    });

    const get = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
    });
    expect(get.json().neighborhoods).toEqual([]);
  });

  it("bairro de outro dono responde 404", async () => {
    const dono = await createRestaurant(app, { slug: "dono-b" });
    const alheio = await createRestaurant(app, { slug: "alheio-b" });

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${dono.id}/delivery-neighborhoods`,
      headers: alheio.headers,
    });

    // 404, nunca 403: 403 confirmaria que aquele restaurante existe (S19)
    expect(response.statusCode).toBe(404);
  });

  it("remover o restaurante marca os bairros na mesma transação", async () => {
    const restaurant = await createRestaurant(app, { slug: "cascata-b" });
    await setDeliveryNeighborhoods(app, restaurant, [
      { name: "Centro", feeInCents: 500 },
    ]);

    await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
    });

    const { rows } = await pool.query(
      `select count(*)::int as vivos from delivery_neighborhoods
        where restaurant_id = $1 and deleted_at is null`,
      [restaurant.id],
    );
    expect(rows[0].vivos).toBe(0);
  });
});
