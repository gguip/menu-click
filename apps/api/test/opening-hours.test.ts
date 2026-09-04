import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp, createRestaurant, setOpeningHours } from "./helpers.ts";

/**
 * A grade de horário do restaurante.
 *
 * Um `PUT` define a semana inteira, como a tela faz: a pessoa edita a grade e
 * salva. Dia sem faixa é dia fechado — a ausência é a informação, e uma flag
 * de "fechado" permitiria o estado incoerente de "fechado, das 11 às 15".
 */
describe("grade de horário", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("define a semana e devolve na ordem", async () => {
    const restaurant = await createRestaurant(app);

    const response = await setOpeningHours(app, restaurant, [
      { weekday: 1, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 1, opensAt: "11:00", closesAt: "15:00" },
      { weekday: 2, opensAt: "11:00", closesAt: "15:00" },
    ]);

    expect(response.statusCode).toBe(200);
    expect(
      response.json().openingHours.map((f: { weekday: number; opensAt: string }) =>
        `${f.weekday} ${f.opensAt}`,
      ),
    ).toEqual(["1 11:00", "1 18:00", "2 11:00"]);
  });

  it("várias faixas no mesmo dia — a pausa da tarde", async () => {
    const restaurant = await createRestaurant(app);

    const response = await setOpeningHours(app, restaurant, [
      { weekday: 3, opensAt: "11:00", closesAt: "15:00" },
      { weekday: 3, opensAt: "18:00", closesAt: "23:00" },
    ]);

    expect(response.json().openingHours).toHaveLength(2);
  });

  /** Metade do delivery noturno. Não é erro de digitação. */
  it("aceita faixa que atravessa a meia-noite", async () => {
    const restaurant = await createRestaurant(app);

    const response = await setOpeningHours(app, restaurant, [
      { weekday: 5, opensAt: "18:00", closesAt: "02:00" },
    ]);

    expect(response.statusCode).toBe(200);
    expect(response.json().openingHours[0]).toMatchObject({
      opensAt: "18:00",
      closesAt: "02:00",
    });
  });

  it("é idempotente: mandar a mesma grade duas vezes não duplica", async () => {
    const restaurant = await createRestaurant(app);
    const grade = [{ weekday: 1, opensAt: "11:00", closesAt: "15:00" }];

    await setOpeningHours(app, restaurant, grade);
    const segunda = await setOpeningHours(app, restaurant, grade);

    expect(segunda.json().openingHours).toHaveLength(1);
  });

  it("lista vazia fecha a semana inteira", async () => {
    const restaurant = await createRestaurant(app);
    await setOpeningHours(app, restaurant, [
      { weekday: 1, opensAt: "11:00", closesAt: "15:00" },
    ]);

    const response = await setOpeningHours(app, restaurant, []);

    expect(response.json().openingHours).toEqual([]);
  });

  it("GET devolve a grade gravada", async () => {
    const restaurant = await createRestaurant(app);
    await setOpeningHours(app, restaurant, [
      { weekday: 0, opensAt: "12:00", closesAt: "20:00" },
    ]);

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/opening-hours`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().openingHours).toHaveLength(1);
  });

  describe("entradas recusadas", () => {
    it("400 com weekday fora de 0–6", async () => {
      const restaurant = await createRestaurant(app);

      const response = await setOpeningHours(app, restaurant, [
        { weekday: 7, opensAt: "11:00", closesAt: "15:00" },
      ]);

      expect(response.statusCode).toBe(400);
    });

    it("400 com abertura igual ao fechamento", async () => {
      const restaurant = await createRestaurant(app);

      const response = await setOpeningHours(app, restaurant, [
        { weekday: 1, opensAt: "11:00", closesAt: "11:00" },
      ]);

      expect(response.statusCode).toBe(400);
    });

    it("400 com hora fora do formato HH:MM", async () => {
      const restaurant = await createRestaurant(app);

      const response = await setOpeningHours(app, restaurant, [
        { weekday: 1, opensAt: "11h", closesAt: "15:00" },
      ]);

      expect(response.statusCode).toBe(400);
    });
  });

  it("a grade de outro restaurante é 404", async () => {
    const dono = await createRestaurant(app);
    const intruso = await createRestaurant(app);

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${dono.id}/opening-hours`,
      headers: intruso.headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("remover o restaurante remove a grade (D3)", async () => {
    const restaurant = await createRestaurant(app);
    await setOpeningHours(app, restaurant, [
      { weekday: 1, opensAt: "11:00", closesAt: "15:00" },
    ]);

    await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
    });

    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from opening_hours
        where restaurant_id = $1 and deleted_at is null`,
      [restaurant.id],
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});
