import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import {
  authHeaders,
  buildTestApp,
  login,
  registerRestaurant,
  verifyRestaurantEmail,
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

  /**
   * ⚠️ Verifica o e-mail pelo fluxo real antes de devolver: este arquivo cria
   * usuários adicionais e os testa em rotas escopadas em restaurante
   * (`/restaurants/:restaurantId/users`), que agora exigem loja verificada
   * (`routes/authenticate.ts`). Sem isto, toda ação bateria em 403 antes de
   * chegar na checagem de papel/acesso que o arquivo existe para testar.
   */
  async function cadastrar() {
    const { restaurant, user, password } = await registerRestaurant(app);
    await verifyRestaurantEmail(app, user.email);
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
    // ⚠️ Verifica o e-mail do dono antes de convidar: convidar já é uma rota
    // escopada em restaurante (`/restaurants/:restaurantId/users`), que agora
    // exige loja verificada — mesmo raciocínio do `cadastrar()` lá em cima.
    async function cenario() {
      const { restaurant, user, password } = await registerRestaurant(app);
      await verifyRestaurantEmail(app, user.email);
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
     * `restaurant_users` filtrando `deleted_at is null`
     * (`repositories/sessions.ts`). Este teste é o que garante que essa
     * propriedade não se perca numa refatoração da query.
     *
     * ⚠️ E quem a garante é a asserção da rota ESCOPADA, não a do
     * `/auth/me` — não troque uma pela outra. O `/auth/me` tem uma segunda
     * rede: a guarda defensiva de `getUser` (`services/auth.ts`) responde 401
     * quando o usuário não está mais vivo, então ele devolve 401 com o filtro
     * na query ou sem ele. Medido numa revisão: removendo
     * `and u.deleted_at is null` de `findActiveByTokenHash`, a suíte inteira
     * (567 testes) passava — o filtro que faz o token do removido parar de
     * valer em produtos, pedidos e usuários não tinha cobertura nenhuma no
     * projeto. Rota escopada não tem a segunda rede: se o token voltar a
     * resolver, ela responde 200.
     */
    it("a sessão do removido para de valer na hora", async () => {
      const { dono, staff, staffPassword } = await cenario();
      const token = await login(app, staff.email, staffPassword);
      const produtos = `/restaurants/${dono.restaurant.id}/products`;

      const antes = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: authHeaders(token),
      });
      expect(antes.statusCode).toBe(200);

      // e o atendente opera normalmente ENQUANTO existe: sem isto, o 401 de
      // baixo poderia ser falta de permissão em vez de sessão morta
      const operavaAntes = await app.inject({
        method: "GET",
        url: produtos,
        headers: authHeaders(token),
      });
      expect(operavaAntes.statusCode).toBe(200);

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

      // ⚠️ A asserção que prende o filtro da query de sessão (ver o docblock)
      const escopada = await app.inject({
        method: "GET",
        url: produtos,
        headers: authHeaders(token),
      });
      expect(escopada.statusCode).toBe(401);
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

  /**
   * O papel passou várias PRs sem ser editável: trocar era remover e convidar
   * de novo, e o convidado perdia a senha que já tinha.
   */
  describe("troca de papel", () => {
    async function cenario() {
      const { restaurant, user, password } = await registerRestaurant(app);
      await verifyRestaurantEmail(app, user.email);
      const dono = {
        restaurant,
        user,
        headers: authHeaders(await login(app, user.email, password)),
      };
      const convidar = async (role: "owner" | "staff") => {
        const email = `${role}-${Math.random().toString(36).slice(2)}@x.com`;
        const criado = await app.inject({
          method: "POST",
          url: `/restaurants/${restaurant.id}/users`,
          headers: dono.headers,
          payload: { name: "Convidado", email, password: "senha-do-convidado", role },
        });
        return {
          user: criado.json(),
          headers: authHeaders(await login(app, email, "senha-do-convidado")),
        };
      };
      const urlDe = (id: string) => `/restaurants/${restaurant.id}/users/${id}`;
      return { dono, convidar, urlDe };
    }

    /** Donos vivos da loja, lidos fora da API. */
    async function donosVivos(restaurantId: string): Promise<number> {
      const { rows } = await pool.query<{ donos: number }>(
        `select count(*)::int as donos from restaurant_users
          where restaurant_id = $1 and role = 'owner' and deleted_at is null`,
        [restaurantId],
      );
      return rows[0].donos;
    }

    it("200, e o staff promovido passa a administrar usuários na mesma sessão", async () => {
      const { dono, convidar, urlDe } = await cenario();
      const staff = await convidar("staff");

      const response = await app.inject({
        method: "PATCH",
        url: urlDe(staff.user.id),
        headers: dono.headers,
        payload: { role: "owner" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: staff.user.id, role: "owner" });
      expect(response.json().passwordHash).toBeUndefined();
      // a sessão é a de antes da troca: o papel vem do banco a cada requisição
      const lista = await app.inject({
        method: "GET",
        url: `/restaurants/${dono.restaurant.id}/users`,
        headers: staff.headers,
      });
      expect(lista.statusCode).toBe(200);
    });

    it("o dono rebaixado perde o acesso de dono na mesma sessão", async () => {
      const { dono, convidar, urlDe } = await cenario();
      const socio = await convidar("owner");

      const response = await app.inject({
        method: "PATCH",
        url: urlDe(socio.user.id),
        headers: dono.headers,
        payload: { role: "staff" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().role).toBe("staff");
      const lista = await app.inject({
        method: "GET",
        url: `/restaurants/${dono.restaurant.id}/users`,
        headers: socio.headers,
      });
      expect(lista.statusCode).toBe(403);
    });

    /**
     * A mesma regra da remoção, pelo mesmo motivo: como só dono muda papel, o
     * último dono nunca consegue deixar de ser dono.
     */
    it("409 ao tentar mudar o próprio papel", async () => {
      const { dono, urlDe } = await cenario();

      const response = await app.inject({
        method: "PATCH",
        url: urlDe(dono.user.id),
        headers: dono.headers,
        payload: { role: "staff" },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain("próprio papel");
    });

    it("staff NÃO muda o papel de ninguém — 403", async () => {
      const { dono, convidar, urlDe } = await cenario();
      const staff = await convidar("staff");

      const response = await app.inject({
        method: "PATCH",
        url: urlDe(dono.user.id),
        headers: staff.headers,
        payload: { role: "staff" },
      });

      expect(response.statusCode).toBe(403);
    });

    it("404 com id inexistente, com id que não é uuid e com usuário de outro restaurante", async () => {
      const { dono, urlDe } = await cenario();
      const outro = await cenario();
      const alheio = await outro.convidar("staff");

      for (const id of [NONEXISTENT_ID, "nao-e-uuid", alheio.user.id]) {
        const response = await app.inject({
          method: "PATCH",
          url: urlDe(id),
          headers: dono.headers,
          payload: { role: "owner" },
        });
        expect(response.statusCode).toBe(404);
      }
      const lista = await app.inject({
        method: "GET",
        url: `/restaurants/${outro.dono.restaurant.id}/users`,
        headers: outro.dono.headers,
      });
      const intacto = lista
        .json()
        .data.find((u: { id: string }) => u.id === alheio.user.id);
      expect(intacto.role).toBe("staff");
    });

    it("400 sem papel e com papel que não existe", async () => {
      const { dono, convidar, urlDe } = await cenario();
      const staff = await convidar("staff");

      for (const payload of [{}, { role: "admin" }]) {
        const response = await app.inject({
          method: "PATCH",
          url: urlDe(staff.user.id),
          headers: dono.headers,
          payload,
        });
        expect(response.statusCode).toBe(400);
      }
    });

    it("só o papel muda: nome e e-mail no corpo são descartados", async () => {
      const { dono, convidar, urlDe } = await cenario();
      const staff = await convidar("staff");

      const response = await app.inject({
        method: "PATCH",
        url: urlDe(staff.user.id),
        headers: dono.headers,
        payload: { role: "owner", name: "Outro nome", email: "outro@x.com" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        role: "owner",
        name: staff.user.name,
        email: staff.user.email,
      });
    });

    it("pedir o papel que a pessoa já tem é 200 e não muda nada", async () => {
      const { dono, convidar, urlDe } = await cenario();
      const staff = await convidar("staff");

      const response = await app.inject({
        method: "PATCH",
        url: urlDe(staff.user.id),
        headers: dono.headers,
        payload: { role: "staff" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().role).toBe("staff");
    });

    /**
     * "Ninguém muda o próprio papel" não basta sozinho: dois donos se
     * rebaixando ao mesmo tempo passariam os dois pela checagem do hook (feita
     * com o papel lido antes) e a loja ficaria sem dono nenhum — sem quem
     * convide, promova ou a encerre. O serviço trava as duas linhas e relê o
     * papel de quem pede.
     */
    it("dois donos se rebaixando ao mesmo tempo: só um consegue, e sobra um dono", async () => {
      const { dono, convidar, urlDe } = await cenario();
      const socio = await convidar("owner");

      // pool frio serializa as duas por acidente, e o teste passaria sem a trava
      await Promise.all(Array.from({ length: 4 }, () => pool.query("select 1")));
      const respostas = await Promise.all([
        app.inject({
          method: "PATCH",
          url: urlDe(socio.user.id),
          headers: dono.headers,
          payload: { role: "staff" },
        }),
        app.inject({
          method: "PATCH",
          url: urlDe(dono.user.id),
          headers: socio.headers,
          payload: { role: "staff" },
        }),
      ]);

      expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 403]);
      expect(await donosVivos(dono.restaurant.id)).toBe(1);
    });

    /**
     * A remoção entra na mesma fila. Sem isso a troca de papel abriria um
     * buraco novo: A rebaixa B enquanto B remove A, e sobra só um staff.
     */
    it("um dono rebaixa o outro enquanto é removido por ele: sobra um dono", async () => {
      const { dono, convidar, urlDe } = await cenario();
      const socio = await convidar("owner");

      await Promise.all(Array.from({ length: 4 }, () => pool.query("select 1")));
      const [rebaixa, remove] = await Promise.all([
        app.inject({
          method: "PATCH",
          url: urlDe(socio.user.id),
          headers: dono.headers,
          payload: { role: "staff" },
        }),
        app.inject({
          method: "DELETE",
          url: urlDe(dono.user.id),
          headers: socio.headers,
        }),
      ]);

      expect([rebaixa.statusCode, remove.statusCode]).toContain(403);
      expect(await donosVivos(dono.restaurant.id)).toBe(1);
    });

    it("dois donos se removendo ao mesmo tempo: só um consegue", async () => {
      const { dono, convidar, urlDe } = await cenario();
      const socio = await convidar("owner");

      await Promise.all(Array.from({ length: 4 }, () => pool.query("select 1")));
      const respostas = await Promise.all([
        app.inject({ method: "DELETE", url: urlDe(socio.user.id), headers: dono.headers }),
        app.inject({ method: "DELETE", url: urlDe(dono.user.id), headers: socio.headers }),
      ]);

      expect(respostas.map((r) => r.statusCode).sort()).toEqual([204, 403]);
      expect(await donosVivos(dono.restaurant.id)).toBe(1);
    });
  });
});
