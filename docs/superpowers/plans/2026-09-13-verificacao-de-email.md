# Verificação de e-mail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loja que não provou o e-mail não opera e não aparece — e a recuperação de senha passa a apontar para um endereço que existe.

**Architecture:** Uma coluna no restaurante e uma tabela de token espelhando a da recuperação. O bloqueio do painel mora no mesmo hook que já resolve sessão, escopo e papel; o sumiço do lado do cliente mora num filtro só, no `findBySlug`, de onde cardápio, cotação e pedido herdam.

**Tech Stack:** TypeScript nativo do Node, Fastify 5, Postgres via `pg` cru, node-pg-migrate, Vitest, `nodemailer` (já instalado).

**Spec:** `docs/superpowers/specs/2026-09-13-verificacao-de-email-design.md` — a autoridade.

## Global Constraints

- **Runtime:** Node >= 23.6 com type stripping. Imports locais **com `.ts`**. Sem `enum`, sem `namespace` com valor. `import type` para tipos. `build` é `tsc --noEmit`.
- **Três camadas:** rota → serviço → repositório. Rota nunca escreve SQL nem importa `pool`. Serviço nunca conhece Fastify.
- **Erro de negócio é erro tipado do serviço**, traduzido pelo `setErrorHandler()` central. Nenhuma rota monta corpo de erro nem escolhe status de negócio.
- **Todo valor do cliente vai como `$n`.** Sem mass assignment.
- **`schema.response` por status code é obrigatório** — controle de segurança.
- **Soft delete:** nada é apagado; toda leitura filtra `deleted_at is null`.
- **O banco guarda o hash do token, nunca o token** (`src/tokens.ts`).
- **Nunca logar segredo** (S13): nem token, nem senha, nem `SMTP_URL`.
- **Rota nasce fechada**; pública declara `config: { public: true }` e entra nas duas listas que os testes de garantia leem.
- Comentários em **pt-BR**, identificadores em **inglês**.
- Commit `<tipo>(<escopo>): <emoji> <mensagem>`, pt-BR, presente do indicativo, minúscula, sem ponto final.
- Toda rota declara `tags`, `summary`, `description`, `operationId`; rodar `openapi:generate` no mesmo commit.
- Teste: um `describe` de topo por arquivo. Baseline: **528**.

---

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `migrations/<ts>_add-email-verification.sql` | a coluna, a tabela e o backfill |
| `src/repositories/email-verification.ts` | só SQL do token |
| `src/services/auth.ts` | emitir, verificar, reenviar |
| `src/routes/auth.ts` | as duas rotas |
| `src/routes/authenticate.ts` | a terceira checagem do hook |
| `src/repositories/restaurants.ts` | `findBySlug` filtra não verificado |
| `src/services/restaurants.ts` | libera cadastro abandonado na colisão |
| `test/helpers.ts` | `createRestaurant` completa a verificação |
| `test/email-verification.test.ts` | o fluxo inteiro |

---

### Task 1: Migration

**Files:**
- Create: `apps/api/migrations/<timestamp>_add-email-verification.sql` (via `migrate:create`, D21)

- [ ] **Step 1: Criar o arquivo**

```bash
pnpm --filter @menuclick/api migrate:create add-email-verification
```

- [ ] **Step 2: Escrever o Up**

