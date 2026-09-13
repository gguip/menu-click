# Recuperação de senha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quem esquece a senha recupera o acesso por e-mail, em vez de perder o restaurante.

**Architecture:** Token aleatório de uso único, com o banco guardando só o hash — o mesmo padrão de `sessions`. Duas rotas públicas: uma pede, outra troca. O envio sai por uma porta com dois drivers (SMTP em produção, console em dev e teste), e a rota de pedido responde antes de fazer o trabalho, para o tempo não denunciar quais e-mails existem.

**Tech Stack:** TypeScript nativo do Node, Fastify 5, Postgres via `pg` cru, node-pg-migrate, Vitest, `nodemailer`.

**Spec:** `docs/superpowers/specs/2026-09-12-recuperacao-de-senha-design.md` — a autoridade.

## Global Constraints

- **Runtime:** Node >= 23.6 com type stripping. Imports locais **com `.ts`**. Sem `enum`, sem `namespace` com valor, sem parameter properties. `import type` para tipos. `build` é `tsc --noEmit`.
- **Três camadas:** rota → serviço → repositório. Rota nunca escreve SQL nem importa `pool`. Serviço nunca conhece Fastify.
- **Erro de negócio é erro tipado do serviço**, traduzido pelo `setErrorHandler()` central. Nenhuma rota monta corpo de erro nem escolhe status de negócio.
- **Todo valor do cliente vai como `$n`.** Sem mass assignment.
- **`schema.response` por status code é obrigatório** — controle de segurança.
- **Soft delete:** nada é apagado; toda leitura filtra `deleted_at is null`.
- **Senha em bcrypt**, e o limite checado com `Buffer.byteLength` (o bcrypt ignora tudo depois do byte 72 em silêncio).
- **O banco guarda o hash do token, nunca o token** (`src/tokens.ts`).
- **Nunca logar segredo** (S13): nem token, nem senha, nem connection string, nem `SMTP_URL`.
- **Rota nasce fechada**; pública declara `config: { public: true }` e entra nas duas listas que os testes de garantia leem.
- Comentários em **pt-BR**, identificadores em **inglês**.
- Commit `<tipo>(<escopo>): <emoji> <mensagem>`, pt-BR, presente do indicativo, minúscula, sem ponto final.
- Toda rota declara `tags`, `summary`, `description`, `operationId`; rodar `openapi:generate` no mesmo commit.
- Teste: um `describe` de topo por arquivo. Baseline: **489**.

---

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `migrations/<ts>_add-password-reset.sql` | a tabela `password_reset_tokens` |
| `src/email.ts` | a porta de envio, os dois drivers e a guarda de produção |
| `src/domain/password-reset.ts` | tipos e a validade do token |
| `src/repositories/password-reset.ts` | só SQL |
| `src/services/auth.ts` | as duas operações novas, e a invalidação na troca comum |
| `src/routes/auth.ts` | as duas rotas |
| `src/limits.ts` | o teto próprio da rota de pedido |
| `test/password-reset.test.ts` | o fluxo inteiro |

---

### Task 1: Migration

**Files:**
- Create: `apps/api/migrations/<timestamp>_add-password-reset.sql` (via `migrate:create`, D21)

- [ ] **Step 1: Criar o arquivo**

```bash
pnpm --filter @menuclick/api migrate:create add-password-reset
```

- [ ] **Step 2: Escrever o Up**

```sql
-- Up Migration

-- Espelha `sessions` de propósito: mesma forma de token, mesmo soft delete.
create table password_reset_tokens (
  id                 uuid        primary key default gen_random_uuid(),
  restaurant_user_id uuid        not null references restaurant_users (id),
  -- sha256 hex do token que foi por e-mail. O token em si não existe no banco:
  -- mesma decisão de `sessions` e do trackingToken. SHA-256 puro é o certo aqui
  -- porque o token são bits sorteados, sem dicionário a que seja vulnerável —
  -- e continua proibido para senha, que é segredo escolhido por gente.
  token_hash         text        not null,
  expires_at         timestamptz not null,
  -- consumido na troca. SEPARADO do deleted_at de propósito: "esta recuperação
  -- aconteceu" e "este token foi invalidado sem ser usado" são fatos
  -- diferentes, e colapsá-los apagaria a distinção que importa se alguém
  -- precisar entender um acesso indevido depois.
  used_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- A busca é sempre pelo hash, e sempre entre os vivos.
create index password_reset_tokens_active_hash_idx
  on password_reset_tokens (token_hash)
  where deleted_at is null;

-- Invalidar os anteriores de um usuário é a outra consulta quente.
create index password_reset_tokens_active_by_user_idx
  on password_reset_tokens (restaurant_user_id)
  where deleted_at is null;
```

