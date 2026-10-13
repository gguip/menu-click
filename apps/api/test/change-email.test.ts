import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { clearOutbox } from "../src/email.ts";
import { ConflictError } from "../src/errors.ts";
import * as authService from "../src/services/auth.ts";
import {
  authHeaders,
  buildTestApp,
  createRestaurant,
  esperaEmail,
  extraiToken,
  login,
  registerAndLogin,
  uniqueEmail,
  validUserBody,
} from "./helpers.ts";

/**
 * Correção do e-mail de uma loja ainda não verificada.
 *
 * `registerAndLogin` cadastra SEM verificar — é a loja bloqueada que esta rota
 * atende. A senha de todo usuário de teste é `validUserBody.password`.
 */
describe("POST /auth/change-email", () => {
  let app: FastifyInstance;
  const senha = validUserBody.password;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function changeEmail(
    headers: { authorization: string },
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: "POST",
      url: "/auth/change-email",
      headers,
      payload,
    });
  }

  it("troca o e-mail: o novo entra, o antigo deixa de entrar", async () => {
    const { user, headers } = await registerAndLogin(app);
    const novo = uniqueEmail();

    const response = await changeEmail(headers, {
      currentPassword: senha,
      newEmail: novo,
    });
    expect(response.statusCode).toBe(204);

    const me = await app.inject({ method: "GET", url: "/auth/me", headers });
    expect(me.json().email).toBe(novo);

    const comNovo = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: novo, password: senha },
    });
    expect(comNovo.statusCode).toBe(200);

    const comAntigo = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: senha },
    });
    expect(comAntigo.statusCode).toBe(401);
  });

  it("o link antigo morre, e o novo verifica e libera a loja", async () => {
    const { restaurant, user, headers } = await registerAndLogin(app);
    const tokenAntigo = extraiToken((await esperaEmail(user.email)).text);
    const novo = uniqueEmail();

    await changeEmail(headers, { currentPassword: senha, newEmail: novo });
    const tokenNovo = extraiToken((await esperaEmail(novo)).text);

    const comAntigo = await app.inject({
      method: "POST",
      url: "/auth/verify-email",
      payload: { token: tokenAntigo },
    });
    expect(comAntigo.statusCode).toBe(400);

    const comNovo = await app.inject({
      method: "POST",
      url: "/auth/verify-email",
      payload: { token: tokenNovo },
    });
    expect(comNovo.statusCode).toBe(200);

    const produtos = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/products`,
      headers,
    });
    expect(produtos.statusCode).toBe(200);
  });

  it("depois da troca, o reenvio vai para o endereço novo", async () => {
    const { user, headers } = await registerAndLogin(app);
    const novo = uniqueEmail();
    await changeEmail(headers, { currentPassword: senha, newEmail: novo });
    await esperaEmail(novo);
    clearOutbox();

    const reenvio = await app.inject({
      method: "POST",
      url: "/auth/resend-verification",
      headers,
    });
    expect(reenvio.statusCode).toBe(202);

    const enviado = await esperaEmail(novo);
    expect(enviado.to).toBe(novo);
    expect(enviado.to).not.toBe(user.email);
  });

  it("invalida o link de recuperação de senha pedido antes", async () => {
    const { user, headers } = await registerAndLogin(app);
    await esperaEmail(user.email); // o e-mail do cadastro
    clearOutbox();

    await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: user.email },
    });
    const tokenDeRecuperacao = extraiToken((await esperaEmail(user.email)).text);

    const novo = uniqueEmail();
    const troca = await changeEmail(headers, {
      currentPassword: senha,
      newEmail: novo,
    });
    expect(troca.statusCode).toBe(204);

    const recuperacao = await app.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: { token: tokenDeRecuperacao, newPassword: "outra-senha-456" },
    });
    expect(recuperacao.statusCode).toBe(400);
  });

  it("derruba as outras sessões e poupa a que fez a troca", async () => {
    const { user, headers } = await registerAndLogin(app);
    const outra = authHeaders(await login(app, user.email, senha));

    await changeEmail(headers, {
      currentPassword: senha,
      newEmail: uniqueEmail(),
    });

    const atual = await app.inject({ method: "GET", url: "/auth/me", headers });
    expect(atual.statusCode).toBe(200);

    const antiga = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: outra,
    });
    expect(antiga.statusCode).toBe(401);
  });

  it("loja já verificada recebe 409 e o e-mail não muda", async () => {
    const restaurant = await createRestaurant(app);

    const response = await changeEmail(restaurant.headers, {
      currentPassword: senha,
      newEmail: uniqueEmail(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe(
      "A troca de e-mail de uma conta já verificada ainda não está disponível",
    );
    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: restaurant.headers,
    });
    expect(me.json().email).toBe(restaurant.ownerEmail);
  });

  it("a verificação que cai DURANTE a troca não deixa trocar o e-mail", async () => {
    // A corrida de verdade: o hook resolve `emailVerified: false`, o bcrypt
    // segura a requisição por centenas de milissegundos, e nesse intervalo o
    // link antigo é aberto. Reproduzida na revisão da branch: a loja terminava
    // verificada com um endereço que ninguém provou. O `AuthContext` velho
    // (`emailVerified: false` numa loja que já verificou) é exatamente o que
    // a requisição atrasada tem em mãos — a rota não deixa montá-lo, o
    // serviço sim.
    const restaurant = await createRestaurant(app);
    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: restaurant.headers,
    });

    await expect(
      authService.changeEmail(
        {
          sessionId: randomUUID(),
          userId: me.json().id,
          restaurantId: restaurant.id,
          role: "owner",
          emailVerified: false,
        },
        senha,
        uniqueEmail(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const depois = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: restaurant.headers,
    });
    // o rollback desfaz tudo: o e-mail fica, e a sessão também
    expect(depois.statusCode).toBe(200);
    expect(depois.json().email).toBe(restaurant.ownerEmail);
  });

  it("senha atual errada é 401 e nada muda", async () => {
    const { user, headers } = await registerAndLogin(app);

    const response = await changeEmail(headers, {
      currentPassword: "senha-errada-999",
      newEmail: uniqueEmail(),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe("Senha atual incorreta");
    const me = await app.inject({ method: "GET", url: "/auth/me", headers });
    expect(me.json().email).toBe(user.email);
  });

  it("o mesmo e-mail é 409", async () => {
    const { user, headers } = await registerAndLogin(app);

    const response = await changeEmail(headers, {
      currentPassword: senha,
      newEmail: user.email,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("Este já é o e-mail cadastrado");
  });

  it("e-mail de outra conta viva é 409, não 500, e nada muda", async () => {
    const dona = await createRestaurant(app);
    const { user, headers } = await registerAndLogin(app);
    const outra = authHeaders(await login(app, user.email, senha));

    const response = await changeEmail(headers, {
      currentPassword: senha,
      newEmail: dona.ownerEmail,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe(
      `O e-mail "${dona.ownerEmail}" já está cadastrado`,
    );
    // o rollback desfaz tudo: nem a outra sessão cai
    const antiga = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: outra,
    });
    expect(antiga.statusCode).toBe(200);
    expect(antiga.json().email).toBe(user.email);
  });

  it("recusa e-mail malformado com 400", async () => {
    const { headers } = await registerAndLogin(app);

    const response = await changeEmail(headers, {
      currentPassword: senha,
      newEmail: "isto-nao-e-email",
    });

    expect(response.statusCode).toBe(400);
  });

  it("campo a mais no corpo é descartado, não gravado", async () => {
    // o validador do corpo descarta o que não está no schema
    // (`removeAdditional`), como nas outras rotas de autenticação
    const { user, headers } = await registerAndLogin(app);

    const response = await changeEmail(headers, {
      currentPassword: senha,
      newEmail: uniqueEmail(),
      role: "staff",
      name: "Outro Nome",
    });
    expect(response.statusCode).toBe(204);

    const me = await app.inject({ method: "GET", url: "/auth/me", headers });
    expect(me.json().role).toBe("owner");
    expect(me.json().name).toBe(user.name);
  });

  it("exige sessão", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/change-email",
      payload: { currentPassword: senha, newEmail: uniqueEmail() },
    });
    expect(response.statusCode).toBe(401);
  });

  it("a loja continua bloqueada e vazia depois da troca", async () => {
    const { restaurant, headers } = await registerAndLogin(app);
    await changeEmail(headers, {
      currentPassword: senha,
      newEmail: uniqueEmail(),
    });

    const produtos = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/products`,
      headers,
    });
    expect(produtos.statusCode).toBe(403);

    // a premissa da liberação de cadastro abandonado: a rota escreve só na
    // conta de quem chama, e a loja segue com exatamente um usuário
    const { rows } = await pool.query<{ total: string }>(
      "select count(*) as total from restaurant_users where restaurant_id = $1 and deleted_at is null",
      [restaurant.id],
    );
    expect(rows[0].total).toBe("1");
  });

  describe("e-mail preso por cadastro abandonado", () => {
    /** Envelhece o cadastro: a regra de abandono lê `restaurants.created_at`. */
    async function envelhece(restaurantId: string, dias: number) {
      await pool.query(
        "update restaurants set created_at = now() - make_interval(days => $2) where id = $1",
        [restaurantId, dias],
      );
    }

    it("libera o cadastro abandonado e faz a troca", async () => {
      const abandonado = await registerAndLogin(app);
      const { headers } = await registerAndLogin(app);
      // ⚠️ envelhece DEPOIS do segundo cadastro: os dois derivam o mesmo slug
      // do mesmo nome, e com o primeiro já abandonado seria o `register` a
      // liberá-lo pela colisão de slug — o teste passaria sem a troca de
      // e-mail liberar nada (foi assim que ele nasceu verde)
      await envelhece(abandonado.restaurant.id, 8);

      const response = await changeEmail(headers, {
        currentPassword: senha,
        newEmail: abandonado.user.email,
      });
      expect(response.statusCode).toBe(204);

      const me = await app.inject({ method: "GET", url: "/auth/me", headers });
      expect(me.json().email).toBe(abandonado.user.email);

      // quem estava no cadastro abandonado perde a sessão junto
      const expulso = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: abandonado.headers,
      });
      expect(expulso.statusCode).toBe(401);
    });

    it("NÃO libera cadastro não verificado recente", async () => {
      const recente = await registerAndLogin(app);
      const { headers } = await registerAndLogin(app);

      const response = await changeEmail(headers, {
        currentPassword: senha,
        newEmail: recente.user.email,
      });
      expect(response.statusCode).toBe(409);

      const intacto = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: recente.headers,
      });
      expect(intacto.statusCode).toBe(200);
    });

    it("NÃO libera loja verificada, por mais antiga que seja", async () => {
      const verificada = await createRestaurant(app);
      const { headers } = await registerAndLogin(app);
      await envelhece(verificada.id, 400);

      const response = await changeEmail(headers, {
        currentPassword: senha,
        newEmail: verificada.ownerEmail,
      });
      expect(response.statusCode).toBe(409);
    });

    it("quem corrige depois do sétimo dia não é liberado pela própria chamada", async () => {
      const { restaurant, headers } = await registerAndLogin(app);
      await envelhece(restaurant.id, 8);
      const novo = uniqueEmail();

      const response = await changeEmail(headers, {
        currentPassword: senha,
        newEmail: novo,
      });
      expect(response.statusCode).toBe(204);

      const me = await app.inject({ method: "GET", url: "/auth/me", headers });
      expect(me.statusCode).toBe(200);
      expect(me.json().email).toBe(novo);
    });
  });
});
