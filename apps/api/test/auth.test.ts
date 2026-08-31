import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { pool } from "../src/db/pool.ts";
import {
  authHeaders,
  login,
  registerRestaurant,
  validRestaurantBody,
  validUserBody,
} from "./helpers.ts";

/**
 * Cadastro, login e sessão.
 *
 * O que estes testes protegem, além do caminho feliz: a senha nunca sai da
 * API nem entra no banco em texto, o cadastro é tudo-ou-nada, e login errado
 * responde a mesma coisa não importa o que estava errado.
 */
describe("autenticação", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /auth/register", () => {
    it("cria restaurante e primeiro usuário", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { restaurant: validRestaurantBody, user: validUserBody },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.restaurant.name).toBe("Tokyo Ramen House");
      expect(body.user).toMatchObject({
        email: "dono@tokyoramen.com.br",
        restaurantId: body.restaurant.id,
      });
    });

    it("não devolve senha nem hash em lugar nenhum da resposta", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { restaurant: validRestaurantBody, user: validUserBody },
      });

      expect(response.body).not.toContain(validUserBody.password);
      expect(response.body).not.toContain("passwordHash");
      expect(response.body).not.toContain("$2b$");
    });

    it("guarda hash bcrypt, nunca a senha", async () => {
      const { user } = await registerRestaurant(app);

      const { rows } = await pool.query<{ password_hash: string }>(
        "select password_hash from restaurant_users where id = $1",
        [user.id],
      );
      expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
      expect(rows[0].password_hash).not.toContain(validUserBody.password);
    });

    it("409 com e-mail já cadastrado, e o restaurante não é criado", async () => {
      // e-mail fixo nos dois cadastros: o helper sorteia um novo a cada
      // chamada, e é justamente a repetição que este teste precisa
      await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { restaurant: validRestaurantBody, user: validUserBody },
      });

      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          restaurant: { ...validRestaurantBody, name: "Outro Restaurante" },
          user: validUserBody,
        },
      });

      expect(response.statusCode).toBe(409);

      // o rollback tem que ter levado o restaurante junto: cadastro é
      // tudo-ou-nada, senão sobra restaurante órfão sem ninguém que o acesse
      const { rows } = await pool.query(
        "select 1 from restaurants where name = $1",
        ["Outro Restaurante"],
      );
      expect(rows).toHaveLength(0);
    });

    it("400 com senha curta demais", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          restaurant: validRestaurantBody,
          user: { ...validUserBody, password: "curta" },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    /**
     * O bcrypt ignora tudo depois do byte 72 EM SILÊNCIO — verificado que duas
     * senhas que só diferem do byte 73 em diante conferem como iguais. Como
     * `maxLength` conta caracteres, 40 letras "ç" (80 bytes) passariam pelo
     * schema e teriam 8 bytes descartados sem ninguém saber.
     */
    it("400 com senha acima de 72 bytes, mesmo cabendo em caracteres", async () => {
      const senha = "ç".repeat(40); // 40 caracteres, 80 bytes

      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          restaurant: validRestaurantBody,
          user: { ...validUserBody, password: senha },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain("bytes");
    });

    it("400 com senha numérica (o validador estrito não coage)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          restaurant: validRestaurantBody,
          user: { ...validUserBody, password: 123456789 },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("400 com e-mail fora do formato", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          restaurant: validRestaurantBody,
          user: { ...validUserBody, email: "nao-e-email" },
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /auth/login", () => {
    it("devolve token e validade", async () => {
      const { user, password } = await registerRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: user.email, password },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().token).toEqual(expect.any(String));
      expect(new Date(response.json().expiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it("grava o hash do token, nunca o token", async () => {
      const { user, password } = await registerRestaurant(app);
      const token = await login(app, user.email, password);

      const { rows } = await pool.query<{ token_hash: string }>(
        "select token_hash from sessions",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).not.toBe(token);
      expect(rows[0].token_hash).toHaveLength(64); // sha256 em hex
    });

    /**
     * A mesma resposta para os dois casos não é preguiça: dizer "e-mail não
     * existe" entrega ao atacante quais endereços estão cadastrados, que é
     * metade do trabalho de um ataque de credencial.
     */
    it("401 com senha errada e com e-mail inexistente, com a MESMA mensagem", async () => {
      const { user } = await registerRestaurant(app);

      const senhaErrada = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: user.email, password: "outra-senha-qualquer" },
      });
      const emailInexistente = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "ninguem@lugar.com", password: "outra-senha-qualquer" },
      });

      expect(senhaErrada.statusCode).toBe(401);
      expect(emailInexistente.statusCode).toBe(401);
      expect(senhaErrada.json().message).toBe(emailInexistente.json().message);
    });

    it("401 depois que o usuário é removido", async () => {
      const { user, password } = await registerRestaurant(app);
      await pool.query(
        "update restaurant_users set deleted_at = now() where id = $1",
        [user.id],
      );

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: user.email, password },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /auth/me", () => {
    it("devolve o usuário da sessão", async () => {
      const { user, password } = await registerRestaurant(app);
      const token = await login(app, user.email, password);

      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: authHeaders(token),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: user.id,
        email: user.email,
        restaurantId: user.restaurantId,
      });
      expect(response.body).not.toContain("passwordHash");
    });

    it.each([
      ["sem header", undefined],
      ["token que não existe", "Bearer token-inventado"],
      ["sem o prefixo Bearer", "token-solto"],
      ["Bearer vazio", "Bearer "],
    ])("401 %s", async (_caso, authorization) => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: authorization === undefined ? {} : { authorization },
      });

      expect(response.statusCode).toBe(401);
    });

    it("401 com sessão expirada", async () => {
      const { user, password } = await registerRestaurant(app);
      const token = await login(app, user.email, password);
      await pool.query("update sessions set expires_at = now() - interval '1 second'");

      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: authHeaders(token),
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /auth/logout", () => {
    it("revoga a sessão: o mesmo token para de valer", async () => {
      const { user, password } = await registerRestaurant(app);
      const token = await login(app, user.email, password);

      const logout = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: authHeaders(token),
      });
      expect(logout.statusCode).toBe(204);

      const depois = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: authHeaders(token),
      });
      expect(depois.statusCode).toBe(401);
    });

    it("logout não derruba a outra sessão do mesmo usuário", async () => {
      const { user, password } = await registerRestaurant(app);
      const celular = await login(app, user.email, password);
      const computador = await login(app, user.email, password);

      await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: authHeaders(celular),
      });

      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: authHeaders(computador),
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
