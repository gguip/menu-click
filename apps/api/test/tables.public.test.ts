import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import type { TestRestaurant } from "./helpers.ts";
import { buildTestApp, createRestaurant } from "./helpers.ts";

/** Cria uma mesa via API e devolve o corpo. */
async function criaMesa(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  label: string,
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/tables`,
    headers: restaurant.headers,
    payload: { label },
  });
  return response.json();
}

/**
 * A resolução pública do QR code: o cliente escaneou e tem só o hash na mão.
 *
 * Ela existe para a tela conseguir dizer "você está na Mesa 7" — sem isso, quem
 * escaneou o adesivo errado só descobre quando a comida for para outra mesa.
 */
describe("GET /menu/:slug/table/:hash", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("devolve o rótulo, SEM exigir sessão", async () => {
    const restaurant = await createRestaurant(app);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");

    const response = await app.inject({
      method: "GET",
      url: `/menu/${restaurant.slug}/table/${mesa.hash}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ label: "Mesa 7" });
  });

  /**
   * O hash é o conteúdo do adesivo, e o painel do restaurante o lê à vontade —
   * mas a superfície pública devolve só o rótulo. Sem isto, quem escaneasse uma
   * mesa sairia com a credencial dela em mãos para republicar.
   */
  it("não devolve o hash nem o id da mesa", async () => {
    const restaurant = await createRestaurant(app);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");

    const response = await app.inject({
      method: "GET",
      url: `/menu/${restaurant.slug}/table/${mesa.hash}`,
    });

    expect(response.json().hash).toBeUndefined();
    expect(response.json().id).toBeUndefined();
  });

  it("404 no hash de OUTRO restaurante — indistinguível de inexistente (S19)", async () => {
    const dono = await createRestaurant(app);
    const outro = await createRestaurant(app);
    const mesa = await criaMesa(app, dono, "Mesa 7");

    const response = await app.inject({
      method: "GET",
      url: `/menu/${outro.slug}/table/${mesa.hash}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("404 no hash antigo depois da rotação — é o que invalida o adesivo", async () => {
    const restaurant = await createRestaurant(app);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");

    await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/tables/${mesa.id}/rotate-hash`,
      headers: restaurant.headers,
    });

    const response = await app.inject({
      method: "GET",
      url: `/menu/${restaurant.slug}/table/${mesa.hash}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("404 na mesa removida", async () => {
    const restaurant = await createRestaurant(app);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");

    await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}/tables/${mesa.id}`,
      headers: restaurant.headers,
    });

    const response = await app.inject({
      method: "GET",
      url: `/menu/${restaurant.slug}/table/${mesa.hash}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("404 no hash inventado", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "GET",
      url: `/menu/${restaurant.slug}/table/naoexisteestehash1234`,
    });

    expect(response.statusCode).toBe(404);
  });

  /**
   * ⚠️ O estado deste teste é montado por SQL na mão, e não por rota, porque
   * pela API ele não é alcançável: loja não verificada recebe 403 em toda rota
   * escopada, então nunca chega a ter mesa. O filtro de `email_verified_at` na
   * consulta é rede de baixo — o que ele prende é a coerência com o resto da
   * superfície pública (cardápio, cotação e criação de pedido respondem 404
   * para a mesma loja, S32), e o dia em que alguém puder despromover ou
   * restaurar um cadastro à mão (D7).
   */
  it("404 quando a loja não provou o e-mail, como todo o resto do público", async () => {
    const restaurant = await createRestaurant(app);
    const mesa = await criaMesa(app, restaurant, "Mesa 7");

    await pool.query(
      "update restaurants set email_verified_at = null where id = $1",
      [restaurant.id],
    );

    const response = await app.inject({
      method: "GET",
      url: `/menu/${restaurant.slug}/table/${mesa.hash}`,
    });

    expect(response.statusCode).toBe(404);
  });
});
