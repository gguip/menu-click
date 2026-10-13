# Correção do e-mail no cadastro não verificado — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono de uma loja ainda não verificada corrige o próprio e-mail na tela bloqueada do painel, informando a senha atual, e recebe o link de verificação no endereço novo.

**Architecture:** Uma rota nova, `POST /auth/change-email`, autenticada e sem `:restaurantId` (por isso fora do gate de verificação, como o reenvio). O serviço confere loja não verificada, senha e colisão, e faz tudo numa transação; o token novo e o e-mail saem depois da resposta, pelo `sendEmailVerification` que o cadastro já usa. O painel ganha um formulário na `EmailBlockedPage`.

**Tech Stack:** Fastify + `pg` (SQL à mão) + Vitest de integração na API; React 19 + Mantine 9 + TanStack Query 5 + Testing Library no painel.

**Spec:** `docs/superpowers/specs/2026-10-13-correcao-de-email-design.md`

## Global Constraints

- Nenhuma dependência nova e nenhuma migration.
- Branch: `feat/correcao-de-email` (já existe, com a spec commitada).
- TypeScript nativo do Node: imports locais com extensão `.ts`, `import type` para tipos, sem `enum`.
- Três camadas: a rota não escreve SQL; o serviço não conhece Fastify; SQL só no repositório, sempre parametrizado (`$1`).
- Toda leitura e escrita filtra `deleted_at is null`; todo `update` grava `updated_at = now()`.
- Erro de negócio é erro tipado de `src/errors.ts` (`ConflictError` → 409, `UnauthorizedError` → 401); nenhuma rota monta corpo de erro.
- A rota declara `tags`, `summary`, `description` e `operationId`; depois, `pnpm --filter @menuclick/api openapi:generate`.
- A rota **não** entra na lista de rotas públicas de `test/authorization.test.ts` nem de `test/openapi.test.ts`.
- Mensagens exatas: `A troca de e-mail de uma conta já verificada ainda não está disponível`, `Senha atual incorreta`, `Este já é o e-mail cadastrado`, `O e-mail "<email>" já está cadastrado`.
- Teto: 3 por minuto, chave `request.auth?.userId ?? request.ip`.
- Painel: cor só por `var(--mc-*)`, sem transição; não há `jest-dom` (asserções com `toBeTruthy()` e propriedades do DOM).
- Código e identificadores em inglês; textos para o usuário em pt-BR.
- Commits no padrão `<tipo>(<escopo>): <emoji> <mensagem>`, sem trailer de atribuição.
- No shell não interativo, `node` e `pnpm` são funções do nvm que recursam: rode `unset -f node pnpm npm 2>/dev/null` antes dos comandos.
- A suíte da API precisa do Postgres local de pé.

## Review Focus

1. **E-mail novo com espaço nas pontas** (colado de outro lugar): a pessoa espera que funcione. O painel apara antes de enviar — teste na Task 3.
2. **Envio do formulário com campo vazio**: a pessoa espera um aviso na tela, não uma chamada que volta 400 em inglês. Teste na Task 3.
3. **Falha do SMTP depois da troca**: a troca vale e a resposta é 204; o reenvio passa a mandar para o endereço novo. Teste na Task 1 (o reenvio depois da troca vai para o endereço novo).
4. **O próprio cadastro de quem corrige já passou dos 7 dias**: a correção funciona e a loja de quem chama não é liberada pela própria chamada. Teste na Task 2.
5. **Clique duplo em "Corrigir e-mail"**: só uma chamada sai, mesmo com as duas submissões no mesmo tique. Teste na Task 3.

Fora do alcance desta fase, e registrado para a fase B: se o estranho dono da caixa de entrada errada abrir o link antes da correção, a loja fica verificada com o endereço errado, e a rota responde 409.

---

### Task 1: A rota `POST /auth/change-email`

**Files:**
- Modify: `apps/api/src/repositories/restaurant-users.ts` (depois de `updatePasswordHash`)
- Modify: `apps/api/src/services/auth.ts` (depois de `changePassword`)
- Modify: `apps/api/src/limits.ts` (depois de `EMAIL_RESEND_RATE_LIMIT_MAX`)
- Modify: `apps/api/src/routes/auth.ts` (schema depois de `changePasswordBodySchema`; rota no fim de `authRoutes`)
- Modify: `apps/api/openapi.json` (gerado)
- Create: `apps/api/test/change-email.test.ts`