⚠️ **O índice do hash NÃO é único.** Colisão de SHA-256 não é o risco; o que
quebraria com `unique` é o caso banal de um token expirado e um novo coexistindo
— e, mais importante, um índice único aqui viraria um oráculo: o insert falharia
diferente dependendo do que já existe.

- [ ] **Step 3: Escrever o Down**

```sql
-- Down Migration
--
-- ⚠️ PERDA DE INFORMAÇÃO: os pedidos de recuperação em aberto somem, e com eles
-- o registro de quais recuperações aconteceram. Não há onde guardar — a tabela
-- não existe no schema anterior. Quem estiver com um link no e-mail não
-- consegue usá-lo depois de descer esta migration.

drop index password_reset_tokens_active_by_user_idx;
drop index password_reset_tokens_active_hash_idx;
drop table password_reset_tokens;
```

- [ ] **Step 4: Aplicar e sondar**

```bash
pnpm --filter @menuclick/api migrate:up
```

Sondas, cada uma em seu próprio `-c`:

```bash
# 1. a tabela existe com as colunas certas
docker exec -i capstone-db psql -U postgres -d capstone -qtA -c \
  "select column_name from information_schema.columns
    where table_name='password_reset_tokens' order by ordinal_position"
# esperado: id, restaurant_user_id, token_hash, expires_at, used_at, created_at, updated_at, deleted_at

# 2. a FK recusa usuário inexistente
docker exec -i capstone-db psql -U postgres -d capstone -qtA -c \
  "insert into password_reset_tokens (restaurant_user_id, token_hash, expires_at)
   values (gen_random_uuid(), 'x', now())"
# esperado: FALHA de foreign key
```

- [ ] **Step 5: Ida e volta em banco descartável**

```bash
docker exec capstone-db psql -U postgres -q -c 'create database mig_probe'
cd apps/api && DB_HOST=localhost DB_PORT=5432 DB_USER=postgres DB_PASSWORD=senha123 DB_NAME=mig_probe node src/db/migrate.ts up
# ...e depois `down`
docker exec capstone-db psql -U postgres -q -c 'drop database mig_probe with (force)'
```

- [ ] **Step 6: Commit**

```
chore(db): 🔧 cria a tabela de token de recuperação de senha
```

---

### Task 2: A porta de e-mail

**Files:**
- Create: `apps/api/src/email.ts`, `apps/api/test/email.test.ts`
- Modify: `apps/api/src/app.ts` (a guarda e o `redact`), `apps/api/.env.example`
- Modify: `apps/api/package.json` (`nodemailer`)

**Interfaces:**
- Produz: `sendEmail(email)`, `assertEmailDriverIsSafe(driver, nodeEnv)`, `outbox`.

- [ ] **Step 1: A dependência**

```bash
pnpm --filter @menuclick/api add nodemailer
pnpm --filter @menuclick/api add -D @types/nodemailer
```

⚠️ Se o pnpm reclamar de script de install, a decisão vai em `allowBuilds` no
`pnpm-workspace.yaml` — o projeto trata "não decidido" como erro, não aviso.
`nodemailer` não tem build nativo, então isso não deve acontecer; se acontecer,
**pare e reporte** em vez de aprovar por conta própria.

- [ ] **Step 2: Escrever os testes que falham**

