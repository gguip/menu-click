import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as openingHours from "../src/repositories/opening-hours.ts";
import { buildTestApp, createRestaurant, setOpeningHours } from "./helpers.ts";

const TZ = "America/Sao_Paulo"; // UTC-3, sem horário de verão desde 2019

/**
 * "Aberta · fecha 23:30" / "Fechada · abre 18:00". Instante FIXO passado à
 * função: 2026-09-21 é uma segunda-feira (weekday 1).
 */
describe("status de funcionamento", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // segunda 2026-09-21 às HH:MM no fuso de São Paulo
  const segunda = (hora: string) => new Date(`2026-09-21T${hora}:00-03:00`);

  async function lojaCom(grade: { weekday: number; opensAt: string; closesAt: string }[]) {
    const r = await createRestaurant(app, { timezone: TZ });
    await setOpeningHours(app, r, grade);
    return r;
  }

  it("dentro da faixa: aberta, com a hora de fechar", async () => {
    const r = await lojaCom([{ weekday: 1, opensAt: "11:00", closesAt: "23:30" }]);
    const status = await openingHours.findOpeningStatus(r.id, TZ, segunda("20:00"));
    expect(status).toEqual({ isOpen: true, closesAt: "2026-09-22T02:30:00.000Z" });
  });

  it("fora da faixa: fechada, com a próxima abertura (hoje ou outro dia)", async () => {
    const r = await lojaCom([
      { weekday: 1, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 3, opensAt: "18:00", closesAt: "23:00" },
    ]);
    expect(await openingHours.findOpeningStatus(r.id, TZ, segunda("15:00"))).toEqual({
      isOpen: false,
      opensAt: "2026-09-21T21:00:00.000Z",
    });
    expect(await openingHours.findOpeningStatus(r.id, TZ, segunda("23:30"))).toEqual({
      isOpen: false,
      opensAt: "2026-09-23T21:00:00.000Z",
    });
  });

  it("faixa que atravessa a meia-noite: às 01:00 de terça vale a de segunda", async () => {
    const r = await lojaCom([{ weekday: 1, opensAt: "18:00", closesAt: "02:00" }]);
    const terca1h = new Date("2026-09-22T01:00:00-03:00");
    expect(await openingHours.findOpeningStatus(r.id, TZ, terca1h)).toEqual({
      isOpen: true,
      closesAt: "2026-09-22T05:00:00.000Z",
    });
  });

  it("faixas encostadas se fundem: almoço 11–15 e 15–23 fecha às 23", async () => {
    const r = await lojaCom([
      { weekday: 1, opensAt: "11:00", closesAt: "15:00" },
      { weekday: 1, opensAt: "15:00", closesAt: "23:00" },
    ]);
    expect(await openingHours.findOpeningStatus(r.id, TZ, segunda("12:00"))).toEqual({
      isOpen: true,
      closesAt: "2026-09-22T02:00:00.000Z",
    });
  });

  it("grade 24x7 do backfill: aberta, sem hora de fechar", async () => {
    const grade = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
      { weekday, opensAt: "00:00", closesAt: "23:59" },
      { weekday, opensAt: "23:59", closesAt: "00:00" },
    ]);
    const r = await lojaCom(grade);
    expect(await openingHours.findOpeningStatus(r.id, TZ, segunda("23:59"))).toEqual({ isOpen: true });
  });

  it("sem grade nenhuma: fechada, sem próxima abertura", async () => {
    const r = await lojaCom([]);
    expect(await openingHours.findOpeningStatus(r.id, TZ, segunda("12:00"))).toEqual({ isOpen: false });
  });

  it("concorda com isOpenNow nas mesmas grades, agora", async () => {
    for (const grade of [
      [{ weekday: 1, opensAt: "11:00", closesAt: "23:30" }],
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "00:00", closesAt: "23:59" })),
      [],
    ]) {
      const r = await lojaCom(grade);
      const status = await openingHours.findOpeningStatus(r.id, TZ);
      expect(status.isOpen).toBe(await openingHours.isOpenNow(r.id, TZ));
    }
  });

  it("sai no GET do restaurante, e não no PATCH", async () => {
    const r = await createRestaurant(app);
    const get = await app.inject({ method: "GET", url: `/restaurants/${r.id}`, headers: r.headers });
    const patch = await app.inject({
      method: "PATCH",
      url: `/restaurants/${r.id}`,
      headers: r.headers,
      payload: { acceptingOrders: false },
    });
    expect(typeof get.json().openingStatus.isOpen).toBe("boolean");
    expect(patch.json().openingStatus).toBeUndefined();
  });
});