```sql
-- Up Migration

-- Quando a loja provou o e-mail. Nulo é "não provou".
--
-- A coluna vai no RESTAURANTE e não no usuário de propósito: quem fica
-- bloqueado e invisível é a loja. Com a marca no usuário, o hook precisaria
-- descobrir se o DONO verificou (não o usuário da sessão), e o `findBySlug` do
-- cardápio público — o caminho mais quente da API, o que o QR code abre —
-- passaria a juntar com `restaurant_users`.
alter table restaurants add column email_verified_at timestamptz;

-- ⚠️ Todo restaurante que JÁ existe nasce verificado, e isto é o backfill.
--
-- Sem esta linha, o bloqueio da Task 2 trancaria toda loja do banco no instante
-- do deploy — o defeito exato que a feature de taxa de entrega quase embarcou,
-- e que só a revisão da branch inteira pegou. A exigência vale para cadastro
-- novo; quem já está aqui não muda de comportamento.
update restaurants set email_verified_at = now() where deleted_at is null;

-- Espelha `password_reset_tokens`: mesma forma de token, mesmo soft delete.
create table email_verification_tokens (
  id                 uuid        primary key default gen_random_uuid(),
  -- aponta para o USUÁRIO, porque é a caixa de entrada dele que prova algo.
  -- Verificar marca o RESTAURANTE dele.
  restaurant_user_id uuid        not null references restaurant_users (id),
  -- sha256 hex, nunca o token: a mesma decisão de `sessions`, do
  -- `trackingToken` e da recuperação de senha
  token_hash         text        not null,
  expires_at         timestamptz not null,
  -- consumido na verificação. Separado do `deleted_at` pelo mesmo motivo da
  -- recuperação: "isto aconteceu" e "foi invalidado sem acontecer" são fatos
  -- diferentes, e colapsá-los apaga o que importa numa investigação.
  used_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- A busca é sempre pelo hash, e sempre entre os vivos. NÃO é único, pelo mesmo
-- motivo do índice equivalente da recuperação: o índice existe para velocidade,
-- e `unique` não compraria garantia que um gerador de 256 bits já não dê.
create index email_verification_tokens_active_hash_idx
  on email_verification_tokens (token_hash)
  where deleted_at is null;

create index email_verification_tokens_active_by_user_idx
  on email_verification_tokens (restaurant_user_id)
  where deleted_at is null;
```

- [ ] **Step 3: Escrever o Down**

```sql
-- Down Migration
--
-- ⚠️ PERDA DE INFORMAÇÃO: some o registro de quais lojas provaram o e-mail e
-- quando, mais os pedidos de verificação em aberto. Não há onde guardar — nem a
-- coluna nem a tabela existem no schema anterior.
--
-- Descer isto NÃO devolve ninguém ao estado anterior: as lojas voltam a operar
-- sem verificação, que é o comportamento de antes da feature — então o `Down` é
-- seguro de rodar, só não é reversível.

drop index email_verification_tokens_active_by_user_idx;
drop index email_verification_tokens_active_hash_idx;
drop table email_verification_tokens;

alter table restaurants drop column email_verified_at;
```

- [ ] **Step 4: Aplicar e sondar**

Cada sonda em seu próprio `-c` — juntar duas põe as duas na mesma transação
implícita, e a falha esperada da primeira desfaz a linha que a segunda precisa.

```bash
# 1. todo restaurante existente nasceu verificado
docker exec -i capstone-db psql -U postgres -d capstone -qtA -c \
  "select count(*) filter (where email_verified_at is null) || ' de ' || count(*) || ' sem verificar'
     from restaurants where deleted_at is null"
# esperado: 0 de N

# 2. a FK recusa usuário inexistente
docker exec -i capstone-db psql -U postgres -d capstone -qtA -c \
  "insert into email_verification_tokens (restaurant_user_id, token_hash, expires_at)
   values (gen_random_uuid(), 'x', now())"
# esperado: FALHA de foreign key
```

- [ ] **Step 5: Ida e volta em banco descartável**

- [ ] **Step 6: Commit**

```
chore(db): 🔧 cria a verificação de e-mail e marca as lojas existentes
```

---

### Task 2: O bloqueio no painel

**Files:**
- Modify: `apps/api/src/routes/authenticate.ts`, `apps/api/src/domain/restaurant.ts`, `apps/api/src/repositories/restaurants.ts`, `apps/api/src/routes/schemas.ts`, `apps/api/src/routes/auth.ts` (o `/auth/me`), `apps/api/test/helpers.ts`
- Test: `apps/api/test/email-verification.test.ts`

**Interfaces:**
- Consome: a coluna da Task 1.
- Produz: `emailVerifiedAt` no `Restaurant`, e o bloqueio de 403.

