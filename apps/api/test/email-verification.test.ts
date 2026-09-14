import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { escapeIdentifier } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drainBackgroundWork } from "../src/background.ts";
import { pool } from "../src/db/pool.ts";
import { clearOutbox, outbox } from "../src/email.ts";
import {
  GRADE_SEMPRE_ABERTA,
  buildTestApp,
  createProduct,
  createRestaurant,
  esperaEmail,
  extraiToken,
  registerAndLogin,
  registerResponse,
  validCustomerBody,
  validDeliveryAddress,
  validProductBody,
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

    it("não diz 'painel liberado' quando a loja sumiu, nem queima o token", async () => {
      // O estado é alcançável desde a liberação de cadastro abandonado: a loja
      // que ninguém verificou é justamente a que a colisão de um cadastro novo
      // remove, e justamente o dono dela é quem pode clicar no link atrasado.
      // A corrida real é o commit da limpeza caindo entre o `findById` (fora
      // da transação) e o `markEmailVerified` (dentro); aqui o mesmo caminho é
      // alcançado sem corrida, removendo só o restaurante — o usuário
      // continua vivo, que é o que o `findById` já tinha visto.
      const { restaurant, user } = await registerAndLogin(app);
      const token = extraiToken((await esperaEmail(user.email)).text);

      await pool.query(
        `update restaurants set deleted_at = now() where id = $1`,
        [restaurant.id],
      );

      const response = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token },
      });
      expect(response.statusCode).toBe(400);

      // e o link de uso único NÃO foi gasto: o rollback o desqueima, senão a
      // pessoa perderia a única credencial que tinha por uma verificação que
      // não aconteceu
      const { rows } = await pool.query(
        `select used_at is null as intacto from email_verification_tokens
          where restaurant_user_id = $1`,
        [user.id],
      );
      expect(rows[0].intacto).toBe(true);
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

  /**
   * Task 5 do plano: quem se cadastra e nunca verifica segura duas coisas
   * escassas — o slug e o e-mail —, e a verificação torna o abandono mais
   * provável, porque cria um passo a mais onde desistir. A limpeza é
   * preguiçosa: acontece na colisão seguinte, que é exatamente quando importa.
   *
   * ⚠️ Nenhum teste aqui espera o relógio. O cadastro é envelhecido no BANCO
   * (`created_at = now() - interval '8 days'`), o mesmo padrão do teste de
   * token expirado acima.
   */
  describe("cadastro abandonado libera slug e e-mail", () => {
    it("libera o slug de cadastro abandonado", async () => {
      const { restaurant } = await registerAndLogin(app, {
        restaurant: { slug: "abandonada" },
      });
      // envelhece o cadastro em vez de esperar 7 dias
      await pool.query(
        `update restaurants set created_at = now() - interval '8 days' where id = $1`,
        [restaurant.id],
      );

      const novo = await registerResponse(app, { slug: "abandonada" });

      expect(novo.statusCode).toBe(201);
      expect(novo.json().restaurant.slug).toBe("abandonada");
      // é outro cadastro, não o antigo revivido
      expect(novo.json().restaurant.id).not.toBe(restaurant.id);
    });

    it("libera o slug DERIVADO do nome, sem sufixo de desempate", async () => {
      // É o exemplo que a spec usa para justificar a feature: "a segunda
      // 'Pizzaria do João' ganha sufixo por causa de uma primeira que nunca
      // existiu de fato". O teste acima cobre o slug EXPLÍCITO, que é o outro
      // ramo do `create()` — este cobre o derivado, e sem ele trocar
      // `tryInsertReleasingAbandoned` por `tryInsert` no laço do sufixo passa
      // despercebido.
      const { restaurant } = await registerAndLogin(app, {
        restaurant: { name: "Pizzaria do João" },
      });
      expect(restaurant.slug).toBe("pizzaria-do-joao"); // sem sufixo: é o 1º

      await pool.query(
        `update restaurants set created_at = now() - interval '8 days' where id = $1`,
        [restaurant.id],
      );

      // mesmo NOME, nenhum slug enviado: quem resolve o endereço é o servidor
      const novo = await registerResponse(app, { name: "Pizzaria do João" });

      expect(novo.statusCode).toBe(201);
      // o slug base de volta, e não `pizzaria-do-joao-a1b2c3`
      expect(novo.json().restaurant.slug).toBe("pizzaria-do-joao");
    });

    it("libera o e-mail de cadastro abandonado", async () => {
      // o caso MAIS comum: a pessoa não recebeu o e-mail e tenta de novo
      const { user } = await registerAndLogin(app, {
        restaurant: { slug: "sem-o-email" },
      });
      await pool.query(
        `update restaurants set created_at = now() - interval '8 days'
          where id = (select restaurant_id from restaurant_users where id = $1)`,
        [user.id],
      );

      // slug diferente de propósito: quem falha aqui é o e-mail, e só ele
      const novo = await registerResponse(
        app,
        { slug: "sem-o-email-de-novo" },
        { email: user.email },
      );

      expect(novo.statusCode).toBe(201);
      expect(novo.json().user.email).toBe(user.email);
      expect(novo.json().user.id).not.toBe(user.id);
    });

    it("o 409 do e-mail desfaz a liberação do slug", async () => {
      // ⚠️ A liberação roda DENTRO da transação de quem chamou (D3), e é isso
      // que este teste prende. Se ela abrisse transação própria, o cadastro
      // abaixo — que libera o slug e só DEPOIS descobre que o e-mail está
      // ocupado por uma conta viva — responderia 409 com o cadastro abandonado
      // já apagado para sempre: perda de dado numa requisição que não criou
      // nada.
      const { restaurant: abandonado, user: donoAbandonado } =
        await registerAndLogin(app, { restaurant: { slug: "quase-liberada" } });
      await pool.query(
        `update restaurants set created_at = now() - interval '8 days' where id = $1`,
        [abandonado.id],
      );

      // o e-mail vem de uma loja VIVA e verificada: o slug libera, o e-mail não
      const viva = await createRestaurant(app);

      const response = await registerResponse(
        app,
        { slug: "quase-liberada" },
        { email: viva.ownerEmail },
      );
      expect(response.statusCode).toBe(409);

      // e o abandonado continua de pé, restaurante E usuário
      const { rows } = await pool.query(
        `select
           (select deleted_at is null from restaurants where id = $1) as loja_viva,
           (select deleted_at is null from restaurant_users where id = $2) as dono_vivo`,
        [abandonado.id, donoAbandonado.id],
      );
      expect(rows[0].loja_viva).toBe(true);
      expect(rows[0].dono_vivo).toBe(true);
    });

    it("NÃO libera cadastro recente", async () => {
      // 7 dias ainda não passaram: o slug ganha sufixo, o e-mail é 409
      const { restaurant, user } = await registerAndLogin(app, {
        restaurant: { name: "Pizzaria Recente" },
      });

      const mesmoNome = await registerResponse(app, { name: "Pizzaria Recente" });
      expect(mesmoNome.statusCode).toBe(201);
      expect(mesmoNome.json().restaurant.slug).not.toBe(restaurant.slug);
      expect(mesmoNome.json().restaurant.slug).toMatch(/^pizzaria-recente-/);

      const mesmoEmail = await registerResponse(app, {}, { email: user.email });
      expect(mesmoEmail.statusCode).toBe(409);
    });

    it("NÃO libera cadastro verificado, por mais antigo que seja", async () => {
      // envelhece um restaurante VERIFICADO e confirma que ele não é tocado
      const restaurante = await createRestaurant(app, { slug: "veterana" });
      await pool.query(
        `update restaurants set created_at = now() - interval '400 days' where id = $1`,
        [restaurante.id],
      );

      const mesmoSlug = await registerResponse(app, { slug: "veterana" });
      expect(mesmoSlug.statusCode).toBe(409);

      const mesmoEmail = await registerResponse(
        app,
        { slug: "outra-veterana" },
        { email: restaurante.ownerEmail },
      );
      expect(mesmoEmail.statusCode).toBe(409);

      // e a loja continua de pé, atendendo pelo mesmo slug
      const response = await app.inject({ method: "GET", url: "/menu/veterana" });
      expect(response.statusCode).toBe(200);
    });
  });

  /**
   * O caminho inteiro numa peça só — e os ataques contra ele.
   *
   * Os blocos acima cobrem cada peça isolada: o 403 do hook, o 404 do
   * cardápio, o token, o reenvio, a liberação do cadastro abandonado. Este
   * existe porque "cada peça funciona" não é a mesma afirmação que "a loja
   * nova chega do cadastro até o primeiro pedido" — entre as peças há ordem,
   * estado e credencial trocando de mão, e é aí que ninguém estava olhando.
   */
  describe("ponta a ponta: do cadastro ao primeiro pedido", () => {
    /** O gesto que a pessoa faz ao clicar no link do e-mail. */
    const verifica = (token: string) =>
      app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token },
      });

    /**
     * Quando a loja provou o e-mail. Vai direto ao banco porque a API não
     * expõe a data — o `/auth/me` devolve só o booleano (S10).
     */
    const verificadoEm = async (restaurantId: string) => {
      const { rows } = await pool.query(
        `select email_verified_at from restaurants where id = $1`,
        [restaurantId],
      );
      return rows[0].email_verified_at as Date;
    };

    it("a loja nova: bloqueada, invisível, e liberada pelo link do e-mail", async () => {
      const { restaurant, user, headers } = await registerAndLogin(app, {
        restaurant: { slug: "cantina-da-esquina" },
      });

      // 1. tenta operar antes de verificar: 403 — e a mensagem diz ONDE fica o
      // caminho de volta. Sem isso o painel só sabe que não pode, e a pessoa
      // que nunca recebeu o e-mail não tem o que clicar (S30)
      const antes = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/products`,
        headers,
        payload: validProductBody,
      });
      expect(antes.statusCode).toBe(403);
      expect(antes.json().message).toContain("/auth/resend-verification");

      // 2. tenta abrir o PRÓPRIO cardápio: 404. É a loja dela, ela está
      // logada, e mesmo assim o endereço público não existe
      const cardapioAntes = await app.inject({
        method: "GET",
        url: "/menu/cantina-da-esquina",
      });
      expect(cardapioAntes.statusCode).toBe(404);

      // 3. o link chega por e-mail, e o token só existe ali: o banco guarda o
      // hash (`src/tokens.ts`)
      const token = extraiToken((await esperaEmail(user.email)).text);

      // 4. verifica — sem sessão nenhuma no caminho: é o token que prova quem é
      expect((await verifica(token)).statusCode).toBe(200);

      // 5. opera: a MESMA requisição do passo 1, com a MESMA sessão — a
      // verificação libera o que já existe, sem ninguém ter que entrar de
      // novo. (Que ela não devolve credencial nova é OUTRA propriedade, presa
      // pelo teste "verificar não devolve sessão" e pelo `schema.response` da
      // rota: reusar a sessão antiga passaria igual se o verify devolvesse
      // token.)
      const produto = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/products`,
        headers,
        payload: validProductBody,
      });
      expect(produto.statusCode).toBe(201);

      const grade = await app.inject({
        method: "PUT",
        url: `/restaurants/${restaurant.id}/opening-hours`,
        headers,
        payload: { openingHours: GRADE_SEMPRE_ABERTA },
      });
      expect(grade.statusCode).toBe(200);

      // 6. aparece: o cardápio abre, e com o produto dentro
      const cardapio = await app.inject({
        method: "GET",
        url: "/menu/cantina-da-esquina/products",
      });
      expect(cardapio.statusCode).toBe(200);
      const secoes = cardapio.json().data as { products: { name: string }[] }[];
      const nomes = secoes.flatMap((secao) => secao.products.map((p) => p.name));
      expect(nomes).toContain(validProductBody.name);

      // 7. e o cliente do QR consegue pedir. A criação de pedido é o único
      // caminho público que NÃO herda o filtro do slug (ela resolve a loja por
      // id, com um assert próprio em `services/orders.ts`): este passo é o lado
      // positivo do mesmo assert que o teste "e não dá para criar pedido nela"
      // prende pelo lado negativo.
      const pedido = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: {
          type: "dine_in",
          customer: validCustomerBody,
          items: [{ productId: produto.json().id, quantity: 1 }],
          paymentMethod: "cash",
        },
      });
      expect(pedido.statusCode).toBe(201);
    });

    it("reusar o link não desfaz nada — e continua sem servir", async () => {
      const { restaurant, user, headers } = await registerAndLogin(app);
      const token = extraiToken((await esperaEmail(user.email)).text);

      expect((await verifica(token)).statusCode).toBe(200);
      const segunda = await verifica(token);
      expect(segunda.statusCode).toBe(400);

      // o que o teste do uso único não olha: a recusa não mexeu na loja. Um
      // clique repetido no mesmo link do e-mail — que é o jeito mais provável
      // de alguém cair no 400 — não pode devolver o painel ao estado bloqueado
      const produtos = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/products`,
        headers,
      });
      expect(produtos.statusCode).toBe(200);
    });

    it("o link de uma loja não verifica a outra", async () => {
      const alvo = await registerAndLogin(app, {
        restaurant: { slug: "loja-alvo" },
      });
      const vizinha = await registerAndLogin(app, {
        restaurant: { slug: "loja-vizinha" },
      });

      const tokenDaVizinha = extraiToken(
        (await esperaEmail(vizinha.user.email)).text,
      );
      expect((await verifica(tokenDaVizinha)).statusCode).toBe(200);

      // a vizinha abriu...
      expect(
        (await app.inject({ method: "GET", url: "/menu/loja-vizinha" }))
          .statusCode,
      ).toBe(200);

      // ...e o alvo continua exatamente como estava. O token aponta para o
      // USUÁRIO que provou o endereço, e quem é marcado é o restaurante DELE:
      // não existe token que libere loja de terceiro
      const painel = await app.inject({
        method: "GET",
        url: `/restaurants/${alvo.restaurant.id}/products`,
        headers: alvo.headers,
      });
      expect(painel.statusCode).toBe(403);
      expect(
        (await app.inject({ method: "GET", url: "/menu/loja-alvo" })).statusCode,
      ).toBe(404);
    });

    it("o reenvio na loja já verificada não manda nada, e o carimbo fica onde estava", async () => {
      const { restaurant, user, headers } = await registerAndLogin(app);
      const primeiro = extraiToken((await esperaEmail(user.email)).text);
      expect((await verifica(primeiro)).statusCode).toBe(200);
      clearOutbox();

      const carimbo = await verificadoEm(restaurant.id);

      // a resposta é a MESMA da loja não verificada, de propósito: o reenvio
      // não é oráculo de estado nenhum
      const reenvio = await app.inject({
        method: "POST",
        url: "/auth/resend-verification",
        headers,
      });
      expect(reenvio.statusCode).toBe(202);

      // o envio roda DEPOIS da resposta: sem drenar, conferir a caixa aqui só
      // provaria que o teste chegou antes dele
      await drainBackgroundWork();
      expect(outbox.filter((email) => email.to === user.email)).toEqual([]);

      // e é por não existir link novo que o carimbo não tem como andar — antes
      // desta guarda, reenviar e verificar de novo reescrevia
      // `email_verified_at`, e "quando esta loja provou o e-mail" deixava de
      // ser respondível
      expect(await verificadoEm(restaurant.id)).toEqual(carimbo);

      // a guarda não trocou o 202 por recusa nem mexeu no acesso
      const produtos = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/products`,
        headers,
      });
      expect(produtos.statusCode).toBe(200);
    });

    it("a sessão verificada não opera na loja de outro", async () => {
      const minha = await createRestaurant(app);
      const { restaurant: alheia } = await registerAndLogin(app, {
        restaurant: { slug: "alheia" },
      });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${alheia.id}/products`,
        headers: minha.headers,
        payload: validProductBody,
      });

      // 404, e não 403: o escopo é conferido ANTES da verificação no hook, e
      // essa ordem é o que impede o status de contar que aquela loja existe
      expect(response.statusCode).toBe(404);
    });

    it("ninguém pede na loja que ainda não verificou, nem com produto de outra", async () => {
      const minha = await createRestaurant(app);
      const produto = await createProduct(app, minha);
      const { restaurant: bloqueada } = await registerAndLogin(app);

      const pedido = await app.inject({
        method: "POST",
        url: `/restaurants/${bloqueada.id}/orders`,
        payload: {
          type: "dine_in",
          customer: validCustomerBody,
          items: [{ productId: produto.id, quantity: 1 }],
          paymentMethod: "cash",
        },
      });

      // 404 pela LOJA, não pelo produto: a visibilidade é conferida antes de
      // qualquer item. Se fosse depois, a resposta ainda seria 404, mas o
      // pedido teria sido montado com um item de outro cardápio antes de
      // morrer — e a mensagem contaria qual dos dois faltou
      expect(pedido.statusCode).toBe(404);
      expect(pedido.json().message).toContain(bloqueada.id);
    });

    it("a liberação do cadastro abandonado expulsa quem estava dentro", async () => {
      const { restaurant, user, headers } = await registerAndLogin(app, {
        restaurant: { slug: "desistiu" },
      });
      const linkAtrasado = extraiToken((await esperaEmail(user.email)).text);

      // envelhece o cadastro no BANCO, nunca esperando os 7 dias
      await pool.query(
        `update restaurants set created_at = now() - interval '8 days' where id = $1`,
        [restaurant.id],
      );

      // outra pessoa chega e leva o slug
      expect((await registerResponse(app, { slug: "desistiu" })).statusCode).toBe(
        201,
      );

      // a sessão de quem desistiu morre sozinha, sem ninguém apagar linha de
      // `sessions` — marcar o usuário basta.
      //
      // ⚠️ Este 401 NÃO prende o filtro `u.deleted_at is null` da query de
      // sessão, embora ele seja o primeiro a disparar: o `/auth/me` tem a
      // segunda rede do `getUser` (`services/auth.ts`) e responde 401 com o
      // filtro ou sem ele — medido numa revisão, tirando o filtro a suíte
      // inteira passava. Quem prende o filtro é a asserção em rota ESCOPADA
      // de `auth-users.test.ts` ("a sessão do removido para de valer na
      // hora").
      expect(
        (await app.inject({ method: "GET", url: "/auth/me", headers })).statusCode,
      ).toBe(401);

      // e o link que ficou na caixa de entrada dele não verifica — muito menos
      // o cadastro de quem chegou depois, que é dono do mesmo slug agora
      expect((await verifica(linkAtrasado)).statusCode).toBe(400);
    });

    it("a loja bloqueada não acumula nada — a premissa da liberação", async () => {
      const { restaurant, headers } = await registerAndLogin(app);

      // as rotas de gestão que CRIAM, alteram ou removem dado da loja. O 403
      // vem do hook, antes da validação do corpo, então o payload vazio basta
      const tentativas = [
        ["POST", `/restaurants/${restaurant.id}/products`],
        ["POST", `/restaurants/${restaurant.id}/categories`],
        ["POST", `/restaurants/${restaurant.id}/option-groups`],
        ["POST", `/restaurants/${restaurant.id}/users`],
        ["PUT", `/restaurants/${restaurant.id}/opening-hours`],
        ["PUT", `/restaurants/${restaurant.id}/delivery-neighborhoods`],
        ["PATCH", `/restaurants/${restaurant.id}`],
        // o DELETE também: a verificação é conferida ANTES do `ownerOnly`, e
        // a consequência é que nem o dono desfaz o próprio cadastro enquanto
        // não verificar — quem se cadastrou errado espera a liberação dos 7
        // dias, que é o único caminho que solta o slug
        ["DELETE", `/restaurants/${restaurant.id}`],
      ] as const;

      for (const [method, url] of tentativas) {
        const response = await app.inject({
          method,
          url,
          headers,
          payload: method === "DELETE" ? undefined : {},
        });
        expect(response.statusCode, `${method} ${url}`).toBe(403);
      }

      // e o pedido, que é público e não passa pelo hook: 404, pelo assert
      // próprio de `services/orders.ts`
      const pedido = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/orders`,
        payload: {
          type: "dine_in",
          customer: validCustomerBody,
          items: [{ productId: randomUUID(), quantity: 1 }],
          paymentMethod: "cash",
        },
      });
      expect(pedido.statusCode).toBe(404);

      // ⚠️ É esta contagem que sustenta a liberação de cadastro abandonado:
      // ela marca o restaurante e o usuário, e NÃO cascateia para as filhas.
      // Sob a premissa não há o que cascatear; no dia em que uma rota de
      // gestão deixar de exigir verificação, o que sobra não é uma linha a
      // mais removida — são filhas VIVAS apontando para um restaurante morto,
      // fora do alcance de qualquer cascata.
      //
      // A lista de tabelas vem do catálogo do Postgres, e não escrita à mão,
      // para tabela filha nova entrar aqui sem ninguém precisar lembrar.
      const { rows: filhas } = await pool.query<{ tabela: string }>(
        `select table_name as tabela from information_schema.columns
          where table_schema = 'public' and column_name = 'restaurant_id'
            and table_name <> 'restaurant_users'
          order by table_name`,
      );
      expect(filhas.length).toBeGreaterThan(0);

      for (const { tabela } of filhas) {
        // o identificador vem do catálogo, nunca do cliente — e ainda assim
        // passa pelo `escapeIdentifier` do próprio `pg`, que é o que o S3
        // manda usar quando o identificador é mesmo dinâmico
        const { rows } = await pool.query<{ n: number }>(
          `select count(*)::int as n from ${escapeIdentifier(tabela)}
            where restaurant_id = $1`,
          [restaurant.id],
        );
        expect(rows[0].n, `${tabela} deveria estar vazia`).toBe(0);
      }
    });
  });
});