```ts
import { describe, expect, it } from "vitest";
import { assertEmailDriverIsSafe } from "../src/email.ts";

describe("porta de e-mail", () => {
  it("recusa o driver de console em produção", () => {
    // o link que ele escreve no log É o token: rodar assim em produção
    // derramaria credencial de troca de senha em log de aplicação (S13)
    expect(() => assertEmailDriverIsSafe("console", "production")).toThrow();
  });

  it("aceita o driver de console fora de produção", () => {
    expect(() => assertEmailDriverIsSafe("console", "development")).not.toThrow();
    expect(() => assertEmailDriverIsSafe("console", undefined)).not.toThrow();
  });

  it("aceita smtp em qualquer ambiente", () => {
    expect(() => assertEmailDriverIsSafe("smtp", "production")).not.toThrow();
  });

  it("recusa driver desconhecido", () => {
    expect(() => assertEmailDriverIsSafe("pombo-correio", "development")).toThrow();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Esperado: FAIL — `assertEmailDriverIsSafe` não existe.

- [ ] **Step 4: Implementar**

```ts
/**
 * A porta de saída de e-mail.
 *
 * Existe para o resto do código não conhecer provedor nenhum: o serviço chama
 * `sendEmail` e pronto. Trocar de fornecedor é trocar `SMTP_URL`, não mexer em
 * código — foi por isso que a escolha foi SMTP por `nodemailer` em vez do SDK
 * de um provedor.
 */
export type Email = { to: string; subject: string; text: string };

export const EMAIL_DRIVERS = ["smtp", "console"] as const;
export type EmailDriver = (typeof EMAIL_DRIVERS)[number];

/**
 * O que o driver de console "enviou", para os testes lerem.
 *
 * É necessário: o banco guarda só o HASH do token, então não existe caminho
 * pelo banco para um teste descobrir o token e exercer o fluxo até o fim. Fica
 * vazio em produção porque o driver de console é recusado lá.
 */
export const outbox: Email[] = [];

/**
 * 🚨 O driver de console escreve o link no log, e o link **é** o token.
 *
 * Em produção isso derramaria credencial de troca de senha em log de
 * aplicação, que é exatamente o que o S13 proíbe. Falhar ao subir é a resposta
 * certa: um aviso seria ignorado até o dia em que fosse tarde.
 */