🚨 **Esta tarefa quebra quase toda a suíte, e isso é SINAL, não trabalho de
edição.** Todo restaurante de teste passa a nascer não verificado, então cada
teste que cria um e faz qualquer coisa bate em 403. **O conserto é no helper**,
nunca teste a teste — um teste que você edita um a um é um teste em que você
parou de confiar.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("bloqueia o painel com 403 até verificar", async () => {
  // `registerAndLogin` cria SEM verificar, ao contrário do `createRestaurant`
  const { restaurant, headers } = await registerAndLogin(app);

  const response = await app.inject({
    method: "GET",
    url: `/restaurants/${restaurant.id}/products`,
    headers,
  });

  // 403 e não 404: a sessão é válida e o restaurante É o da sessão — esconder
  // mandaria quem está no painel procurar o problema no lugar errado (S32)
  expect(response.statusCode).toBe(403);
  expect(response.json().message).toMatch(/verif/i);
});

it("deixa passar o que a pessoa precisa para se desbloquear", async () => {
  const { headers } = await registerAndLogin(app);

  // `/auth/me` para o painel saber o que falta, e o reenvio para receber de novo
  expect((await app.inject({ method: "GET", url: "/auth/me", headers })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: "/auth/logout", headers })).statusCode).toBe(204);
});

it("o /auth/me diz que o restaurante não está verificado", async () => {
  const { headers } = await registerAndLogin(app);

  const response = await app.inject({ method: "GET", url: "/auth/me", headers });

  // no TOPO do corpo, não aninhado: o `/auth/me` devolve `RestaurantUser`, e
  // não há `restaurant` nele — conferido antes de escrever
  expect(response.json().emailVerified).toBe(false);
});

