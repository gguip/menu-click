import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createRestaurant, registerAndLogin } from "./helpers.ts";

/**
 * O bloqueio do painel por e-mail não verificado (Task 2 do plano).
 *
 * A propriedade central: `registerAndLogin` cadastra SEM completar a
 * verificação (é o helper que os outros testes usam quando querem uma sessão
 * válida numa loja ainda bloqueada), enquanto `createRestaurant` completa a
 * verificação pelo fluxo real antes de devolver — é por isso que a suíte
 * inteira (que usa `createRestaurant` centenas de vezes) continua verde.
 */
describe("bloqueio do painel por e-mail não verificado", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("bloqueia o painel com 403 até verificar", async () => {
    // `registerAndLogin` cria SEM verificar, ao contrário do `createRestaurant`
    const { restaurant, headers } = await registerAndLogin(app);

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/products`,
      headers,
    });

    // 403 e não 404: a sessão é válida e o restaurante É o da sessão —
    // esconder mandaria quem está no painel procurar o problema no lugar
    // errado (S32)
    expect(response.statusCode).toBe(403);
    expect(response.json().message).toMatch(/verif/i);
  });

  it("deixa passar o que a pessoa precisa para se desbloquear", async () => {
    const { headers } = await registerAndLogin(app);

    // `/auth/me` para o painel saber o que falta, e o logout continuam livres
    // mesmo com a loja bloqueada — são as únicas ações que não dependem do
    // restaurante estar verificado
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "POST", url: "/auth/logout", headers }))
        .statusCode,
    ).toBe(204);
  });

  it("o /auth/me diz que o restaurante não está verificado", async () => {
    const { headers } = await registerAndLogin(app);

    const response = await app.inject({ method: "GET", url: "/auth/me", headers });

    // no TOPO do corpo, não aninhado: o `/auth/me` devolve `RestaurantUser`, e
    // não há `restaurant` nele
    expect(response.json().emailVerified).toBe(false);
  });

  it("restaurante verificado opera normalmente", async () => {
    // `createRestaurant` completa a verificação pelo fluxo real — ver o helper
    const restaurant = await createRestaurant(app, { slug: "verificada" });

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/products`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(200);
  });

  it("restaurante alheio responde 404 mesmo com sessão não verificada", async () => {
    // A ORDEM do hook importa: o escopo (404) tem que ser conferido ANTES da
    // verificação (403). Se a verificação viesse primeiro, uma sessão NÃO
    // verificada denunciaria que o restaurante de outra pessoa existe só por
    // trocar de 404 para 403 — é exatamente o caso que uma sessão verificada
    // não expõe (ela cai direto no 404 do escopo, com ou sem a ordem certa).
    const outro = await createRestaurant(app);
    const { headers } = await registerAndLogin(app);

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${outro.id}/products`,
      headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("o /auth/me de um restaurante verificado diz isso", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: restaurant.headers,
    });

    expect(response.json().emailVerified).toBe(true);
  });
});
