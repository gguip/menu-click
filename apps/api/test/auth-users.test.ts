import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authHeaders,
  buildTestApp,
  login,
  registerRestaurant,
} from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Recuperação de acesso: trocar a própria senha e ter mais de um login.
 *
 * Até esta PR o restaurante tinha exatamente um usuário, criado no cadastro, e
 * nenhuma forma de trocar a senha — quem a esquecesse perdia o restaurante,
 * sem caminho de volta pela API.
 */
describe("acesso ao painel", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function cadastrar() {
    const { restaurant, user, password } = await registerRestaurant(app);
    const token = await login(app, user.email, password);
    return { restaurant, user, password, token, headers: authHeaders(token) };
  }

  describe("POST /auth/change-password", () => {
    it("204, e a senha nova passa a valer", async () => {
      const { user, password, headers } = await cadastrar();

      const troca = await app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers,
        payload: { currentPassword: password, newPassword: "senha-nova-4567" },
      });
      expect(troca.statusCode).toBe(204);

      const comNova = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: user.email, password: "senha-nova-4567" },
      });
      const comAntiga = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: user.email, password },
      });

      expect(comNova.statusCode).toBe(200);
      expect(comAntiga.statusCode).toBe(401);
    });

    /**
     * Sem exigir a senha atual, um token roubado trocaria a senha e trancaria
     * o dono para fora — o pior resultado possível de um vazamento de token.
     */
    it("401 com a senha atual errada, e nada muda", async () => {
      const { user, password, headers } = await cadastrar();

      const response = await app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers,
        payload: {
          currentPassword: "não é a senha",
          newPassword: "senha-nova-4567",
        },
      });

      expect(response.statusCode).toBe(401);
      const aindaEntra = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: user.email, password },
      });
      expect(aindaEntra.statusCode).toBe(200);
    });

    /**
     * Trocar senha é o que se faz ao desconfiar de vazamento. Se as outras
     * sessões continuassem valendo, o gesto não resolveria nada.
     */
    it("derruba as outras sessões e mantém a atual", async () => {
      const { user, password, headers } = await cadastrar();
      // uma segunda sessão, como se fosse outro aparelho
      const outroToken = await login(app, user.email, password);

      await app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers,
        payload: { currentPassword: password, newPassword: "senha-nova-4567" },
      });

      const atual = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers,
      });
      const outra = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: authHeaders(outroToken),
      });

      expect(atual.statusCode).toBe(200);
      expect(outra.statusCode).toBe(401);
    });

    it("400 com senha nova curta demais", async () => {
      const { password, headers } = await cadastrar();

      const response = await app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers,
        payload: { currentPassword: password, newPassword: "curta" },
      });

      expect(response.statusCode).toBe(400);
    });

    /** O bcrypt ignora tudo depois do byte 72, em silêncio (S20). */
    it("400 com senha nova acima de 72 bytes", async () => {
      const { password, headers } = await cadastrar();

      const response = await app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers,
        // 40 letras "ç" são 80 bytes em UTF-8
        payload: { currentPassword: password, newPassword: "ç".repeat(40) },
      });

      expect(response.statusCode).toBe(400);
    });

    it("401 sem sessão", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/change-password",
        payload: { currentPassword: "x", newPassword: "senha-nova-4567" },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("usuários do restaurante", () => {
    /** Cria um staff e devolve as credenciais dele. */
    async function convidar(
      dono: Awaited<ReturnType<typeof cadastrar>>,
      overrides: Record<string, unknown> = {},
    ) {
      const payload = {
        name: "Atendente",
        email: `atendente-${Math.random().toString(36).slice(2)}@x.com`,
        password: "senha-do-atendente",
        ...overrides,
      };
      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${dono.restaurant.id}/users`,
        headers: dono.headers,
        payload,
      });
      return { response, payload };
    }

    it("o dono convida alguém, que nasce staff", async () => {
      const dono = await cadastrar();

      const { response } = await convidar(dono);

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        role: "staff",
        restaurantId: dono.restaurant.id,
      });
      expect(response.json().password).toBeUndefined();
      expect(response.json().passwordHash).toBeUndefined();
    });

    it("o convidado consegue entrar e trabalhar", async () => {
      const dono = await cadastrar();
      const { payload } = await convidar(dono);

      const token = await login(app, payload.email as string, payload.password as string);
      const produto = await app.inject({
        method: "POST",
        url: `/restaurants/${dono.restaurant.id}/products`,
        headers: authHeaders(token),
        payload: { name: "Guioza", priceInCents: 2490 },
      });

      expect(produto.statusCode).toBe(201);
    });

    it("dá para convidar outro dono, explicitamente", async () => {
      const dono = await cadastrar();

      const { response } = await convidar(dono, { role: "owner" });

      expect(response.json().role).toBe("owner");
    });

    it("409 com e-mail já em uso", async () => {
      const dono = await cadastrar();

      const { response } = await convidar(dono, { email: dono.user.email });

      expect(response.statusCode).toBe(409);
    });

    /** Administrar usuários é uma das duas ações que o papel restringe. */
    it("staff NÃO convida ninguém — 403", async () => {
      const dono = await cadastrar();
      const { payload } = await convidar(dono);
      const token = await login(app, payload.email as string, payload.password as string);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${dono.restaurant.id}/users`,
        headers: authHeaders(token),
        payload: {
          name: "Outro",
          email: "outro@x.com",
          password: "senha-do-outro-1",
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("staff também não lista os usuários", async () => {
      const dono = await cadastrar();
      const { payload } = await convidar(dono);
      const token = await login(app, payload.email as string, payload.password as string);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${dono.restaurant.id}/users`,
        headers: authHeaders(token),
      });

      expect(response.statusCode).toBe(403);
    });

    it("a listagem traz o dono e os convidados, sem segredo nenhum", async () => {
      const dono = await cadastrar();
      await convidar(dono);

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${dono.restaurant.id}/users`,
        headers: dono.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(2);
      expect(response.json().data.map((u: { role: string }) => u.role)).toEqual([
        "owner",
        "staff",
      ]);
      expect(JSON.stringify(response.json())).not.toContain("password");
    });

    it("usuário de outro restaurante não aparece nem some", async () => {
      const primeiro = await cadastrar();
      const segundo = await cadastrar();

      const lista = await app.inject({
        method: "GET",
        url: `/restaurants/${primeiro.restaurant.id}/users`,
        headers: primeiro.headers,
      });
      const remocao = await app.inject({
        method: "DELETE",
        url: `/restaurants/${primeiro.restaurant.id}/users/${segundo.user.id}`,
        headers: primeiro.headers,
      });

      expect(lista.json().data).toHaveLength(1);
      expect(remocao.statusCode).toBe(404);
    });
  });

  describe("remoção de usuário", () => {
    async function cenario() {
      const { restaurant, user, password } = await registerRestaurant(app);
      const dono = {
        restaurant,
        user,
        password,
        headers: authHeaders(await login(app, user.email, password)),
      };
      const email = `atendente-${Math.random().toString(36).slice(2)}@x.com`;
      const criado = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/users`,
        headers: dono.headers,
        payload: { name: "Atendente", email, password: "senha-do-atendente" },
      });
      return { dono, staff: criado.json(), staffPassword: "senha-do-atendente" };
    }

    it("204, e o removido some da lista", async () => {
      const { dono, staff } = await cenario();

      const response = await app.inject({
        method: "DELETE",
        url: `/restaurants/${dono.restaurant.id}/users/${staff.id}`,
        headers: dono.headers,
      });
      expect(response.statusCode).toBe(204);

      const lista = await app.inject({
        method: "GET",
        url: `/restaurants/${dono.restaurant.id}/users`,
        headers: dono.headers,
      });
      expect(lista.json().data).toHaveLength(1);
    });

    /**
     * Não é preciso revogar as sessões na mão: a resolução do token junta
     * `restaurant_users` filtrando `deleted_at is null`. Este teste é o que
     * garante que essa propriedade não se perca numa refatoração da query.
     */
    it("a sessão do removido para de valer na hora", async () => {
      const { dono, staff, staffPassword } = await cenario();
      const token = await login(app, staff.email, staffPassword);

      const antes = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: authHeaders(token),
      });
      expect(antes.statusCode).toBe(200);

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${dono.restaurant.id}/users/${staff.id}`,
        headers: dono.headers,
      });

      const depois = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: authHeaders(token),
      });
      expect(depois.statusCode).toBe(401);
    });

    /**
     * A regra impede alguém de se trancar para fora — e, como só `owner`
     * remove usuário, garante de quebra que o restaurante nunca fica sem
     * nenhum dono.
     */
    it("409 ao tentar remover a si mesmo", async () => {
      const { dono } = await cenario();

      const response = await app.inject({
        method: "DELETE",
        url: `/restaurants/${dono.restaurant.id}/users/${dono.user.id}`,
        headers: dono.headers,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain("si mesmo");
    });

    it("um dono remove outro dono", async () => {
      const { dono } = await cenario();
      const outro = await app.inject({
        method: "POST",
        url: `/restaurants/${dono.restaurant.id}/users`,
        headers: dono.headers,
        payload: {
          name: "Sócia",
          email: `socia-${Math.random().toString(36).slice(2)}@x.com`,
          password: "senha-da-socia-1",
          role: "owner",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/restaurants/${dono.restaurant.id}/users/${outro.json().id}`,
        headers: dono.headers,
      });

      expect(response.statusCode).toBe(204);
    });

    it("404 com id inexistente e com id que não é uuid", async () => {
      const { dono } = await cenario();

      for (const id of [NONEXISTENT_ID, "nao-e-uuid"]) {
        const response = await app.inject({
          method: "DELETE",
          url: `/restaurants/${dono.restaurant.id}/users/${id}`,
          headers: dono.headers,
        });
        expect(response.statusCode).toBe(404);
      }
    });

    it("remover duas vezes é 404 na segunda", async () => {
      const { dono, staff } = await cenario();
      const url = `/restaurants/${dono.restaurant.id}/users/${staff.id}`;

      await app.inject({ method: "DELETE", url, headers: dono.headers });
      const segunda = await app.inject({
        method: "DELETE",
        url,
        headers: dono.headers,
      });

      expect(segunda.statusCode).toBe(404);
    });
  });
});