it("restaurante verificado opera normalmente", async () => {
  // `createRestaurant` completa a verificação — ver o helper
  const restaurant = await createRestaurant(app, { slug: "verificada" });

  const response = await app.inject({
    method: "GET",
    url: `/restaurants/${restaurant.id}/products`,
    headers: restaurant.headers,
  });

  expect(response.statusCode).toBe(200);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Esperado: FAIL — nada bloqueia ainda, então os dois primeiros devolvem 200.

- [ ] **Step 3: A terceira checagem do hook**

Em `routes/authenticate.ts`, **depois** do escopo e **antes** do `ownerOnly`:

```ts
/**
 * A loja precisa ter provado o e-mail para operar.
 *
 * Vale para toda rota escopada em restaurante, POR PADRÃO — rota nova nasce
 * bloqueada, pelo mesmo raciocínio do `public`: esquecer uma linha fecha em vez
 * de abrir, e os dois erros não custam a mesma coisa.
 *
 * 403 e não 404, e é a segunda situação do projeto em que 403 é o certo: a
 * sessão é válida e o restaurante É o da sessão, então a existência já é
 * conhecida. O 404 do S19 continua valendo para restaurante alheio — e note que
 * ele é conferido ACIMA desta linha, então quem tenta o restaurante de outro
 * continua recebendo 404, verificado ou não.
 */
if (restaurantId !== undefined && request.auth?.emailVerified !== true) {
  throw new ForbiddenError(
    "Confirme o e-mail do restaurante para usar o painel. Reenvie o link em POST /auth/resend-verification",
  );
}
```

⚠️ **A ordem importa e há teste para ela:** o escopo (404) vem antes da
verificação (403). Invertendo, alguém descobriria que o restaurante de outra
pessoa existe só por receber 403 em vez de 404.

A sessão precisa carregar `emailVerified`, e isso custa um **join novo**: a
query que resolve o token hoje junta só `restaurant_users`
(`repositories/sessions.ts`), e `email_verified_at` está em `restaurants`.

⚠️ Não é "de graça", e vale dizer o preço em vez de escondê-lo: passa a haver um
join a mais em **toda requisição autenticada**. É join por chave primária, então
é barato — mas é o caminho mais quente do painel, e quem mexer nessa query
precisa saber por que ele está lá. Continua sendo **uma** ida ao banco, que é o
que importa: a alternativa seria uma segunda consulta no hook.

- [ ] **Step 4: O `/auth/me`**

`emailVerified: boolean` no topo do `schema.response` do `/auth/me` — o corpo é o `RestaurantUser`, não o restaurante. **Booleano, não a
data**: quando a loja verificou é informação de auditoria, não do painel, e o
`schema.response` é o que impede coluna nova de vazar (S10).

- [ ] **Step 5: O helper — o conserto que vale por toda a suíte**

Em `test/helpers.ts`, `createRestaurant` passa a completar a verificação **pelo
fluxo real**, não por `update` no banco:

```ts
/**
 * ⚠️ Completa a verificação de e-mail pelo caminho de verdade: lê o token do
 * e-mail que o cadastro disparou e chama a rota.
 *
 * Poderia ser um `update` direto na coluna, que seria mais rápido. Pelo fluxo é
 * melhor por dois motivos: toda a suíte passa a exercitar o cadastro ->
 * verificação de graça, e o dia em que esse caminho quebrar não vai depender de
 * alguém lembrar de testá-lo.
 *
 * Lê o e-mail POR ENDEREÇO (`esperaEmail(email)`), nunca "o último do outbox" —
 * senão dois restaurantes criados em sequência pegariam o token um do outro.
 */
```

`registerAndLogin` **não** verifica — é ele que os testes usam quando querem uma
loja bloqueada.

- [ ] **Step 6: Rodar a suíte inteira e consertar NO HELPER**

Esperado: a suíte volta ao verde só com a mudança do helper. Se algum teste
precisar de conserto próprio, **diga qual e por quê** no relatório — pode ser
sinal de que ele dependia de algo que mudou de verdade.

- [ ] **Step 7: Verificar por mutação**

Tire a checagem do hook. Esperado: **FALHA** em "bloqueia o painel com 403".

Mova a checagem para ANTES do escopo. Esperado: **FALHA** no teste de
restaurante alheio (`authorization.test.ts` ou o de escopo) — que passa a
receber 403 em vez de 404.

Tire o `emailVerified` do `schema.response` do `/auth/me`. Esperado: **FALHA**
no teste do painel.

- [ ] **Step 8: OpenAPI, suíte, commit**

```
feat(auth)!: ✨ exige e-mail verificado para operar o painel

BREAKING CHANGE: toda rota escopada em restaurante responde 403 enquanto a loja
não verificar o e-mail. Restaurantes que já existiam nasceram verificados na
migration, então nada muda para quem já estava no ar.
```

---

### Task 3: A loja some do ar

**Files:**
- Modify: `apps/api/src/repositories/restaurants.ts` (`findBySlug`)
- Test: `apps/api/test/email-verification.test.ts`

**Interfaces:**
- Consome: a coluna da Task 1.
- Produz: nada novo — cardápio, cotação e pedido herdam o comportamento.

A tarefa inteira é **uma condição numa consulta**. O valor está em ser um lugar
só: cardápio, cotação de frete e criação de pedido passam pelo `findBySlug`, e
nenhum deles precisa lembrar da regra.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("o cardápio de loja não verificada responde 404", async () => {
  const { restaurant } = await registerAndLogin(app, {
    restaurant: { slug: "invisivel" },
  });

  const response = await app.inject({ method: "GET", url: "/menu/invisivel" });

  // 404 e não 403: do lado de fora, loja que não provou o e-mail tem que ser
  // indistinguível de loja que não existe. 403 entregaria que o slug está
  // ocupado.
  expect(response.statusCode).toBe(404);
  expect(restaurant.slug).toBe("invisivel"); // ela existe; só não aparece
});

it("a listagem de produtos do cardápio também", async () => {
  expect((await app.inject({ method: "GET", url: "/menu/invisivel/products" })).statusCode).toBe(404);
});

it("a cotação de frete também", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/menu/invisivel/delivery-quote",
    payload: { address: validDeliveryAddress, subtotalInCents: 3000 },
  });
  expect(response.statusCode).toBe(404);
});

