import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createRestaurant, setOpeningHours } from "./helpers.ts";

/** "Aberto até 23h" / "Abre amanhã às 18h" no cardápio público. */
describe("horário no cardápio público", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const menu = async (slug: string) => (await app.inject({ method: "GET", url: `/menu/${slug}` })).json();

  it("aberta direto (grade 24x7): isOpen sem closesAt", async () => {
    const r = await createRestaurant(app); // o helper registra a grade sempre aberta
    const body = await menu(r.slug);
    expect(body.isOpen).toBe(true);
    expect(body.closesAt).toBeUndefined();
    expect(body.opensAt).toBeUndefined();
  });

  it("sem grade: fechada, sem opensAt", async () => {
    const r = await createRestaurant(app);
    await setOpeningHours(app, r, []);
    const body = await menu(r.slug);
    expect(body.isOpen).toBe(false);
    expect(body.opensAt).toBeUndefined();
  });

  it("fora da faixa de hoje: opensAt no futuro", async () => {
    const r = await createRestaurant(app);
    // uma faixa curta em TODO dia, que nunca contém o agora (a hora local
    // atual + 2h..+3h) — só para existir uma próxima abertura
    const { rows } = await (await import("../src/db/pool.ts")).pool.query<{ h: number }>(
      `select extract(hour from now() at time zone 'America/Sao_Paulo')::int as h`,
    );
    const start = String((rows[0].h + 2) % 24).padStart(2, "0");
    const end = String((rows[0].h + 3) % 24).padStart(2, "0");
    await setOpeningHours(
      app,
      r,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: `${start}:00`, closesAt: `${end}:00` })),
    );
    const body = await menu(r.slug);
    expect(body.isOpen).toBe(false);
    expect(Date.parse(body.opensAt)).toBeGreaterThan(Date.now());
  });

  // O app precisa do fuso para dizer "23h" no horário DA LOJA. Até aqui o
  // fuso ficava fora do cardápio público por S10 (nada sai sem decisão); esta
  // é a decisão: fuso não é dado sensível, e sem ele o app erraria a hora.
  it("expõe o fuso da loja", async () => {
    const r = await createRestaurant(app, { timezone: "America/Manaus" });
    expect((await menu(r.slug)).timezone).toBe("America/Manaus");
  });

  it("pausada dentro do horário: isOpen false, e o horário da grade continua lá", async () => {
    const r = await createRestaurant(app);
    await app.inject({
      method: "PATCH",
      url: `/restaurants/${r.id}`,
      headers: r.headers,
      payload: { acceptingOrders: false },
    });
    const body = await menu(r.slug);
    expect(body.isOpen).toBe(false);
    expect(body.acceptingOrders).toBe(false);
  });
});