export function assertEmailDriverIsSafe(
  driver: string,
  nodeEnv: string | undefined,
): void {
  if (!(EMAIL_DRIVERS as readonly string[]).includes(driver)) {
    throw new Error(
      `EMAIL_DRIVER inválido: "${driver}". Use ${EMAIL_DRIVERS.join(" ou ")}`,
    );
  }
  if (driver === "console" && nodeEnv === "production") {
    throw new Error(
      "EMAIL_DRIVER=console em produção escreveria o token de recuperação no log. Configure SMTP_URL e use EMAIL_DRIVER=smtp",
    );
  }
}
```

`sendEmail` escolhe o driver por `EMAIL_DRIVER` (default `console`), e o driver
`smtp` monta o transporte do `nodemailer` a partir de `SMTP_URL`, com `EMAIL_FROM`
como remetente.

⚠️ **O driver de console escreve a mensagem, não só o assunto** — é o que
permite a um operador ler o link e entregá-lo ao dono antes de existir provedor
configurado.

- [ ] **Step 5: A guarda no `buildApp()` e o redact**

Em `app.ts`, chamar `assertEmailDriverIsSafe(...)` junto das outras
pré-condições, e acrescentar `SMTP_URL` ao `logger.redact`, ao lado do
`DATABASE_URL` e pelo mesmo motivo: tem senha dentro.

- [ ] **Step 6: `.env.example`**

As quatro variáveis, **só com placeholder** (S12): `EMAIL_DRIVER`, `SMTP_URL`,
`EMAIL_FROM`, `PASSWORD_RESET_URL`.

- [ ] **Step 7: Rodar, type-check, lint, commit**

```
feat(email): ✨ cria a porta de envio com driver de console e de smtp
```

---

### Task 3: Pedir recuperação

**Files:**
- Create: `apps/api/src/domain/password-reset.ts`, `apps/api/src/repositories/password-reset.ts`, `apps/api/test/password-reset.test.ts`
- Modify: `apps/api/src/services/auth.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/limits.ts`, `apps/api/test/authorization.test.ts`, `apps/api/test/openapi.test.ts`

**Interfaces:**
- Consome: a tabela (Task 1), `sendEmail`/`outbox` (Task 2).
- Produz: `POST /auth/forgot-password`, e `requestPasswordReset(email)` no serviço.

- [ ] **Step 1: Escrever os testes que falham**

```ts
describe("recuperação de senha", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildTestApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  /** Espera o envio, que acontece FORA do caminho da resposta. */
  async function esperaEmail(paraQuem: string) {
    for (let i = 0; i < 50; i++) {
      const achado = outbox.findLast((email) => email.to === paraQuem);
      if (achado !== undefined) return achado;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`nenhum e-mail para ${paraQuem}`);
  }

  it("manda o link para quem existe", async () => {
    const restaurant = await createRestaurant(app, { slug: "recupera" });

    const response = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      // ⚠️ CONFIRA se `createRestaurant` devolve o e-mail do dono. Se não
      // devolver, expor isso no helper é parte desta tarefa — os testes
      // precisam do endereço para pedir a recuperação.
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
    await new Promise((r) => setTimeout(r, 100));
    expect(outbox.some((e) => e.to === "ninguem@exemplo.com")).toBe(false);
  });

  it("não manda para usuário removido", async () => {
    // ... cria um segundo usuário, remove-o, pede recuperação
    expect(outbox.some((e) => e.to === removido.email)).toBe(false);
  });

  it("um pedido novo invalida o token anterior", async () => {
    // dois pedidos seguidos; o token do primeiro não pode mais trocar a senha
    // (a asserção do "não pode mais" vive na Task 4; aqui basta conferir no
    // banco que sobrou exatamente um vivo)
    const { rows } = await pool.query(
      `select count(*)::int as vivos from password_reset_tokens
        where restaurant_user_id = $1 and deleted_at is null`,
      [userId],
    );
    expect(rows[0].vivos).toBe(1);
  });

  it("o token não aparece em lugar nenhum da resposta", async () => {
    // a resposta é 202 com mensagem genérica: nada de token, nada de e-mail
    const corpo = response.json();
    expect(JSON.stringify(corpo)).not.toContain("token");
  });
});
```

⚠️ **Nenhum teste mede TEMPO.** A propriedade "o tempo não denuncia" é
estrutural — o trabalho não é aguardado —, e um teste de relógio seria instável
por natureza. Este projeto já embarcou três testes dependentes de relógio; não
acrescente um quarto. O que os testes prendem é o **estrutural**: mesma resposta
para os dois casos, e token criado só para quem existe.

- [ ] **Step 2: Rodar e ver falhar**

Esperado: FAIL — a rota não existe (401, porque rota nasce fechada).

- [ ] **Step 3: Domínio e repositório**

`domain/password-reset.ts` guarda a validade (1 hora) e o tipo da linha.
`repositories/password-reset.ts` tem `insert`, `findLiveByHash`,
`markUsed`, `softDeleteLiveForUser`. Só SQL.

- [ ] **Step 4: O serviço**

```ts
/**
 * Cria o token e manda o link — **e é chamada sem `await` pela rota**.
 *
 * Responder antes de fazer isto é o que fecha o oráculo de tempo: com o
 * trabalho no caminho da resposta, um e-mail inexistente voltaria mais rápido
 * que um existente, e a diferença diria quais e-mails estão cadastrados. É o
 * mesmo problema que o login resolve rodando bcrypt contra um hash
 * descartável, com uma saída melhor — aqui o SMTP lento também deixa de segurar
 * a requisição.
 *
 * Por isso ela **nunca lança para fora**: quem a chama já respondeu.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  // filtra removido nos dois níveis: usuário e restaurante. Sem isso a
  // recuperação viraria o caminho de volta para uma conta que alguém removeu
  const user = await restaurantUsersRepository.findActiveByEmail(email);
  if (user === null) return;

  const token = generateToken();

  await withTransaction(async (client) => {
    // um pedido novo invalida os anteriores: sem isso, três tentativas
    // deixariam três tokens vivos espalhados pela caixa de entrada
    await passwordResetRepository.softDeleteLiveForUser(user.id, client);
    await passwordResetRepository.insert(
      { userId: user.id, tokenHash: hashToken(token), expiresAt: ... },
      client,
    );
  });

  // FORA da transação, e depois do commit
  await sendEmail({ to: user.email, subject: "...", text: linkDe(token) });
}
```

⚠️ **O envio fica FORA da transação, e depois do commit.** Mandar de dentro
seguraria uma conexão do pool durante a ida e volta do SMTP — que é rede, e pode
levar segundos com um provedor ruim. Com o pool limitado, algumas recuperações
lentas bastariam para travar requisições que nada têm a ver com e-mail.

A ordem escolhida troca esse risco por um bem mais barato: se o envio falhar,
sobra um token que ninguém recebeu, e ele expira sozinho em uma hora. É o mesmo
resultado prático de um e-mail que caiu no spam — a pessoa pede de novo. Já a
ordem inversa (enviar e então falhar ao gravar) entregaria um link que nunca
funcionaria, e aí a pessoa tentaria o link até desistir.

- [ ] **Step 5: A rota**

```ts
app.post("/auth/forgot-password", {
  config: { public: true, rateLimit: { max: PASSWORD_RESET_RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW } },
  schema: { /* body, response 202, tags, summary, description, operationId */ },
}, async (request, reply) => {
  reply.code(202).send({ message: "Se o e-mail estiver cadastrado, o link foi enviado" });

  // depois de responder, e sem `await`: ver o comentário do serviço
  void authService.requestPasswordReset(request.body.email).catch((error) => {
    // sem o token no log (S13), e sem contar ao cliente: dizer que o envio
    // falhou também diria que o e-mail existe
    request.log.error({ err: error }, "falha ao enviar recuperação de senha");
  });

  return reply;
});
```

- [ ] **Step 6: O teto próprio**

Em `limits.ts`:

```ts
/**
 * A recuperação é anônima e cara: dispara e-mail, que custa dinheiro e
 * reputação de domínio. Mesmo perfil do `/auth/login` (S25). Por IP e não por
 * e-mail, pela mesma razão: por e-mail viraria uma forma de impedir que o dono
 * legítimo recupere a conta.
 */
