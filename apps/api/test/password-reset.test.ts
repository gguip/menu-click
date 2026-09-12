import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { clearOutbox, outbox } from "../src/email.ts";
import {
  buildTestApp,
  createRestaurant,
  uniqueEmail,
  validUserBody,
} from "./helpers.ts";

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

  /**
   * `POST /auth/reset-password` — a outra ponta do fluxo: trocar a senha com
   * o token que `/auth/forgot-password` mandou por e-mail.
   */
  describe("troca via POST /auth/reset-password", () => {
    /**
     * Extrai o token do link dentro do corpo do e-mail. O banco só guarda o
     * hash (ver `tokens.ts`), então o token só existe aqui — no texto que o
     * driver de console "enviou".
     */
    function extraiToken(texto: string): string {
      const encontrado = texto.match(/token=([^\s&]+)/);
      if (encontrado === null) {
        throw new Error("e-mail sem link de recuperação");
      }
      return decodeURIComponent(encontrado[1]);
    }

    /** Pede a recuperação e devolve o token já extraído do e-mail. */
    async function pedeTokenDeRecuperacao(email: string): Promise<string> {
      await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload: { email },
      });
      const enviado = await esperaEmail(email);
      return extraiToken(enviado.text);
    }

    function trocaSenha(token: string, newPassword: string) {
      return app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token, newPassword },
      });
    }

    it("troca a senha com o token e deixa entrar com a nova", async () => {
      const restaurant = await createRestaurant(app, { slug: "reseta-com-token" });
      const token = await pedeTokenDeRecuperacao(restaurant.ownerEmail);

      const reset = await trocaSenha(token, "senha-recuperada-123");
      expect(reset.statusCode).toBe(200);

      const loginNovo = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: restaurant.ownerEmail,
          password: "senha-recuperada-123",
        },
      });
      expect(loginNovo.statusCode).toBe(200);
    });

    it("a senha antiga para de funcionar", async () => {
      const restaurant = await createRestaurant(app, {
        slug: "reseta-senha-antiga-para",
      });
      const token = await pedeTokenDeRecuperacao(restaurant.ownerEmail);
      await trocaSenha(token, "senha-recuperada-123");

      const loginAntigo = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: restaurant.ownerEmail, password: validUserBody.password },
      });
      expect(loginAntigo.statusCode).toBe(401);
    });

    it("o token não serve duas vezes", async () => {
      const restaurant = await createRestaurant(app, {
        slug: "reseta-token-nao-repete",
      });
      const token = await pedeTokenDeRecuperacao(restaurant.ownerEmail);

      const primeira = await trocaSenha(token, "senha-recuperada-123");
      expect(primeira.statusCode).toBe(200);

      const segunda = await trocaSenha(token, "outra-senha-456");
      expect(segunda.statusCode).toBe(400);
    });

    /**
     * Envelhece a linha no BANCO em vez de esperar uma hora — esperar de
     * verdade é impossível, e manipular o relógio do processo seria frágil
     * (ver o aviso no topo do arquivo/no brief da Task 4).
     */
    it("token expirado não serve", async () => {
      const restaurant = await createRestaurant(app, {
        slug: "reseta-token-expirado",
      });
      const token = await pedeTokenDeRecuperacao(restaurant.ownerEmail);

      await pool.query(
        `update password_reset_tokens set expires_at = now() - interval '1 minute'
          where restaurant_user_id = (
            select id from restaurant_users where email = $1
          )`,
        [restaurant.ownerEmail],
      );

      const response = await trocaSenha(token, "senha-recuperada-123");
      expect(response.statusCode).toBe(400);
    });

    it("token inventado não serve", async () => {
      const response = await trocaSenha(
        "token-que-nunca-existiu",
        "senha-recuperada-123",
      );
      expect(response.statusCode).toBe(400);
    });

    it("a troca derruba TODAS as sessões", async () => {
      const restaurant = await createRestaurant(app, {
        slug: "reseta-derruba-sessoes",
      });
      // sessão aberta ANTES da recuperação — é ela que precisa parar de valer
      const token = await pedeTokenDeRecuperacao(restaurant.ownerEmail);

      await trocaSenha(token, "senha-recuperada-123");

      const me = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: restaurant.headers,
      });
      expect(me.statusCode).toBe(401);
    });

    it("a troca NÃO devolve sessão", async () => {
      const restaurant = await createRestaurant(app, {
        slug: "reseta-sem-sessao-na-resposta",
      });
      const token = await pedeTokenDeRecuperacao(restaurant.ownerEmail);

      const reset = await trocaSenha(token, "senha-recuperada-123");
      // devolver token aqui transformaria um e-mail interceptado em acesso
      // imediato, sem a segunda barreira de precisar usar a senha nova
      expect(JSON.stringify(reset.json())).not.toContain("token");
    });

    it("recusa senha maior que 72 bytes de forma honesta", async () => {
      const restaurant = await createRestaurant(app, {
        slug: "reseta-senha-longa-demais",
      });
      const token = await pedeTokenDeRecuperacao(restaurant.ownerEmail);

      // 40 letras "ç" são 80 bytes: o bcrypt ignoraria o resto em silêncio (S20)
      const response = await trocaSenha(token, "ç".repeat(40));
      expect(response.statusCode).toBe(400);
    });

    it("trocar a senha pelo caminho comum invalida o token pendente", async () => {
      const restaurant = await createRestaurant(app, {
        slug: "reseta-invalidado-por-troca-comum",
      });
      const token = await pedeTokenDeRecuperacao(restaurant.ownerEmail);

      const trocaComum = await app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers: restaurant.headers,
        payload: {
          currentPassword: validUserBody.password,
          newPassword: "senha-trocada-normal-123",
        },
      });
      expect(trocaComum.statusCode).toBe(204);

      const reset = await trocaSenha(token, "senha-recuperada-123");
      expect(reset.statusCode).toBe(400);
    });

    /**
     * Extra (além do brief): o usuário some DEPOIS do token emitido (removido
     * do restaurante), antes de o link ser usado. Sem checar o retorno de
     * `updatePasswordHash`, a troca responderia 200 mesmo sem gravar nada —
     * uma "senha trocada" que nunca aconteceu.
     */
    /**
     * 🚨 A corrida que só a concorrência genuína alcança.
     *
     * Todo teste sequencial de "não serve duas vezes" é barrado antes, pelo
     * filtro `used_at is null` do `findLiveByHash`. Quem fecha a corrida de
     * verdade é o `update ... where used_at is null` do `markUsed`, mais a
     * checagem do retorno dele — e nenhum teste da suíte falhava se essa
     * checagem fosse removida.
     *
     * ⚠️ O pool é aquecido ANTES da corrida. Com o pool frio, cada requisição
     * espera o handshake de uma conexão nova, e isso é lento o bastante para a
     * primeira transação inteira terminar antes de a segunda começar — o teste
     * passaria mesmo sem a proteção. É o alerta que o CLAUDE.md dá sobre o
     * teste de concorrência da confirmação de pedido.
     */
    it("duas trocas simultâneas com o mesmo token: só uma vence", async () => {
      const restaurant = await createRestaurant(app, { slug: "recupera-corrida" });
      const token = await pedeTokenDeRecuperacao(restaurant.ownerEmail);
      const novaSenha = "nova-senha-da-corrida-123";

      await Promise.all(
        Array.from({ length: 4 }, () => pool.query("select 1")),
      );
      const respostas = await Promise.all([
        trocaSenha(token, novaSenha),
        trocaSenha(token, novaSenha),
      ]);

      expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 400]);

      // a perdedora fez rollback: não sobrou meio-estado, e a senha nova entra
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: restaurant.ownerEmail, password: novaSenha },
      });
      expect(login.statusCode).toBe(200);
    });

    it("token de usuário removido depois de emitido não serve", async () => {
      const restaurant = await createRestaurant(app, {
        slug: "reseta-usuario-removido",
      });
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

      const token = await pedeTokenDeRecuperacao(staffEmail);

      const removed = await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/users/${staffId}`,
        headers: restaurant.headers,
      });
      expect(removed.statusCode).toBe(204);

      const response = await trocaSenha(token, "senha-recuperada-123");
      expect(response.statusCode).toBe(400);
    });

    /**
     * 🚨 Ponta a ponta, adversarial — o objetivo desta task.
     *
     * Cada peça do fluxo já tem teste isolado acima; o que falta é o passeio
     * INTEIRO como quem perdeu o acesso de verdade faria, encadeado numa
     * história só, seguido dos três ataques que o brief pede por nome: reusar
     * o link, tentar o link de outra pessoa, e pedir duas vezes e tentar o
     * primeiro link. Um teste isolado de "reuso" não prova que a senha final
     * continua sendo a que o dono escolheu — só que a segunda tentativa deu
     * 400. Aqui a prova é o login, não o status code.
     */
    describe("ponta a ponta: quem perdeu o acesso, e quem tenta abusar dele", () => {
      it("pede, lê o link, troca, entra com a nova — e a sessão de antes morre", async () => {
        const restaurant = await createRestaurant(app, {
          slug: "e2e-recupera-passeio-completo",
        });
        // a sessão que `createRestaurant` já abriu É a sessão "de antes da
        // recuperação" que precisa morrer — não precisa logar de novo para tê-la
        const sessaoDeAntes = restaurant.headers;

        const token = await pedeTokenDeRecuperacao(restaurant.ownerEmail);

        const reset = await trocaSenha(token, "senha-recuperada-e2e-123");
        expect(reset.statusCode).toBe(200);

        const loginNovo = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: {
            email: restaurant.ownerEmail,
            password: "senha-recuperada-e2e-123",
          },
        });
        expect(loginNovo.statusCode).toBe(200);
        const sessaoNova = {
          authorization: `Bearer ${loginNovo.json().token as string}`,
        };

        const loginAntigo = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: restaurant.ownerEmail, password: validUserBody.password },
        });
        expect(loginAntigo.statusCode).toBe(401);

        const meComSessaoDeAntes = await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: sessaoDeAntes,
        });
        expect(meComSessaoDeAntes.statusCode).toBe(401);

        // sanidade: a sessão NOVA de fato funciona (não é só a antiga que morreu)
        const meComSessaoNova = await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: sessaoNova,
        });
        expect(meComSessaoNova.statusCode).toBe(200);

        // ataque 1: reusar o link já consumido
        const reuso = await trocaSenha(token, "senha-do-invasor-123");
        expect(reuso.statusCode).toBe(400);

        // a prova de verdade não é o 400 do reuso — é que a senha continua
        // sendo a que o dono escolheu, e a do ataque nunca passou a valer
        const loginComSenhaDoAtaque = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: restaurant.ownerEmail, password: "senha-do-invasor-123" },
        });
        expect(loginComSenhaDoAtaque.statusCode).toBe(401);

        const loginAindaComANova = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: {
            email: restaurant.ownerEmail,
            password: "senha-recuperada-e2e-123",
          },
        });
        expect(loginAindaComANova.statusCode).toBe(200);
      });

      /**
       * Ataque 2: o link de outra pessoa. Como o corpo de `reset-password` é só
       * `{ token, newPassword }` — não existe campo de "qual conta" —, o único
       * jeito de um token abrir a conta errada seria um bug na consulta que o
       * resolve (ex.: esquecer o `where` e pegar a primeira linha). Duas contas
       * pedem recuperação quase ao mesmo tempo, e usar o token de uma nunca
       * pode mexer na senha nem nas sessões da outra.
       */
      it("o token de uma conta não abre nem mexe na de outra", async () => {
        const restauranteA = await createRestaurant(app, { slug: "e2e-conta-a" });
        const restauranteB = await createRestaurant(app, { slug: "e2e-conta-b" });

        const tokenA = await pedeTokenDeRecuperacao(restauranteA.ownerEmail);
        const tokenB = await pedeTokenDeRecuperacao(restauranteB.ownerEmail);

        const resetA = await trocaSenha(tokenA, "senha-nova-da-conta-a-123");
        expect(resetA.statusCode).toBe(200);

        // B não pediu nada ainda além do próprio token: a senha original
        // continua valendo, e a sessão que `createRestaurant` abriu para B
        // continua viva — o reset de A não pode ter tocado em nada de B
        const loginBComSenhaOriginal = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: restauranteB.ownerEmail, password: validUserBody.password },
        });
        expect(loginBComSenhaOriginal.statusCode).toBe(200);

        const meDeB = await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: restauranteB.headers,
        });
        expect(meDeB.statusCode).toBe(200);

        // o token de B continua vivo e serve — não foi consumido pelo reset de A
        const resetB = await trocaSenha(tokenB, "senha-nova-da-conta-b-123");
        expect(resetB.statusCode).toBe(200);

        const loginBComSenhaNova = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: {
            email: restauranteB.ownerEmail,
            password: "senha-nova-da-conta-b-123",
          },
        });
        expect(loginBComSenhaNova.statusCode).toBe(200);

        // e A continua com a senha que o reset dela definiu, não a de B
        const loginAComSenhaDeB = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: {
            email: restauranteA.ownerEmail,
            password: "senha-nova-da-conta-b-123",
          },
        });
        expect(loginAComSenhaDeB.statusCode).toBe(401);
      });

      /**
       * Ataque 3: pede duas vezes e tenta o link antigo.
       *
       * `"um pedido novo invalida o token anterior"`, lá em cima, só confere a
       * CONTAGEM de tokens vivos no banco — nunca chega a TENTAR trocar a senha
       * com o primeiro token. Esta é a diferença: tenta de verdade, e prova
       * pelo login que o ataque não teve efeito nenhum.
       */
      it("pede duas vezes: o primeiro link morre mesmo sem nunca ter sido usado", async () => {
        const restaurant = await createRestaurant(app, {
          slug: "e2e-pede-duas-vezes-tenta-a-primeira",
        });

        const tokenAntigo = await pedeTokenDeRecuperacao(restaurant.ownerEmail);
        // limpa o outbox ANTES do segundo pedido: sem isso, o próximo
        // `esperaEmail` (dentro de `pedeTokenDeRecuperacao`) poderia achar de
        // novo o e-mail do primeiro pedido, que já está no array, e devolver o
        // token ANTIGO como se fosse o novo
        clearOutbox();
        const tokenNovo = await pedeTokenDeRecuperacao(restaurant.ownerEmail);
        expect(tokenNovo).not.toBe(tokenAntigo);

        // ataque: usar o link que chegou primeiro, e que a pessoa pode muito
        // bem ainda ter aberto numa aba
        const ataqueComTokenAntigo = await trocaSenha(
          tokenAntigo,
          "senha-do-invasor-com-link-velho-123",
        );
        expect(ataqueComTokenAntigo.statusCode).toBe(400);

        // o legítimo, com o token que de fato vale, funciona normalmente
        const trocaLegitima = await trocaSenha(
          tokenNovo,
          "senha-legitima-do-dono-123",
        );
        expect(trocaLegitima.statusCode).toBe(200);

        const loginComSenhaDoAtaque = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: {
            email: restaurant.ownerEmail,
            password: "senha-do-invasor-com-link-velho-123",
          },
        });
        expect(loginComSenhaDoAtaque.statusCode).toBe(401);

        const loginComSenhaLegitima = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: restaurant.ownerEmail, password: "senha-legitima-do-dono-123" },
        });
        expect(loginComSenhaLegitima.statusCode).toBe(200);
      });
    });
  });

});