it("e não dá para criar pedido nela", async () => {
  // pelo id, não pelo slug: é o caminho que a criação usa
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/orders`,
    payload: { /* pedido válido */ },
  });
  expect(response.statusCode).toBe(404);
});

it("depois de verificar, a loja aparece", async () => {
  // mesma loja, agora verificada pelo fluxo
  expect((await app.inject({ method: "GET", url: `/menu/${slug}` })).statusCode).toBe(200);
});
```

⚠️ O último teste é o que impede a regra de virar "loja nenhuma aparece". Sem
ele, apagar o restaurante inteiro do cardápio passaria despercebido.

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: O filtro**

```ts
export async function findBySlug(
  slug: string,
  db: Queryable = pool,
): Promise<Restaurant | null> {
  const { rows } = await db.query<RestaurantRow>(
    // `email_verified_at is not null` fica AO LADO do `deleted_at is null`, e
    // não por acaso: do ponto de vista de quem está de fora, loja que não
    // provou o e-mail e loja removida são a mesma coisa — não existem. Um
    // filtro, um lugar, e cardápio, cotação e pedido herdam.
    `select * from restaurants
      where slug = $1 and deleted_at is null and email_verified_at is not null`,
    [slug],
  );
  return rows.length === 0 ? null : toRestaurant(rows[0]);
}
```

⚠️ **A criação de pedido NÃO herda este filtro, e isso já foi verificado.**

Ela resolve por `restaurantsService.getById(restaurantId)`
(`services/orders.ts:342`). Esse `getById` tem **4 chamadores**, conferidos pela função que os contém:
`create()` (a criação de pedido, pública), `listByRestaurant()` e `summary()`
(painel), e `routes/restaurants.ts:94` (painel). As transições de status **não**
entram — usam `ensureExists`.

**Não filtre dentro dele.** Filtrar funcionaria (os três de painel já são
bloqueados pelo hook antes), então a decisão é apertada — mas `getById` é um
"pegue o restaurante por id" de propósito geral, e escondê-los ali muda o
contrato para todo chamador futuro, com a correção dependendo de uma ordem de
hook que ninguém vê ao ler a função.

A criação ganha um **assert próprio**, ao lado do `assertLojaAberta`, lançando
`NotFoundError`:

```ts
/**
 * Loja que não provou o e-mail não existe para o cliente — nem para pedir.
 *
 * 404 e não 403 pelo mesmo motivo do cardápio: do lado de fora ela tem que ser
 * indistinguível de uma loja que não existe.
 *
 * ⚠️ Mora aqui, e não dentro do `getById`, porque aquele é usado por todo o
 * painel. Filtrar lá faria vinte rotas mudarem de significado de uma vez.
 */
function assertLojaVisivel(restaurant: Restaurant, restaurantId: string): void {
  if (restaurant.emailVerifiedAt === undefined) {
    throw new NotFoundError(`Restaurante com id "${restaurantId}" não encontrado`);
  }
}
```

- [ ] **Step 4: Rodar, type-check, lint**

- [ ] **Step 5: Verificar por mutação**

Tire `email_verified_at is not null` do `findBySlug`.
Esperado: **FALHA** nos testes de cardápio, produtos e cotação.

Tire só do caminho da criação de pedido (se ele tiver um filtro próprio).
Esperado: **FALHA** no teste do pedido — e se não falhar, o filtro está num
lugar só e o comentário acima deve dizer isso.

- [ ] **Step 6: Commit**

```
feat(menu)!: ✨ esconde do cliente a loja que não verificou o e-mail

BREAKING CHANGE: `GET /menu/:slug` responde 404 para loja não verificada.
```

---

### Task 4: Verificar e reenviar

**Files:**
- Create: `apps/api/src/repositories/email-verification.ts`
- Modify: `apps/api/src/services/auth.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/limits.ts`, `apps/api/test/authorization.test.ts`, `apps/api/test/openapi.test.ts`

**Interfaces:**
- Consome: a tabela da Task 1, `sendEmail` e o `outbox`.
- Produz: `POST /auth/verify-email` e `POST /auth/resend-verification`.

O fluxo espelha o da recuperação de senha de perto — leia
`services/auth.ts` (`requestPasswordReset`/`resetPassword`) e
`repositories/password-reset.ts` antes de escrever, e siga a mesma forma.

⚠️ **`esperaEmail` e `extraiToken` são locais do `password-reset.test.ts`**, não
compartilhados — conferido. Os testes desta tarefa precisam deles, então **mova
os dois para `test/helpers.ts`** e faça o arquivo da recuperação passar a
importá-los. Duas features mandam e-mail agora; o lugar deles é o helper.
Mover, não duplicar: duas cópias divergem no dia em que o formato do link mudar.

Três diferenças, e cada uma tem razão:

**O token vale 24 horas, não uma.** O perfil de risco é outro: um token de
recuperação vazado dá acesso a uma conta que existe e tem dado dentro; um de
verificação só destrava uma conta vazia, cuja senha o atacante continua não
tendo. Uma hora obrigaria a reenviar quem lê e-mail depois do almoço.

**O cadastro dispara o e-mail**, e o envio sai **depois do commit** da
transação de cadastro — segurar uma conexão do pool durante a ida e volta do
SMTP é o que o `register()` já evita com o bcrypt, pelo mesmo motivo.

**O reenvio exige sessão** e precisa funcionar não verificado (Task 2 já o
deixa passar). Manda para o **próprio endereço de quem chama**.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("o cadastro dispara o e-mail de verificação", async () => {
  const { user } = await registerAndLogin(app);
  const email = await esperaEmail(user.email);
  expect(email.text).toContain("http");
});

it("verifica com o token e a loja passa a operar", async () => {
  const { restaurant, headers, user } = await registerAndLogin(app);
  const token = extraiToken((await esperaEmail(user.email)).text);

  expect((await app.inject({
    method: "POST", url: "/auth/verify-email", payload: { token },
  })).statusCode).toBe(200);

  expect((await app.inject({
    method: "GET", url: `/restaurants/${restaurant.id}/products`, headers,
  })).statusCode).toBe(200);
});

it("o token não serve duas vezes", async () => { /* 400 */ });

it("token expirado não serve", async () => {
  // envelhece a linha no banco, nunca espera o relógio
  await pool.query(
    `update email_verification_tokens set expires_at = now() - interval '1 minute'
      where restaurant_user_id = $1`, [userId]);
  expect(response.statusCode).toBe(400);
});

it("token inventado não serve", async () => { /* 400 */ });

it("mensagem única para inválido, expirado e já usado", async () => {
  // distinguir diria a quem guarda um link velho se ele um dia existiu
});

it("o reenvio manda outro link, e o novo funciona", async () => { /* 202 */ });

it("o reenvio invalida o token anterior", async () => {
  // senão dois links vivos ficam espalhados na caixa de entrada
});

it("o reenvio exige sessão", async () => { /* 401 sem headers */ });

it("verificar não devolve sessão", async () => {
  expect(JSON.stringify(response.json())).not.toContain("token");
});
```

⚠️ **Nenhum teste mede relógio.** O de expiração envelhece a linha no banco.
Este projeto já embarcou três testes dependentes de relógio; não acrescente um
quarto.

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Repositório, serviço e rotas**

Espelhe `password-reset`. O teto por IP do `verify-email` vai em `limits.ts`
com o porquê ao lado do número — rota anônima, mesmo perfil do S25.

As duas rotas entram nas listas de pública que os testes de garantia leem
(`authorization.test.ts` e `openapi.test.ts`) — **entradas específicas, nunca
curinga**. O reenvio **não** é público: exige sessão.

- [ ] **Step 4: Verificar por mutação**

Tire o `markUsed`. Esperado: **FALHA** em "não serve duas vezes".
Tire a invalidação no reenvio. Esperado: **FALHA** no teste do reenvio.
Tire o `config: { public: true }` do `verify-email`. Esperado: **FALHA** com 401.

- [ ] **Step 5: OpenAPI, suíte, commit**

```
feat(auth): ✨ verifica o e-mail por link e permite reenviar
```

---

### Task 5: Cadastro abandonado libera slug e e-mail

**Files:**
- Modify: `apps/api/src/services/restaurants.ts`, `apps/api/src/repositories/restaurants.ts`, `apps/api/src/services/auth.ts` (o `register`)
- Test: `apps/api/test/email-verification.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("libera o slug de cadastro abandonado", async () => {
  const { restaurant } = await registerAndLogin(app, {
    restaurant: { slug: "abandonada" },
  });
  // envelhece o cadastro em vez de esperar 7 dias
  await pool.query(
    `update restaurants set created_at = now() - interval '8 days' where id = $1`,
    [restaurant.id]);

  const novo = await app.inject({
    method: "POST", url: "/auth/register",
    payload: { /* mesmo slug */ },
  });

  expect(novo.statusCode).toBe(201);
  expect(novo.json().restaurant.slug).toBe("abandonada");
});

it("libera o e-mail de cadastro abandonado", async () => {
  // o caso MAIS comum: a pessoa não recebeu o e-mail e tenta de novo
  expect(novo.statusCode).toBe(201);
});

it("NÃO libera cadastro recente", async () => {
  // 7 dias ainda não passaram: o slug ganha sufixo, o e-mail é 409
});

it("NÃO libera cadastro verificado, por mais antigo que seja", async () => {
  // envelhece um restaurante VERIFICADO e confirma que ele não é tocado
  const response = await app.inject({ method: "GET", url: `/menu/${slug}` });
  expect(response.statusCode).toBe(200);
});
```

⚠️ O último é o que separa esta limpeza de um apagador de lojas. Sem ele,
inverter a condição de verificação passaria despercebido — e apagaria
restaurante em produção.

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Implementar**

Na colisão (o repositório devolve `null`), o serviço olha se quem segura é
cadastro abandonado — **não verificado e criado há mais de 7 dias**. Se for,
marca o restaurante **e o usuário dele** como removidos, na mesma transação, e
tenta de novo.

```ts
/**
 * ⚠️ Isto é seguro por uma razão específica, e ela precisa continuar verdadeira:
 * um restaurante não verificado está bloqueado de TODAS as rotas de gestão
 * (Task 2), então não tem cardápio, categoria, produto nem pedido. Apagar um é
 * apagar uma linha vazia.
 *
 * Se um dia alguma rota de gestão deixar de exigir verificação, esta limpeza
 * deixa de ser inofensiva — e nada aqui vai avisar.
 */
```

O usuário vai junto porque é ele que segura o e-mail; liberar só o slug deixaria
metade do problema.

⚠️ **Não dá para fazer isto no índice único.** O Postgres recusa: `functions in
index predicate must be marked IMMUTABLE`, e `now()` não é — verificado. E o
projeto não tem agendador, então rotina periódica traria infraestrutura nova
para um caso de borda. Na colisão o trabalho acontece exatamente quando importa.

- [ ] **Step 4: Verificar por mutação**

Tire a condição `email_verified_at is null`. Esperado: **FALHA** em "não libera
cadastro verificado" — e esta é a mutação mais importante do plano, porque a
versão mutada apaga loja de verdade.

Tire a condição dos 7 dias. Esperado: **FALHA** em "não libera cadastro recente".

Marque só o restaurante, não o usuário. Esperado: **FALHA** no teste do e-mail.

- [ ] **Step 5: Commit**

```
feat(auth): ✨ libera slug e e-mail de cadastro abandonado
```

---

### Task 6: Documentação e ponta a ponta

**Files:**
- Modify: `CLAUDE.md`, `.claude/rules/security.md`, `apps/api/test/email-verification.test.ts`

- [ ] **Step 1: E2E adversarial**

Percorra como loja nova: cadastra, tenta operar (403), tenta abrir o próprio
cardápio (404), lê o link, verifica, opera, aparece. Depois ataque: reusar o
link, usar o link de outra loja, verificar duas vezes, e pedir na loja de
outro. Se achar divergência, **reporte com destaque** em vez de corrigir quieto.

- [ ] **Step 2: `CLAUDE.md`**

- A tabela "Público hoje, e nada além disso" ganha `POST /auth/verify-email`.
- A seção de acesso ganha o desenho: por que a coluna está no restaurante e não
  no usuário, por que 403 no painel e 404 no cardápio, e por que o reenvio é
  parte do desenho e não conveniência.
- ⚠️ E registra a condição que mantém a limpeza segura: **loja não verificada
  não pode ter nada dentro**.

- [ ] **Step 3: `.claude/rules/security.md`**

O **S32** hoje diz que 403 é "a única situação do projeto" em que ele é o certo.
Passa a ser a segunda, com a mesma razão: o restaurante É o da sessão.

⚠️ Não invente regra nova; descreva o que foi construído, no tom das outras.

- [ ] **Step 4: Commits separados**

E2E e documentação são mudanças lógicas diferentes.