export const PASSWORD_RESET_RATE_LIMIT_MAX = 5;
```

- [ ] **Step 7: As duas listas de rota pública**

`test/authorization.test.ts` e `test/openapi.test.ts` ganham a rota — entradas
**específicas**, nunca curinga. É o fechado-por-padrão funcionando: rota pública
nova não entra sem alguém escrever à mão que ela é pública.

- [ ] **Step 8: Verificar por mutação**

Tire o filtro de removidos da busca. Esperado: **FALHA** em "não manda para
usuário removido".

Troque o 202 do caminho "não existe" por 404. Esperado: **FALHA** em "responde
igual".

Tire o `softDeleteLiveForUser`. Esperado: **FALHA** em "um pedido novo invalida
o anterior".

Tire o `config: { public: true }`. Esperado: **FALHA** com 401.

- [ ] **Step 9: OpenAPI, suíte, commit**

```
feat(auth): ✨ pede recuperação de senha por e-mail
```

---

### Task 4: Trocar a senha, e a outra ponta

**Files:**
- Modify: `apps/api/src/services/auth.ts`, `apps/api/src/routes/auth.ts`, `apps/api/test/password-reset.test.ts`, `apps/api/test/authorization.test.ts`, `apps/api/test/openapi.test.ts`

**Interfaces:**
- Consome: o token da Task 3.
- Produz: `POST /auth/reset-password`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("troca a senha com o token e deixa entrar com a nova", async () => {
  // pede, lê o link do outbox, extrai o token, troca, faz login com a nova
  expect(reset.statusCode).toBe(200);
  expect(loginNovo.statusCode).toBe(200);
});

it("a senha antiga para de funcionar", async () => {
  expect(loginAntigo.statusCode).toBe(401);
});

it("o token não serve duas vezes", async () => {
  // segunda tentativa com o mesmo token
  expect(segunda.statusCode).toBe(400);
});

it("token expirado não serve", async () => {
  // envelhece a linha no banco em vez de esperar uma hora
  await pool.query(
    `update password_reset_tokens set expires_at = now() - interval '1 minute'
      where restaurant_user_id = $1`,
    [userId],
  );
  expect(response.statusCode).toBe(400);
});

it("token inventado não serve", async () => {
  expect(response.statusCode).toBe(400);
});

it("a troca derruba TODAS as sessões", async () => {
  // sessão aberta antes da recuperação para de valer
  expect(me.statusCode).toBe(401);
});

it("a troca NÃO devolve sessão", async () => {
  // devolver token aqui transformaria um e-mail interceptado em acesso
  // imediato, sem a segunda barreira de precisar usar a senha nova
  expect(JSON.stringify(reset.json())).not.toContain("token");
});

it("recusa senha maior que 72 bytes de forma honesta", async () => {
  // 40 letras "ç" são 80 bytes: o bcrypt ignoraria o resto em silêncio (S20)
  expect(response.statusCode).toBe(400);
});

it("trocar a senha pelo caminho comum invalida o token pendente", async () => {
  // pede recuperação, troca por `change-password` com a senha atual, e o
  // token pedido antes deixa de valer
  expect(reset.statusCode).toBe(400);
});
```

