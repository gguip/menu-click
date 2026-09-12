import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { clearOutbox, outbox } from "../src/email.ts";
import { buildTestApp, createRestaurant, uniqueEmail } from "./helpers.ts";

/**
 * `POST /auth/forgot-password`.
 *
 * A propriedade que importa aqui não é o caminho feliz — é que a rota se
 * comporta EXATAMENTE igual para e-mail que existe e para e-mail que não
 * existe: mesmo status, mesmo corpo, e o trabalho de verdade (achar o
 * usuário, criar o token, mandar o e-mail) acontece DEPOIS da resposta, fora
 * do que o cliente espera. Ver `requestPasswordReset` em `services/auth.ts`.
 *
 * ⚠️ Nenhum teste aqui mede TEMPO. A propriedade "o tempo não denuncia" é
 * estrutural (o trabalho não é aguardado pela rota), e um teste de relógio
 * seria instável por natureza. O que os testes prendem é o estrutural: mesma
 * resposta para os dois casos, e token criado só para quem existe de
 * verdade — verificado no BANCO, não pelo relógio.
 */
describe("recuperação de senha", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // O outbox é um array de módulo, fora do banco — o `truncate` do
  // `setup.ts` não o alcança. Sem isso, o e-mail de um teste apareceria no
  // `outbox.some(...)` do próximo.
  afterEach(() => {
    clearOutbox();
  });

  /** Espera o envio, que acontece FORA do caminho da resposta. */
  async function esperaEmail(paraQuem: string) {
    for (let i = 0; i < 50; i++) {
      const achado = outbox.findLast((email) => email.to === paraQuem);
      if (achado !== undefined) return achado;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`nenhum e-mail para ${paraQuem}`);
  }

  /**
   * Dá tempo para o trabalho assíncrono (disparado sem `await` pela rota)
   * terminar, antes de conferir uma AUSÊNCIA — de e-mail ou de linha no
   * banco. Não é medição de tempo (não compara duração nem infere nada dela):
   * é só a janela para um `.catch()` em segundo plano já ter rodado. Mesmo
   * papel do polling de `esperaEmail`, na direção contrária.
   */
  async function aguardaTrabalhoEmSegundoPlano() {
    await new Promise((r) => setTimeout(r, 300));
  }

  /** Tokens vivos de um e-mail, pelo join com `restaurant_users` — sem
   * precisar expor `userId` nos testes. */
  async function tokensVivos(email: string): Promise<number> {
    const { rows } = await pool.query<{ vivos: number }>(
      `select count(*)::int as vivos
         from password_reset_tokens t
         join restaurant_users u on u.id = t.restaurant_user_id
        where u.email = $1 and t.deleted_at is null`,
      [email],
    );
    return rows[0].vivos;
  }

  it("manda o link para quem existe", async () => {
    const restaurant = await createRestaurant(app, { slug: "recupera" });

    const response = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: restaurant.ownerEmail },
    });

    expect(response.statusCode).toBe(202);
    const email = await esperaEmail(restaurant.ownerEmail);
    expect(email.text).toContain("http");
  });

  it("responde igual para e-mail que não existe, e não manda nada", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "ninguem@exemplo.com" },
    });

    // 202 igual: 404 aqui seria um oráculo de quais e-mails estão cadastrados
    expect(response.statusCode).toBe(202);

    // Determinístico, sem espera nenhuma: para um e-mail que não existe em
    // NENHUMA linha de `restaurant_users`, nenhum token é criado não importa
    // quanto tempo se espere — o `truncate` do `setup.ts` garante a tabela
    // vazia antes deste teste, então a contagem é exata.
    const { rows } = await pool.query<{ vivos: number }>(
      "select count(*)::int as vivos from password_reset_tokens",
    );
    expect(rows[0].vivos).toBe(0);

    // Secundária, e com espera: o outbox também não pode ter recebido nada.
    await aguardaTrabalhoEmSegundoPlano();
    expect(outbox.some((e) => e.to === "ninguem@exemplo.com")).toBe(false);
  });

  it("não manda para usuário removido", async () => {
    const restaurant = await createRestaurant(app, { slug: "recupera-removido" });
    const staffEmail = uniqueEmail();

    const created = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/users`,
      headers: restaurant.headers,
      payload: {
        name: "Atendente",
        email: staffEmail,
        password: "senha-do-atendente-123",
      },
    });
    expect(created.statusCode).toBe(201);
    const staffId = created.json().id as string;

    const removed = await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}/users/${staffId}`,
      headers: restaurant.headers,
    });
    expect(removed.statusCode).toBe(204);

    const response = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: staffEmail },
    });
    expect(response.statusCode).toBe(202);

    await aguardaTrabalhoEmSegundoPlano();
    expect(outbox.some((e) => e.to === staffEmail)).toBe(false);
    expect(await tokensVivos(staffEmail)).toBe(0);
  });

  /**
   * O segundo nível do filtro, que o teste acima NÃO cobre.
   *
   * `findActiveByEmail` filtra `u.deleted_at is null` **e**
   * `r.deleted_at is null`. O teste de cima remove o usuário; este remove o
   * RESTAURANTE e deixa o usuário intacto. Sem ele, alguém que apagasse a
   * segunda condição num refactor não veria teste nenhum ficar vermelho — e a
   * recuperação viraria o caminho de volta para um restaurante que alguém
   * removeu de propósito.
   */
  it("não manda para dono de restaurante removido", async () => {
    const restaurant = await createRestaurant(app, { slug: "recupera-rest-removido" });

    const removed = await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
    });
    expect(removed.statusCode).toBe(204);

    const response = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: restaurant.ownerEmail },
    });
    expect(response.statusCode).toBe(202);

    await aguardaTrabalhoEmSegundoPlano();
    expect(outbox.some((e) => e.to === restaurant.ownerEmail)).toBe(false);
    expect(await tokensVivos(restaurant.ownerEmail)).toBe(0);
  });

  it("um pedido novo invalida o token anterior", async () => {
    const restaurant = await createRestaurant(app, { slug: "recupera-duplo" });

    await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: restaurant.ownerEmail },
    });
    await esperaEmail(restaurant.ownerEmail);

    // limpa o que já foi visto, para o próximo `esperaEmail` não achar de
    // novo o e-mail do primeiro pedido e seguir em frente cedo demais
    clearOutbox();

    await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: restaurant.ownerEmail },
    });
    await esperaEmail(restaurant.ownerEmail);

    // a asserção de "o token antigo não troca mais senha" é da Task 4; aqui
    // basta conferir que sobrou exatamente um token VIVO no banco
    expect(await tokensVivos(restaurant.ownerEmail)).toBe(1);
  });

  it("o token não aparece em lugar nenhum da resposta", async () => {
    const restaurant = await createRestaurant(app, {
      slug: "recupera-sem-token-na-resposta",
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: restaurant.ownerEmail },
    });

    const corpo = response.json();
    expect(JSON.stringify(corpo)).not.toContain("token");

    // Espera o trabalho em segundo plano terminar antes de o teste acabar:
    // sem isso, o `truncate` do `afterEach` (que apaga o usuário de verdade,
    // ao contrário do soft delete da API) corre com o `insert` ainda em
    // voo e produz um erro de chave estrangeira só de artefato de teste.
    await esperaEmail(restaurant.ownerEmail);
  });
});
