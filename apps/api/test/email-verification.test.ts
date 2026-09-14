import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { clearOutbox } from "../src/email.ts";
import {
  buildTestApp,
  createRestaurant,
  esperaEmail,
  extraiToken,
  registerAndLogin,
  validDeliveryAddress,
} from "./helpers.ts";

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

  /**
   * Task 3 do plano: a loja que não provou o e-mail some do lado de fora —
   * cardápio, cotação de frete e criação de pedido. `registerAndLogin` cria
   * sem verificar (ver o comentário do topo do arquivo), então `restaurant`
   * aqui é sempre uma loja invisível para o cliente.
   */
  describe("a loja invisível para o cliente até verificar o e-mail", () => {
    it("o cardápio de loja não verificada responde 404", async () => {
      const { restaurant } = await registerAndLogin(app, {
        restaurant: { slug: "invisivel" },
      });

      const response = await app.inject({
        method: "GET",
        url: "/menu/invisivel",
      });

      // 404 e não 403: do lado de fora, loja que não provou o e-mail tem que
      // ser indistinguível de loja que não existe. 403 entregaria que o slug
      // está ocupado.
      expect(response.statusCode).toBe(404);
      expect(restaurant.slug).toBe("invisivel"); // ela existe; só não aparece
    });

    it("a listagem de produtos do cardápio também", async () => {
      await registerAndLogin(app, { restaurant: { slug: "invisivel-produtos" } });

      const response = await app.inject({
        method: "GET",
        url: "/menu/invisivel-produtos/products",
      });

      expect(response.statusCode).toBe(404);
    });

    it("a cotação de frete também", async () => {
      await registerAndLogin(app, { restaurant: { slug: "invisivel-frete" } });

      const response = await app.inject({
        method: "POST",
        url: "/menu/invisivel-frete/delivery-quote",
        payload: { address: validDeliveryAddress, subtotalInCents: 3000 },
      });

      expect(response.statusCode).toBe(404);
    });

    it("e não dá para criar pedido nela", async () => {
      const { restaurant } = await registerAndLogin(app);

      // pelo id, não pelo slug: é o caminho que a criação usa
      // (`restaurantsService.getById`, não `findBySlug`) — productId
      // qualquer serve: o 404 de visibilidade tem que vir antes de qualquer
      // checagem de item, ou este teste dependeria de o restaurante ter
      // produto cadastrado, e uma loja não verificada não passa nem pelo
      // painel para criar um.
      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: {
          type: "dine_in",
          customer: { name: "Ana Souza", phone: "11999990000" },
          items: [{ productId: randomUUID(), quantity: 1 }],
          paymentMethod: "cash",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("depois de verificar, a loja aparece", async () => {
      // mesma loja, agora verificada pelo fluxo real (`createRestaurant`)
      const restaurant = await createRestaurant(app, { slug: "agora-visivel" });

      const response = await app.inject({
        method: "GET",
        url: `/menu/${restaurant.slug}`,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  /**
   * `POST /auth/verify-email` (o mecanismo por trás do desbloqueio acima) e
   * `POST /auth/resend-verification` — Task 4 do plano.
   *
   * Espelha `password-reset.test.ts` de perto, e por isso reaproveita os
   * mesmos `esperaEmail`/`extraiToken` de `./helpers.ts` — duas cópias
   * divergiriam no dia em que o formato do link mudasse.
   *
   * ⚠️ Nenhum teste aqui mede relógio. O de expiração envelhece a linha no
   * BANCO (mesmo padrão de `password-reset.test.ts`).
   */
  describe("verificação por token e reenvio", () => {
    it("o cadastro dispara o e-mail de verificação", async () => {
      const { user } = await registerAndLogin(app);

      const email = await esperaEmail(user.email);
      expect(email.text).toContain("http");
    });

    it("verifica com o token e a loja passa a operar", async () => {
      const { restaurant, headers, user } = await registerAndLogin(app);
      const token = extraiToken((await esperaEmail(user.email)).text);

      const verifica = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token },
      });
      expect(verifica.statusCode).toBe(200);

      const produtos = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/products`,
        headers,
      });
      expect(produtos.statusCode).toBe(200);
    });

    it("o token não serve duas vezes", async () => {
      const { user } = await registerAndLogin(app);
      const token = extraiToken((await esperaEmail(user.email)).text);

      const primeira = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token },
      });
      expect(primeira.statusCode).toBe(200);

      const segunda = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token },
      });
      expect(segunda.statusCode).toBe(400);
    });

    it("token expirado não serve", async () => {
      const { user } = await registerAndLogin(app);
      const token = extraiToken((await esperaEmail(user.email)).text);

      // envelhece a linha no BANCO — nunca espera o relógio
      await pool.query(
        `update email_verification_tokens set expires_at = now() - interval '1 minute'
          where restaurant_user_id = $1`,
        [user.id],
      );

      const response = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token },
      });
      expect(response.statusCode).toBe(400);
    });

    it("token inventado não serve", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token: "um-token-que-nunca-existiu" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("mensagem única para token inválido, expirado e já usado", async () => {
      const inventado = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token: "outro-token-que-nunca-existiu" },
      });

      const { user: usuarioExpirado } = await registerAndLogin(app);
      const tokenExpirado = extraiToken(
        (await esperaEmail(usuarioExpirado.email)).text,
      );
      await pool.query(
        `update email_verification_tokens set expires_at = now() - interval '1 minute'
          where restaurant_user_id = $1`,
        [usuarioExpirado.id],
      );
      const expirado = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token: tokenExpirado },
      });

      const { user: usuarioJaVerificado } = await registerAndLogin(app);
      const tokenJaUsado = extraiToken(
        (await esperaEmail(usuarioJaVerificado.email)).text,
      );
      await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token: tokenJaUsado },
      });
      const jaUsado = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token: tokenJaUsado },
      });

      expect(inventado.statusCode).toBe(400);
      expect(expirado.statusCode).toBe(400);
      expect(jaUsado.statusCode).toBe(400);

      // distinguir diria a quem guarda um link velho se ele um dia existiu
      const mensagens = new Set(
        [inventado, expirado, jaUsado].map((r) => r.json().message),
      );
      expect(mensagens.size).toBe(1);
    });

    it("verificar não devolve sessão", async () => {
      const { user } = await registerAndLogin(app);
      const token = extraiToken((await esperaEmail(user.email)).text);

      const response = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token },
      });

      // devolver sessão aqui dispensaria o login: possuir o link já bastaria
      expect(JSON.stringify(response.json())).not.toContain("token");
    });

    it("o reenvio manda outro link, e o novo funciona", async () => {
      const { user, headers } = await registerAndLogin(app);
      await esperaEmail(user.email); // consome o e-mail do cadastro
      clearOutbox();

      const reenvio = await app.inject({
        method: "POST",
        url: "/auth/resend-verification",
        headers,
      });
      expect(reenvio.statusCode).toBe(202);

      const novoToken = extraiToken((await esperaEmail(user.email)).text);
      const verifica = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token: novoToken },
      });
      expect(verifica.statusCode).toBe(200);
    });

    it("o reenvio invalida o token anterior", async () => {
      const { user, headers } = await registerAndLogin(app);
      const tokenAntigo = extraiToken((await esperaEmail(user.email)).text);
      clearOutbox();

      const reenvio = await app.inject({
        method: "POST",
        url: "/auth/resend-verification",
        headers,
      });
      expect(reenvio.statusCode).toBe(202);
      // espera o trabalho em segundo plano (invalidar + criar + enviar)
      // terminar antes de tentar o token velho
      await esperaEmail(user.email);

      const response = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token: tokenAntigo },
      });
      expect(response.statusCode).toBe(400);
    });

    it("o reenvio exige sessão", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/resend-verification",
      });
      expect(response.statusCode).toBe(401);
    });
  });
});