⚠️ **O teste de expiração envelhece a linha no banco**, nunca espera o relógio.
Um teste que aguardasse uma hora é impossível; um que manipulasse o relógio do
processo é frágil. Mexer no dado é direto e determinístico.

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: O serviço**

```ts
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  assertPasswordByteLength(newPassword);

  await withTransaction(async (client) => {
    const linha = await passwordResetRepository.findLiveByHash(hashToken(token), client);
    // uma mensagem só para inválido, expirado e já usado: distinguir diria a
    // quem tem um token velho se ele um dia existiu
    if (linha === null || linha.usedAt !== null || linha.expiresAt <= new Date()) {
      throw new ValidationError("Link de recuperação inválido ou expirado");
    }

    await restaurantUsersRepository.updatePasswordHash(
      linha.restaurantUserId, await bcrypt.hash(newPassword, BCRYPT_ROUNDS), client,
    );
    await passwordResetRepository.markUsed(linha.id, client);
    // TODAS, sem exceção: não há sessão atual a poupar — a pessoa está
    // trancada para fora, e qualquer sessão viva é de quem tem a senha antiga.
    // ⚠️ `revokeAllForUser` existe hoje com a assinatura
    // `(userId, exceptSessionId)`, usada pelo `change-password`. CONFIRA a
    // assinatura real antes de chamar: se ela exigir a sessão a poupar, o
    // ajuste para aceitar "nenhuma" é parte desta tarefa, e o teste de
    // "derruba TODAS as sessões" é o que prova que ficou certo.
    await sessionsRepository.revokeAllForUser(linha.restaurantUserId, ...);
  });
}
```

- [ ] **Step 4: A outra ponta**

Em `changePassword`, depois de gravar a senha nova, chamar
`passwordResetRepository.softDeleteLiveForUser(userId)`. Se a pessoa lembrou da
senha e a trocou, um token pedido antes não pode continuar valendo uma hora.

- [ ] **Step 5: A rota**

`POST /auth/reset-password`, pública, com `schema.response` para 200 e 400. O
corpo da resposta **não** carrega token nem dado do usuário.

- [ ] **Step 6: Verificar por mutação**

Tire o `revokeAllForUser`. Esperado: **FALHA** em "derruba TODAS as sessões".

Tire o `markUsed`. Esperado: **FALHA** em "não serve duas vezes".

Tire a checagem de `expiresAt`. Esperado: **FALHA** em "token expirado".

Tire a invalidação no `changePassword`. Esperado: **FALHA** na última.

- [ ] **Step 7: OpenAPI, suíte, commit**

```
feat(auth): ✨ troca a senha com o token de recuperação
```

---

### Task 5: Documentação e ponta a ponta

**Files:**
- Modify: `CLAUDE.md`, `.claude/rules/security.md`, `apps/api/test/password-reset.test.ts`

- [ ] **Step 1: E2E adversarial**

Percorra como quem perdeu o acesso: pede, lê o link, troca, entra com a nova, e
confirma que a antiga não entra e que a sessão velha morreu. Depois tente
**reusar** o link e tente um link de outra pessoa. Se achar divergência, reporte
com destaque em vez de corrigir quieto.

- [ ] **Step 2: `CLAUDE.md`**

- A lista "Público hoje, **e nada além disso**" ganha as duas rotas. Ela está
  escrita em formulação absoluta, então ficar desatualizada a torna falsa.
- A seção de acesso perde o aviso de que não há recuperação, e ganha o desenho:
  token de uso único com hash no banco, 202 sempre, envio fora do caminho da
  resposta, e por que o driver de console é recusado em produção.

- [ ] **Step 3: `.claude/rules/security.md`**

O **S30** hoje diz que a recuperação "ainda não existe". Passa a descrever o que
existe — e mantém o que continua faltando (permissão por ação).

⚠️ Não invente regra nova: descreva o que foi construído, no tom das outras.

- [ ] **Step 4: Commits separados**

E2E e documentação são mudanças lógicas diferentes.