**Interfaces:**
- Consumes (já existem): `restaurantUsersRepository.findByIdWithHash(id)`, `emailVerificationRepository.softDeleteLiveForUser(userId, db)`, `passwordResetRepository.softDeleteLiveForUser(userId, db)`, `sessionsRepository.revokeAllForUser(userId, exceptSessionId, db)`, `authService.sendEmailVerification(user)`, `track()`, `requireAuth(request)`.
- Produces:
  - `restaurantUsersRepository.updateEmail(id: string, email: string, db?: Queryable): Promise<RestaurantUser | "taken" | null>` — `"taken"` = e-mail em uso por outro usuário vivo; `null` = usuário não existe.
  - `authService.changeEmail(auth: AuthContext, currentPassword: string, newEmail: string): Promise<RestaurantUser>` — o usuário já com o e-mail novo.
  - `EMAIL_CHANGE_RATE_LIMIT_MAX = 3` em `limits.ts`.
  - Nesta task, e-mail em uso é sempre 409. A liberação de cadastro abandonado entra na Task 2.

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/test/change-email.test.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { clearOutbox } from "../src/email.ts";
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

  it("recusa e-mail malformado e campo a mais com 400", async () => {
    const { headers } = await registerAndLogin(app);

    const malformado = await changeEmail(headers, {
      currentPassword: senha,
      newEmail: "isto-nao-e-email",
    });
    expect(malformado.statusCode).toBe(400);

    const campoAMais = await changeEmail(headers, {
      currentPassword: senha,
      newEmail: uniqueEmail(),
      role: "owner",
    });
    expect(campoAMais.statusCode).toBe(400);
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
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @menuclick/api exec vitest run test/change-email.test.ts`
Expected: FAIL — as chamadas a `/auth/change-email` respondem 404 (a rota não existe).

- [ ] **Step 3: Repositório — `updateEmail`**

Em `apps/api/src/repositories/restaurant-users.ts`, logo depois de `updatePasswordHash`:

```ts
/**
 * Troca o e-mail de um usuário vivo.
 *
 * Três resultados, e os três importam para o serviço: a linha atualizada,
 * `"taken"` quando o endereço já é de outro usuário vivo (o índice único
 * parcial recusou — nunca um `select` antes, entre checar e gravar cabe outra
 * requisição), e `null` quando o usuário não existe ou já foi removido.
 */
export async function updateEmail(
  id: string,
  email: string,
  db: Queryable = pool,
): Promise<RestaurantUser | "taken" | null> {
  try {
    const { rows } = await db.query<RestaurantUserRow>(
      `update restaurant_users set email = $1, updated_at = now()
        where id = $2 and deleted_at is null
        returning *`,
      [email, id],
    );
    return rows.length === 0 ? null : toRestaurantUser(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return "taken";
    throw error;
  }
}
```

- [ ] **Step 4: Serviço — `changeEmail`**

Em `apps/api/src/services/auth.ts`, logo depois de `changePassword`:

```ts
/**
 * Uma tentativa de trocar o e-mail, dentro do seu savepoint.
 *
 * Mesmo motivo do `tryInsertUser`: no Postgres, um comando que falha aborta o
 * bloco inteiro, e a violação de unicidade daqui é seguida de mais queries (a
 * liberação de cadastro abandonado e a segunda tentativa).
 */
async function tryUpdateEmail(
  userId: string,
  email: string,
  db: Queryable,
): Promise<RestaurantUser | "taken" | null> {
  // nome fixo, escrito no código: identificador não aceita $n (S3)
  await db.query("savepoint email_attempt");
  const updated = await restaurantUsersRepository.updateEmail(userId, email, db);
  await db.query(
    updated === "taken"
      ? "rollback to savepoint email_attempt"
      : "release savepoint email_attempt",
  );
  return updated;
}

/**
 * Corrige o e-mail de quem chama — só enquanto a LOJA não foi verificada.
 *
 * É o caminho de volta de quem se cadastrou com o endereço errado (S30). Vale
 * na hora, sem confirmação prévia no endereço novo, e isso só é seguro aqui:
 * a loja não verificada está vazia, e a verificação que vem depois é a própria
 * confirmação — endereço que a pessoa não controla deixa a loja bloqueada como
 * estava. Em conta verificada nada disso vale, e por isso ela recebe 409.
 *
 * Exige a senha atual pelo mesmo motivo do `changePassword`, e com mais razão:
 * o login é por e-mail, então uma sessão roubada que trocasse o endereço
 * trancaria o dono para fora.
 *
 * Não cria o token novo nem manda e-mail: quem faz isso é a ROTA, depois de
 * responder, com `sendEmailVerification` — SMTP não segura a requisição.
 */
export async function changeEmail(
  auth: AuthContext,
  currentPassword: string,
  newEmail: string,
): Promise<RestaurantUser> {
  // antes da senha: não revela nada (a loja é a da sessão) e poupa o bcrypt
  if (auth.emailVerified) {
    throw new ConflictError(
      "A troca de e-mail de uma conta já verificada ainda não está disponível",
    );
  }

  const user = await restaurantUsersRepository.findByIdWithHash(auth.userId);
  if (user === null) throw new UnauthorizedError("Sessão inválida ou expirada");

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new UnauthorizedError("Senha atual incorreta");
  }

  if (newEmail === user.email) {
    throw new ConflictError("Este já é o e-mail cadastrado");
  }

  return withTransaction(async (client) => {
    const updated = await tryUpdateEmail(auth.userId, newEmail, client);

    if (updated === "taken") {
      throw new ConflictError(`O e-mail "${newEmail}" já está cadastrado`);
    }
    if (updated === null) {
      throw new UnauthorizedError("Sessão inválida ou expirada");
    }

    // O link antigo foi para o endereço errado: não pode destravar a loja.
    await emailVerificationRepository.softDeleteLiveForUser(auth.userId, client);
    // Um link de recuperação pedido antes está na caixa de um estranho, e ele
    // abre a conta.
    await passwordResetRepository.softDeleteLiveForUser(auth.userId, client);
    await sessionsRepository.revokeAllForUser(auth.userId, auth.sessionId, client);

    return updated;
  });
}
```

- [ ] **Step 5: Limite**

Em `apps/api/src/limits.ts`, logo depois de `EMAIL_RESEND_RATE_LIMIT_MAX`:

```ts
/**
 * Teto do `/auth/change-email`, por USUÁRIO como o do reenvio, e pelo mesmo
 * motivo: a rota exige sessão, e por IP duas lojas atrás do mesmo CGNAT
 * dividiriam o teto. Cada chamada roda um bcrypt (centenas de milissegundos,
 * de propósito) e, quando dá certo, manda um e-mail de verdade para um
 * endereço escolhido por quem chama. Três por minuto cobrem "errei de novo o
 * endereço" e não deixam uma sessão testar senha em volume.
 */
export const EMAIL_CHANGE_RATE_LIMIT_MAX = 3;
```

- [ ] **Step 6: Rota**

Em `apps/api/src/routes/auth.ts`:

a) No import de `../limits.ts`, acrescente `EMAIL_CHANGE_RATE_LIMIT_MAX,` (primeira linha da lista, em ordem alfabética).

b) Logo depois de `changePasswordBodySchema`:

```ts
const changeEmailBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["currentPassword", "newEmail"],
  properties: {
    // sem `minLength`, como no change-password: é conferida contra o hash
    currentPassword: { type: "string" },
    // os mesmos limites do e-mail do cadastro (`userInputSchema`)
    newEmail: { type: "string", format: "email", maxLength: 254 },
  },
};
```

c) No fim de `authRoutes`, depois da rota `/auth/change-password`:

```ts
  // Corrigir o próprio e-mail, enquanto a loja não foi verificada. Sem
  // `restaurantId` nos params, o bloqueio por e-mail não verificado não se
  // aplica aqui — como no reenvio, esta rota É o que resolve o bloqueio.
  app.post<{ Body: { currentPassword: string; newEmail: string } }>(
    "/auth/change-email",
    {
      config: {
        // Teto próprio, e por USUÁRIO — ver EMAIL_CHANGE_RATE_LIMIT_MAX em
        // limits.ts. A sessão já está resolvida quando o limitador roda (hook
        // de instância antes do de rota); o `?? ip` é o caminho que não
        // acontece.
        rateLimit: {
          max: EMAIL_CHANGE_RATE_LIMIT_MAX,
          timeWindow: RATE_LIMIT_WINDOW,
          keyGenerator: (request) => request.auth?.userId ?? request.ip,
        },
      },
      schema: {
        tags: ["Autenticação"],
        operationId: "changeEmail",
        summary: "Corrige o próprio e-mail antes da verificação",
        description:
          "O caminho de volta de quem se cadastrou com o endereço errado (S30). Só funciona enquanto a loja **não** foi verificada: a troca vale na hora, o link de verificação anterior deixa de valer e um novo é enviado ao endereço novo. Exige a senha **atual** mesmo havendo sessão (senha errada é 401), invalida qualquer link de recuperação de senha pendente e revoga as **demais** sessões do usuário. Loja já verificada recebe 409 — a troca com confirmação no endereço novo ainda não existe. E-mail igual ao atual ou já usado por outra conta também é 409. Limite de 3 requisições por minuto **por usuário** (429 ao estourar).",
        body: changeEmailBodySchema,
        response: {
          204: { type: "null" },
          400: errorResponseSchema,
          401: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { currentPassword, newEmail } = request.body;
      const user = await authService.changeEmail(
        requireAuth(request),
        currentPassword,
        newEmail,
      );
      reply.code(204).send();

      // Depois de responder, e sem `await` — mesmo motivo do cadastro: e-mail
      // é rede. Falha vai só para o log (nunca o token, S13); a troca já
      // valeu, e o reenvio manda para o endereço novo.
      track(
        authService.sendEmailVerification(user).catch((error) => {
          request.log.error(
            { err: error },
            "falha ao enviar e-mail de verificação depois da troca de e-mail",
          );
        }),
      );
    },
  );
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @menuclick/api exec vitest run test/change-email.test.ts`
Expected: PASS, 12 testes.

- [ ] **Step 8: Regerar o OpenAPI e rodar a suíte inteira**

Run: `pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test && pnpm --filter @menuclick/api build && pnpm lint`
Expected: tudo verde. `test/authorization.test.ts` e `test/openapi.test.ts` passam sem mexer nas listas de rotas públicas.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src apps/api/test/change-email.test.ts apps/api/openapi.json
git commit -m "feat(auth): ✨ adiciona a correção de e-mail da loja não verificada"
```

---

### Task 2: Cadastro abandonado na colisão, e o teto por usuário

**Files:**
- Modify: `apps/api/src/services/auth.ts` (`changeEmail`, o bloco da transação)
- Modify: `apps/api/test/change-email.test.ts` (casos novos, dentro do mesmo `describe`)
- Modify: `apps/api/test/rate-limit.test.ts` (dois casos novos, depois dos do reenvio)

**Interfaces:**
- Consumes: `changeEmail` e `tryUpdateEmail` da Task 1; `restaurantUsersRepository.findRestaurantIdByEmail(email, db): Promise<string | null>`; `restaurantsService.releaseAbandonedRegistration(restaurantId, db): Promise<boolean>`; `EMAIL_CHANGE_RATE_LIMIT_MAX`.
- Produces: nenhuma assinatura nova. Muda o comportamento: e-mail preso por cadastro abandonado (não verificado, criado há mais de 7 dias) deixa de ser 409.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/test/change-email.test.ts`, antes do fechamento do `describe`:

```ts
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
      await envelhece(abandonado.restaurant.id, 8);
      const { headers } = await registerAndLogin(app);

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
      await envelhece(verificada.id, 400);
      const { headers } = await registerAndLogin(app);

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
```

Em `apps/api/test/rate-limit.test.ts`, acrescente `EMAIL_CHANGE_RATE_LIMIT_MAX,` ao import de `../src/limits.ts` e, logo depois do teste "o reenvio esgotado de uma loja não tranca a loja vizinha no mesmo IP":

```ts
  it(`a ${EMAIL_CHANGE_RATE_LIMIT_MAX + 1}ª troca de e-mail da mesma sessão é 429, mesmo trocando de IP`, async () => {
    const { headers } = await registerAndLogin(app);
    // senha errada de propósito: o 401 conta para o teto e não troca nada
    const payload = {
      currentPassword: "senha-errada-999",
      newEmail: uniqueEmail(),
    };

    const respostas = [];
    for (let i = 0; i < EMAIL_CHANGE_RATE_LIMIT_MAX + 1; i++) {
      respostas.push(
        await app.inject({
          method: "POST",
          url: "/auth/change-email",
          remoteAddress: ipDedicado(),
          headers,
          payload,
        }),
      );
    }

    expect(
      respostas.slice(0, EMAIL_CHANGE_RATE_LIMIT_MAX).map((r) => r.statusCode),
    ).toEqual(Array(EMAIL_CHANGE_RATE_LIMIT_MAX).fill(401));
    expect(respostas.at(-1)?.statusCode).toBe(429);
  });

  it("a troca de e-mail esgotada de uma loja não tranca a vizinha no mesmo IP", async () => {
    const compartilhado = ipDedicado();
    const gastadora = await registerAndLogin(app);
    const vizinha = await registerAndLogin(app);
    const payload = {
      currentPassword: "senha-errada-999",
      newEmail: uniqueEmail(),
    };

    for (let i = 0; i < EMAIL_CHANGE_RATE_LIMIT_MAX + 1; i++) {
      await app.inject({
        method: "POST",
        url: "/auth/change-email",
        remoteAddress: compartilhado,
        headers: gastadora.headers,
        payload,
      });
    }

    const response = await app.inject({
      method: "POST",
      url: "/auth/change-email",
      remoteAddress: compartilhado,
      headers: vizinha.headers,
      payload,
    });

    expect(response.statusCode).toBe(401);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @menuclick/api exec vitest run test/change-email.test.ts test/rate-limit.test.ts`
Expected: FAIL só em "libera o cadastro abandonado e faz a troca" (recebe 409, esperava 204). Os outros casos novos passam: três prendem o comportamento que a Task 1 já tem, e os dois de teto exercitam o `keyGenerator` da Task 1.

- [ ] **Step 3: Implementar a liberação**

Em `apps/api/src/services/auth.ts`, dentro de `changeEmail`, troque o começo da transação:

```ts
    const updated = await tryUpdateEmail(auth.userId, newEmail, client);
```

por:

```ts
    let updated = await tryUpdateEmail(auth.userId, newEmail, client);

    if (updated === "taken") {
      // A mesma regra do `register`, pela mesma função: se quem segura o
      // endereço é um cadastro abandonado, ele sai de cena e a troca tenta de
      // novo. Roda na transação de quem chamou — se algo falhar depois, o
      // rollback desfaz a liberação junto.
      const holderId = await restaurantUsersRepository.findRestaurantIdByEmail(
        newEmail,
        client,
      );
      if (
        holderId !== null &&
        (await restaurantsService.releaseAbandonedRegistration(holderId, client))
      ) {
        updated = await tryUpdateEmail(auth.userId, newEmail, client);
      }
    }
```

O restante da transação (os dois `if`, as três invalidações e o `return updated`) fica como está.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @menuclick/api exec vitest run test/change-email.test.ts test/rate-limit.test.ts`
Expected: PASS.

- [ ] **Step 5: Suíte inteira**

Run: `pnpm --filter @menuclick/api test && pnpm --filter @menuclick/api build && pnpm lint`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/auth.ts apps/api/test/change-email.test.ts apps/api/test/rate-limit.test.ts
git commit -m "feat(auth): ✨ libera cadastro abandonado na colisão da troca de e-mail"
```

---

### Task 3: O formulário na tela bloqueada do painel

**Files:**
- Modify: `apps/panel/src/api/auth.ts` (depois de `changePassword`)
- Modify: `apps/panel/src/features/access/EmailBlockedPage.tsx`
- Modify: `apps/panel/src/features/access/EmailBlockedPage.module.css`
- Modify: `apps/panel/test/email-blocked.test.tsx`

**Interfaces:**
- Consumes: `POST /auth/change-email` com `{ currentPassword, newEmail }` → 204; 401 `Senha atual incorreta`; 409 com mensagem em pt-BR; 429 com `Retry-After`. Do painel: `apiRequest`, `ApiError` (`status`, `message`, `retryAfterSeconds`), `describeError`, `useCountdown()` (`seconds`, `start(n)`), `formatCountdown`, `meQueryKey` de `auth/useMe.ts`.
- Produces: `changeEmail(currentPassword: string, newEmail: string): Promise<void>` em `apps/panel/src/api/auth.ts`.

Textos exatos da tela:
- Parágrafo: `Corrija aqui: informe o endereço certo e a senha da conta. O link de confirmação vai para o endereço novo, e o anterior deixa de valer.`
- Rótulos: `E-mail correto`, `Senha atual`. Botão: `Corrigir e-mail`.
- Sucesso: `E-mail corrigido. Enviamos o link de confirmação para o endereço novo.`
- Campo vazio: `Informe o e-mail correto e a senha atual.`
- Botão travado pelo 429: `Tentar de novo em 0:38` (com a contagem).

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/panel/test/email-blocked.test.tsx`:

a) Troque a linha de import da Testing Library por:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
```

b) **Remova** o teste `"não promete destravar o login só por esperar 7 dias (FIX 4)"`: o texto que ele prende deixa de existir.

c) Acrescente, antes do fechamento do `describe`:

```tsx
  const corrected = "joao@gmail.com";

  async function fillAndSubmit(email: string, password: string) {
    fireEvent.change(await screen.findByLabelText("E-mail correto"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Senha atual"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Corrigir e-mail" }));
  }

  it("corrige o e-mail e passa a mostrar o endereço novo", async () => {
    signIn();
    const api = mockApi([
      { ...me, once: true },
      { method: "GET", path: "/auth/me", body: makeMe({ emailVerified: false, email: corrected }) },
      { method: "POST", path: "/auth/change-email", status: 204 },
    ]);
    renderRoutes(routes, "/confirme-seu-email");

    // espaço nas pontas, como num endereço colado: o painel apara
    await fillAndSubmit(`  ${corrected} `, "senha-do-dono-123");

    expect(
      await screen.findByText("E-mail corrigido. Enviamos o link de confirmação para o endereço novo."),
    ).toBeTruthy();
    expect(await screen.findByText(corrected)).toBeTruthy();
    const call = api.calls.find((c) => c.path === "/auth/change-email");
    expect(call?.body).toEqual({ currentPassword: "senha-do-dono-123", newEmail: corrected });
    // o formulário recomeça vazio
    expect((screen.getByLabelText("E-mail correto") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Senha atual") as HTMLInputElement).value).toBe("");
  });

  it("senha errada mostra o erro e NÃO encerra a sessão", async () => {
    signIn();
    mockApi([
      me,
      {
        method: "POST",
        path: "/auth/change-email",
        status: 401,
        body: { statusCode: 401, error: "Unauthorized", message: "Senha atual incorreta" },
      },
    ]);
    renderRoutes(routes, "/confirme-seu-email");

    await fillAndSubmit(corrected, "senha-errada");

    expect(await screen.findByText("Senha atual incorreta")).toBeTruthy();
    expect(readSession()).not.toBeNull();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("409 mostra a mensagem da API", async () => {
    signIn();
    mockApi([
      me,
      {
        method: "POST",
        path: "/auth/change-email",
        status: 409,
        body: { statusCode: 409, error: "Conflict", message: `O e-mail "${corrected}" já está cadastrado` },
      },
    ]);
    renderRoutes(routes, "/confirme-seu-email");

    await fillAndSubmit(corrected, "senha-do-dono-123");

    expect(await screen.findByText(`O e-mail "${corrected}" já está cadastrado`)).toBeTruthy();
  });

  it("429 na correção trava o botão com a contagem", async () => {
    signIn();
    mockApi([
      me,
      {
        method: "POST",
        path: "/auth/change-email",
        status: 429,
        body: { message: "Rate limit exceeded" },
        headers: { "retry-after": "38" },
      },
    ]);
    renderRoutes(routes, "/confirme-seu-email");

    await fillAndSubmit(corrected, "senha-do-dono-123");

    const locked = await screen.findByRole("button", { name: "Tentar de novo em 0:38" });
    expect((locked as HTMLButtonElement).disabled).toBe(true);
    // o teto da correção é outro: o reenvio continua livre
    expect((screen.getByRole("button", { name: "Não recebi, reenviar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("campo vazio avisa na tela e não chama a API", async () => {
    signIn();
    const api = mockApi([me]);
    renderRoutes(routes, "/confirme-seu-email");

    await fillAndSubmit("   ", "");

    expect(await screen.findByText("Informe o e-mail correto e a senha atual.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/auth/change-email")).toBe(false);
  });

  it("clique duplo manda uma chamada só", async () => {
    signIn();
    const api = mockApi([
      me,
      { method: "POST", path: "/auth/change-email", status: 204 },
    ]);
    renderRoutes(routes, "/confirme-seu-email");

    fireEvent.change(await screen.findByLabelText("E-mail correto"), { target: { value: corrected } });
    fireEvent.change(screen.getByLabelText("Senha atual"), { target: { value: "senha-do-dono-123" } });
    const form = screen.getByRole("button", { name: "Corrigir e-mail" }).closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => {
      expect(api.calls.filter((c) => c.path === "/auth/change-email").length).toBe(1);
    });
    await screen.findByText("E-mail corrigido. Enviamos o link de confirmação para o endereço novo.");
    expect(api.calls.filter((c) => c.path === "/auth/change-email").length).toBe(1);
  });
```

`makeMe(overrides: Partial<Me>)` de `test/fixtures.ts` espalha a sobrescrita sobre o padrão, cujo e-mail é `gerencia@trattoriabella.com.br`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @menuclick/panel exec vitest run test/email-blocked.test.tsx`
Expected: FAIL nos seis testes novos — `Unable to find a label with the text of: E-mail correto`.

- [ ] **Step 3: Cliente da API**

Em `apps/panel/src/api/auth.ts`, depois de `changePassword`:

```ts
/**
 * Corrige o e-mail de uma loja ainda não verificada. Responde 204.
 *
 * Mesma armadilha do `changePassword`: o 401 daqui é "senha atual incorreta",
 * não sessão expirada — sem `expireOn401: false`, errar a senha deslogaria a
 * pessoa da única tela que resolve o problema dela.
 */
export function changeEmail(currentPassword: string, newEmail: string): Promise<void> {
  return apiRequest<void>("/auth/change-email", {
    method: "POST",
    body: { currentPassword, newEmail },
    expireOn401: false,
  });
}
```

- [ ] **Step 4: A tela**

Em `apps/panel/src/features/access/EmailBlockedPage.tsx`:

a) Imports — troque as linhas correspondentes por:

```tsx
import { Button, PasswordInput, TextInput } from "@mantine/core";
import { IconArrowUpRight } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Navigate } from "react-router";
import { changeEmail, resendVerification } from "../../api/auth.ts";
import { ApiError, describeError } from "../../api/client.ts";
import { LoadFailure, NeutralScreen } from "../../auth/ScreenStates.tsx";
import { useLogout } from "../../auth/useLogout.ts";
import { meQueryKey, useMe } from "../../auth/useMe.ts";
```

(as demais linhas de import — `formatCountdown`, `useCountdown`, `Notice`, os dois CSS — ficam como estão.)

b) Troque o comentário de documentação do componente por:

```tsx
/**
 * Sem rail e sem header: o painel está bloqueado, e mostrar a navegação
 * desabilitada só frustra. Endereço errado se corrige aqui mesmo, com a senha
 * da conta — a API só aceita a troca enquanto a loja não foi verificada.
 */
```

c) Dentro do componente, logo depois da declaração de `resend`:

```tsx
  const queryClient = useQueryClient();
  // Contagem própria: o teto da correção é outro, e travar o reenvio por causa
  // dela esconderia o botão que ainda funciona.
  const correctionCountdown = useCountdown();
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  // Ref, e não `correction.isPending`: duas submissões no mesmo tique (clique
  // duplo) leem o mesmo render, e as duas veriam `isPending` falso.
  const submitting = useRef(false);

  const correction = useMutation({
    mutationFn: () => changeEmail(currentPassword, newEmail.trim()),
    onSuccess: async () => {
      setNewEmail("");
      setCurrentPassword("");
      // o reenvio aceito antes era para o endereço antigo
      setSent(false);
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 429) {
        correctionCountdown.start(error.retryAfterSeconds ?? 60);
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
```

d) Logo depois de `const locked = countdown.seconds > 0;`:

```tsx
  const correctionLocked = correctionCountdown.seconds > 0;
```

e) Troque a `<section className={classes.wrong}>` inteira por:

```tsx
        <section className={classes.wrong}>
          <strong>O endereço está errado?</strong>
          <p>
            Corrija aqui: informe o endereço certo e a senha da conta. O link de confirmação vai
            para o endereço novo, e o anterior deixa de valer.
          </p>
          <form
            className={classes.form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              // submissão repetida (clique duplo, Enter duas vezes) não sai
              if (submitting.current || correctionLocked) return;
              const missing = newEmail.trim() === "" || currentPassword === "";
              setIncomplete(missing);
              if (missing) return;
              submitting.current = true;
              correction.mutate();
            }}
          >
            <TextInput
              label="E-mail correto"
              type="email"
              autoComplete="email"
              value={newEmail}
              disabled={correction.isPending}
              onChange={(event) => setNewEmail(event.currentTarget.value)}
            />
            <PasswordInput
              label="Senha atual"
              autoComplete="current-password"
              value={currentPassword}
              disabled={correction.isPending}
              onChange={(event) => setCurrentPassword(event.currentTarget.value)}
            />
            {incomplete && (
              <p role="alert" className={access.error}>
                Informe o e-mail correto e a senha atual.
              </p>
            )}
            {correction.isError && !incomplete && !correctionLocked && (
              <p role="alert" className={access.error}>
                {describeError(correction.error)}
              </p>
            )}
            {correction.isSuccess && !incomplete && (
              <p className={access.success}>
                E-mail corrigido. Enviamos o link de confirmação para o endereço novo.
              </p>
            )}
            <div className={classes.actions}>
              <Button type="submit" disabled={correctionLocked} loading={correction.isPending}>
                {correctionLocked
                  ? `Tentar de novo em ${formatCountdown(correctionCountdown.seconds)}`
                  : "Corrigir e-mail"}
              </Button>
            </div>
          </form>
          <div className={classes.actions}>
            {SUPPORT_URL && (
              <Button
                component="a"
                href={SUPPORT_URL}
                target="_blank"
                rel="noreferrer"
                variant="default"
                rightSection={<IconArrowUpRight size={16} />}
              >
                Falar com o suporte
              </Button>
            )}
            <Button
              variant="subtle"
              loading={logoutMutation.isPending}
              onClick={() => logoutMutation.mutate()}
            >
              Sair da conta
            </Button>
          </div>
        </section>
```

Em `apps/panel/src/features/access/EmailBlockedPage.module.css`, antes de `.actions`:

```css
.form {
  display: grid;
  gap: 10px;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @menuclick/panel exec vitest run test/email-blocked.test.tsx`
Expected: PASS, 11 testes (5 antigos + 6 novos).

Se "senha errada…" falhar porque a mensagem aparece duas vezes ou não aparece: `describeError` devolve `error.message` para 401, que é `Senha atual incorreta` — a asserção depende só disso.

- [ ] **Step 6: Suíte e build do painel**

Run: `pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: tudo verde.

- [ ] **Step 7: Conferir na tela**

Com a API e o painel em `pnpm dev`: cadastre uma loja com e-mail errado, entre, e na tela "Confirme o e-mail da loja" corrija o endereço. Confira que o card "Endereço cadastrado" muda, que o link novo aparece no log da API (driver de console) e que abri-lo libera o painel. Confira a tela em 375 px de largura.

- [ ] **Step 8: Commit**

```bash
git add apps/panel/src apps/panel/test/email-blocked.test.tsx
git commit -m "feat(panel): ✨ corrige o e-mail errado na tela de painel bloqueado"
```

---

### Task 4: Documentação

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/rules/security.md`
- Modify: `docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md` (tabela "Onde este desenho diverge do handoff")

**Interfaces:**
- Consumes: o comportamento entregue nas Tasks 1 a 3.
- Produces: nada de código.

- [ ] **Step 1: `CLAUDE.md` — o parágrafo do endereço errado**

Na seção "Acesso: papéis, senha, usuários e verificação de e-mail", substitua o parágrafo que começa com `⚠️ **O caminho de volta cobre quem não recebeu o e-mail, e NÃO quem digitou o endereço errado.**` (o parágrafo inteiro, até `não detalhe resolvido.`) por:

```markdown
**Quem digitou o endereço errado se corrige sozinho — enquanto a loja não foi verificada** (`POST /auth/change-email`). O `joao@gmial.com`, o caso que motivou a verificação, ficou várias PRs sem saída pela API: o reenvio ia para o mesmo endereço errado e sobrava esperar os 7 dias. A troca vale **na hora**, sem confirmar antes no endereço novo, e isso só é seguro aqui: a loja não verificada está vazia (a premissa mais abaixo), e a verificação que vem depois É a confirmação — endereço que a pessoa não controla deixa a loja bloqueada como estava. A rota exige a **senha atual** (o login é por e-mail: sessão roubada que trocasse o endereço trancaria o dono para fora), invalida o link de verificação anterior **e qualquer link de recuperação de senha pendente** (um reset pedido antes está na caixa de um estranho), revoga as demais sessões e manda o link novo depois de responder. E-mail preso por cadastro abandonado é liberado na colisão, pela mesma `releaseAbandonedRegistration` do cadastro.

⚠️ **Loja já verificada recebe 409, e essa metade do S30 continua aberta.** Trocar o e-mail de uma conta com dado dentro exige troca pendente e confirmação no endereço novo — é outra feature. O caso que sobra sem saída é estreito e real: se o dono da caixa de entrada errada abrir o link **antes** da correção, a loja fica verificada com o endereço errado. ⚠️ **Corrigir não reinicia o relógio de abandono** (decisão explícita): os 7 dias contam do `restaurants.created_at`, então quem corrige depois do sétimo dia pode perder o cadastro se alguém colidir com o slug ou o e-mail antes de o link novo ser aberto. Reiniciar o prazo deixaria alguém segurar um slug para sempre trocando de e-mail a cada seis dias.
```

- [ ] **Step 2: `CLAUDE.md` — as rotas fora do gate**

No parágrafo que começa com `🚨 **O que mantém a limpeza de cadastro abandonado segura é uma condição só`, faça três trocas:

- `são \`GET /restaurants\`, \`GET /auth/me\`, \`POST /auth/resend-verification\`, \`POST /auth/logout\` e \`POST /auth/change-password\` —` → `são \`GET /restaurants\`, \`GET /auth/me\`, \`POST /auth/resend-verification\`, \`POST /auth/logout\`, \`POST /auth/change-password\` e \`POST /auth/change-email\` —`
- `(sessão, senha, token de verificação)` → `(sessão, senha, e-mail, token de verificação)`
- `⚠️ Esse conjunto de cinco **não** está preso por teste` → `⚠️ Esse conjunto de seis **não** está preso por teste`

- [ ] **Step 3: `CLAUDE.md` — o teto por usuário**

Na seção "Limites de exposição", substitua `⚠️ **\`POST /auth/resend-verification\` é o único teto do projeto que NÃO tem o IP como chave:** ele conta por **usuário**, 3 por minuto` por `⚠️ **\`POST /auth/resend-verification\` e \`POST /auth/change-email\` são os dois tetos do projeto que NÃO têm o IP como chave:** contam por **usuário**, 3 por minuto cada`.

No fim do mesmo parágrafo, acrescente a frase: `A troca de e-mail entra pelo mesmo motivo e por mais um: cada chamada roda um bcrypt.`

- [ ] **Step 4: `CLAUDE.md` — o painel**

Na lista da seção "Painel da loja (`apps/panel`)", depois do item `⚠️ **"Trocar senha" (menu da conta) não trata 401 como sessão expirada.**`, acrescente:

```markdown
- **A tela de painel bloqueado corrige o e-mail errado** (`EmailBlockedPage`, formulário "E-mail correto" + "Senha atual"). `changeEmail()` passa `expireOn401: false` pelo mesmo motivo do `changePassword`. O teto da correção tem contagem **própria**, separada da do reenvio: são dois limites na API, e um não trava o botão do outro. No sucesso a tela invalida `meQueryKey` e o card mostra o endereço novo.
```

- [ ] **Step 5: `security.md` — o S32**

Em `.claude/rules/security.md`, no último parágrafo do S32, substitua do trecho `Quem **se cadastrou com o endereço errado**` até o fim do parágrafo (`não a dê por respondida.**`) por:

```markdown
Quem **se cadastrou com o endereço errado** — o `joao@gmial.com` que a própria spec da verificação levanta — passou a ter saída: `POST /auth/change-email` troca o endereço na hora, **só enquanto a loja não foi verificada**, exigindo a senha atual, invalidando os links de verificação e de recuperação pendentes e revogando as demais sessões. Sem confirmação prévia no endereço novo de propósito: a conta está vazia, e a verificação seguinte é a confirmação. **O que continua aberto é a conta já verificada** (409): trocar o e-mail de uma conta com dado dentro exige troca pendente e confirmação no endereço novo, senão vira sequestro de conta — e isso ainda não existe. A pergunta do S30 continua aberta nessa metade; não a dê por respondida.
```

E, na mesma frase que diz `são três das cinco rotas que ficam fora do gate — o \`CLAUDE.md\` lista as cinco`, troque por `são três das seis rotas que ficam fora do gate — o \`CLAUDE.md\` lista as seis`.

- [ ] **Step 6: A tabela de divergências do handoff**

Em `docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md`, acrescente uma linha ao fim da tabela "Onde este desenho diverge do handoff":

```markdown
| painel bloqueado: "Não é possível trocar o e-mail pelo painel" | formulário "E-mail correto" + "Senha atual" | a API ganhou `POST /auth/change-email` para a loja não verificada (spec de 2026-10-13) |
```

- [ ] **Step 7: Conferir que nada ficou dizendo o contrário**

Run: `grep -rn "gmial\|único teto do projeto\|conjunto de cinco\|lista as cinco" CLAUDE.md .claude/rules/security.md`
Expected: as ocorrências de `gmial` descrevem o caso como resolvido para a loja não verificada; nenhuma ocorrência de `único teto do projeto`, `conjunto de cinco` ou `lista as cinco`.

Run: `pnpm --filter @menuclick/api exec vitest run test/deploy-doc.test.ts`
Expected: PASS (o teste lê documentação; confirma que as edições não quebraram o que ele prende).

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md .claude/rules/security.md docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md
git commit -m "docs: 📝 documenta a correção de e-mail da loja não verificada"
```

---

## Depois das tasks

- Revisão da branch inteira contra a spec e este plano (agente `reviewer`), antes do PR.
- PR de `feat/correcao-de-email` para a `main`. O Render só publica depois do CI verde; não há migration nem variável de ambiente nova.
