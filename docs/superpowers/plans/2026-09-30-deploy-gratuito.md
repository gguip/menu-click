# Deploy em plano gratuito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o MenuClick pronto para subir em Render (API), Neon (Postgres) e Vercel (app e painel) sob `gguip.dev`, e deixar escrito o roteiro da primeira subida que o dono do projeto executa nas contas dele.

**Architecture:** O código ganha só o necessário para produção: a chave do limite de requisições lida do `CF-Connecting-IP` (o Render fica atrás do Cloudflare), o seed com lojas já verificadas, a volta das rotas do painel para o `index.html` na Vercel e o `render.yaml`. O resto é configuração nas plataformas, num roteiro em `docs/deploy.md`.

**Tech Stack:** Fastify 5 + `@fastify/rate-limit` 11 (API, TypeScript nativo do Node), Vite (painel), Next.js 16 (app), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-deploy-gratuito-design.md`

## Global Constraints

- Rode `unset -f node pnpm npm npx nvm 2>/dev/null;` antes de todo comando `node`/`pnpm`.
- Sem dependência nova.
- API: imports locais com `.ts`, só sintaxe apagável, `import type` (CLAUDE.md).
- Segredo nunca no repositório (S12): `render.yaml` marca segredo com `sync: false`; `.env.example` só com placeholder.
- Subdomínios: `menuclick.gguip.dev` (app), `painel.menuclick.gguip.dev` (painel), `api.menuclick.gguip.dev` (API).
- Regiões: Render `virginia`; Neon `AWS us-east-1`.
- `TRUST_PROXY=false` em produção; `CLIENT_IP_HEADER=cf-connecting-ip`.
- Ping do cron-job.org: `*/10 6-22 * * *`, fuso `America/Sao_Paulo`, em `GET /health`.
- Commits: `<tipo>(<escopo>): <emoji> <mensagem>` em pt-BR, sem rodapé de atribuição; commit só com testes e lint verdes pelo código de saída (encadeado com `&&`).

## Review Focus

1. **Header forjado:** um cliente que manda o próprio `CF-Connecting-IP` direto não pode escolher a chave do limite — no Render o Cloudflare sobrescreve; nos testes, o que vale é que o header configurado manda na chave e que requisição sem ele cai no `request.ip`. → testes na Task 1.
2. **`CLIENT_IP_HEADER` com lixo** (espaço, dois-pontos, vazio): valor inválido derruba o boot com mensagem clara; vazio é "desligado". → teste na Task 1.
3. **Seed num banco novo de produção:** as lojas nascem verificadas (senão 403 no painel e 404 no cardápio logo na primeira subida). → teste na Task 2.
4. **`/health` tocando no banco** faria o Neon ficar acordado o dia todo e estourar as 100 CU-h. → teste na Task 2.
5. **Rota do painel aberta direto** (`/pedidos` digitado ou recarregado) dá 404 na Vercel sem a volta para o `index.html`. → teste na Task 3.

---

### Task 1: Chave do limite de requisições pelo header do proxy (API)

**Files:**
- Modify: `apps/api/src/limits.ts` (`parseClientIpHeader`)
- Create: `apps/api/src/client-ip.ts` (`clientIpKey`)
- Modify: `apps/api/src/app.ts` (lê a variável no `buildApp` e passa o `keyGenerator`)
- Modify: `apps/api/.env.example`
- Test: `apps/api/test/client-ip.test.ts`

**Interfaces:**
- Produces: `parseClientIpHeader(value: string | undefined): string | null` (lança em nome inválido); `clientIpKey(header: string | null): (request: FastifyRequest) => string`; variável `CLIENT_IP_HEADER`.

As opções de limite por rota (login, cadastro, recuperação…) são **mescladas** às globais pelo plugin (`mergeParams` em `@fastify/rate-limit` 11), então o `keyGenerator` global cobre todas. O reenvio de verificação continua com a chave por usuário que já tem — ele só roda com sessão.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/client-ip.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseClientIpHeader } from "../src/limits.ts";
import { LOGIN_RATE_LIMIT_MAX } from "../src/limits.ts";
import { buildTestApp } from "./helpers.ts";

/**
 * No Render, o `X-Forwarded-For` chega como "cliente, borda do Cloudflare,
 * interno do Render" com o interno mudando a cada requisição: nem
 * `trustProxy` ligado nem um número de saltos dão a chave certa. O Cloudflare
 * sobrescreve o `CF-Connecting-IP` na borda — é ele a chave do limite.
 */
describe("IP do cliente pelo header do proxy", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip";
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    delete process.env.CLIENT_IP_HEADER;
    await app.close();
  });

  const login = (headers: Record<string, string>, remoteAddress: string) =>
    app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress,
      headers,
      payload: { email: "ninguem@exemplo.com", password: "senha-errada-123" },
    });

  it("o mesmo header vindo de endereços diferentes conta como um cliente só", async () => {
    const codes: number[] = [];
    for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
      codes.push((await login({ "cf-connecting-ip": "203.0.113.7" }, `10.0.0.${i + 1}`)).statusCode);
    }
    expect(codes.at(-1)).toBe(429);
  });

  it("headers diferentes contam separado", async () => {
    const codes: number[] = [];
    for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
      codes.push((await login({ "cf-connecting-ip": `198.51.100.${i + 1}` }, "10.0.1.1")).statusCode);
    }
    expect(codes).not.toContain(429);
  });

  it("sem o header na requisição, vale o endereço de sempre", async () => {
    const codes: number[] = [];
    for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
      codes.push((await login({}, "192.0.2.50")).statusCode);
    }
    expect(codes.at(-1)).toBe(429);
  });
});

describe("CLIENT_IP_HEADER", () => {
  it("vazio ou ausente é desligado; o nome vai para minúsculas", () => {
    expect(parseClientIpHeader(undefined)).toBeNull();
    expect(parseClientIpHeader("  ")).toBeNull();
    expect(parseClientIpHeader("CF-Connecting-IP")).toBe("cf-connecting-ip");
  });

  it("nome inválido derruba a subida", () => {
    expect(() => parseClientIpHeader("cf connecting ip")).toThrow(/CLIENT_IP_HEADER/);
    expect(() => parseClientIpHeader("x-ip:1")).toThrow(/CLIENT_IP_HEADER/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/client-ip.test.ts`
Expected: FAIL — `parseClientIpHeader` não existe (e, sem a chave pelo header, o primeiro teste não chega a 429, porque cada tentativa sai de um endereço).

- [ ] **Step 3: `limits.ts`**

Logo depois de `TRUST_PROXY`:

```ts
/** Nome de header HTTP (token da RFC 9110), já em minúsculas. */
const HEADER_NAME = /^[a-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * O header que carrega o IP do cliente, quando há um proxy que o SOBRESCREVE
 * — no Render, o Cloudflare escreve `CF-Connecting-IP` na borda com o IP de
 * quem conectou, e o cliente não consegue forjá-lo. Lá o `X-Forwarded-For`
 * não serve: chega como "cliente, borda, interno do Render" com o interno
 * mudando a cada requisição, e nem `trustProxy` nem um número de saltos dão
 * uma chave estável para o limite de requisições.
 *
 * ⚠️ Só é seguro onde TODA requisição passa por esse proxy. Em outra
 * hospedagem, deixe vazio: aí vale o `request.ip` (e o `TRUST_PROXY`).
 * Nome inválido derruba a subida — um erro de digitação aqui desligaria o
 * limite em silêncio.
 */
export function parseClientIpHeader(value: string | undefined): string | null {
  const name = value?.trim().toLowerCase() ?? "";
  if (name === "") return null;
  if (!HEADER_NAME.test(name)) {
    throw new Error(`CLIENT_IP_HEADER inválido: "${value}" não é um nome de header HTTP`);
  }
  return name;
}
```

- [ ] **Step 4: `client-ip.ts`**

```ts
// apps/api/src/client-ip.ts
import type { FastifyRequest } from "fastify";

/**
 * A chave do limite de requisições: o header configurado (ver
 * `parseClientIpHeader`), e o `request.ip` quando ele não veio — em dev, nos
 * testes, e em qualquer requisição que não passou pelo proxy.
 */
export function clientIpKey(header: string | null) {
  return (request: FastifyRequest): string => {
    if (header !== null) {
      const value = request.headers[header];
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string" && first.trim() !== "") return first.trim();
    }
    return request.ip;
  };
}
```

- [ ] **Step 5: `app.ts`**

No `buildApp()`, junto das outras pré-condições de subida (antes do `Fastify({...})`):

```ts
  /**
   * Terceira pré-condição: o header do IP do cliente, se configurado, tem que
   * ser um nome válido — ver `parseClientIpHeader` em `limits.ts`.
   */
  const clientIp = clientIpKey(parseClientIpHeader(process.env.CLIENT_IP_HEADER));
```

e no `app.register(rateLimit, { ... })`, depois de `timeWindow`:

```ts
    // a chave é o cliente, não o salto de proxy — ver `clientIpKey`
    keyGenerator: clientIp,
```

Atualize o comentário acima do `register` ("`request.ip` respeita o `trustProxy`…") para dizer que a chave sai de `clientIpKey`: o header do proxy quando configurado, senão o `request.ip`.

Imports: `import { clientIpKey } from "./client-ip.ts";` e `parseClientIpHeader` de `./limits.ts`.

- [ ] **Step 6: `.env.example`**

Depois do bloco do `TRUST_PROXY`:

```bash
# Header que carrega o IP do cliente, quando há um proxy que o SOBRESCREVE.
# No Render (atrás do Cloudflare): cf-connecting-ip — lá o X-Forwarded-For
# muda a cada requisição e não serve de chave para o limite de requisições.
# VAZIO = desligado (vale o IP da conexão e o TRUST_PROXY). Só configure onde
# TODA requisição passa pelo proxy; nome inválido derruba a subida.
CLIENT_IP_HEADER=
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/client-ip.test.ts test/rate-limit.test.ts`
Expected: PASS.

Mutação obrigatória: tire o `keyGenerator: clientIp` do `register` e confirme que "o mesmo header vindo de endereços diferentes…" cai; desfaça.

- [ ] **Step 8: Suíte e commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api test && pnpm lint && pnpm build`
Expected: tudo verde.

```bash
git add apps/api
git commit -m "feat(api): ✨ lê o IP do cliente do header do proxy para o limite de requisições"
```

### Task 2: Seed com lojas verificadas e o `/health` longe do banco (API)

**Files:**
- Modify: `apps/api/src/db/seed.sql` (coluna `email_verified_at` no insert de restaurantes)
- Test: `apps/api/test/seed.test.ts`, `apps/api/test/health.test.ts` (criar se não existir; se existir, acrescentar o caso)

**Interfaces:**
- Produces: seed com `email_verified_at = now()` nas lojas; teste que prende o `/health` fora do banco.

- [ ] **Step 1: Write the failing tests**

Em `apps/api/test/seed.test.ts`, dentro do `describe("seed de exemplo")`:

```ts
  // num banco novo de produção, loja sem verificação nasce bloqueada: 403 no
  // painel e 404 no cardápio logo na primeira subida
  it("as lojas do seed nascem verificadas", async () => {
    const seed = await readFile(new URL("../src/db/seed.sql", import.meta.url), "utf8");
    await pool.query(seed);
    const { rows } = await pool.query(
      `select slug from restaurants where deleted_at is null and email_verified_at is null`,
    );
    expect(rows).toEqual([]);
  });
```

Em `apps/api/test/health.test.ts` (crie com o esqueleto dos outros testes se ele não existir):

```ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp } from "./helpers.ts";

describe("health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // 🚨 o ping do cron-job.org chama o /health a cada 10 min: se ele tocar no
  // banco, o Neon fica acordado o dia todo e estoura as 100 CU-h do mês
  it("responde sem tocar no banco", async () => {
    const query = vi.spyOn(pool, "query");
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
  });
});
```

- [ ] **Step 2: Run them**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/seed.test.ts test/health.test.ts`
Expected: o do seed FALHA (as lojas saem com `email_verified_at` nulo); o do `/health` PASSA — ele é uma rede para o comportamento de hoje. Confirme que ele é uma rede de verdade: acrescente temporariamente `await pool.query("select 1")` no handler do `/health`, veja o teste cair, e desfaça.

- [ ] **Step 3: Seed**

No `insert into restaurants` de `apps/api/src/db/seed.sql`, acrescente `email_verified_at` à lista de colunas e `now()` ao fim de **cada** tupla de `values`, com um comentário:

```sql
-- `email_verified_at` preenchido: loja do seed é loja de demonstração, e num
-- banco novo (produção incluída) sem isto ela nasceria bloqueada — 403 no
-- painel e 404 no cardápio. Banco que já tinha as lojas não muda (o
-- `on conflict do nothing` não toca na linha).
```

- [ ] **Step 4: Run and commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/seed.test.ts test/health.test.ts && pnpm --filter @menuclick/api test && pnpm lint`
Expected: tudo verde.

```bash
git add apps/api
git commit -m "fix(api): 🐛 faz o seed criar lojas verificadas e prende o /health fora do banco"
```

### Task 3: Rotas do painel na Vercel

**Files:**
- Create: `apps/panel/vercel.json`
- Test: `apps/panel/test/vercel-config.test.ts`

**Interfaces:**
- Produces: `vercel.json` com `rewrites: [{ source: "/(.*)", destination: "/index.html" }]`.

A Vercel serve os arquivos estáticos primeiro e só aplica a reescrita ao que não é arquivo — os assets do `dist/` continuam saindo direto.

- [ ] **Step 1: Write the failing test**

```ts
// apps/panel/test/vercel-config.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// o painel é SPA: /pedidos digitado ou recarregado não existe como arquivo, e
// sem a volta para o index.html a Vercel responde 404
describe("vercel.json do painel", () => {
  it("devolve o index.html para toda rota que não é arquivo", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"));
    expect(config.rewrites).toContainEqual({ source: "/(.*)", destination: "/index.html" });
  });
});
```

- [ ] **Step 2: Run it**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/vercel-config.test.ts`
Expected: FAIL — `ENOENT` no `vercel.json`.

- [ ] **Step 3: `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- [ ] **Step 4: Run and commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm lint`
Expected: verde.

```bash
git add apps/panel
git commit -m "chore(panel): 🔧 devolve as rotas do painel para o index.html na Vercel"
```

### Task 4: `render.yaml`, roteiro de deploy e documentação

**Files:**
- Create: `render.yaml`
- Create: `docs/deploy.md` (o roteiro da primeira subida e da verificação)
- Modify: `CLAUDE.md` (seção "Deploy"; `CLIENT_IP_HEADER` em "Limites de exposição")
- Modify: `README.md` (seção de deploy curta, apontando para `docs/deploy.md`)
- Modify: `docs/superpowers/specs/2026-09-30-deploy-gratuito-design.md` (estado)
- Test: `apps/api/test/render-config.test.ts`

**Interfaces:**
- Consumes: `CLIENT_IP_HEADER` (Task 1); seed verificado (Task 2); `vercel.json` do painel (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/render-config.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// o render.yaml é a configuração do deploy da API; estes são os pontos que,
// errados, derrubam produção em silêncio ou vazam segredo
describe("render.yaml", () => {
  const yaml = readFileSync(resolve(process.cwd(), "../../render.yaml"), "utf8");

  it("uma instância gratuita, com verificação de saúde e deploy só com o CI verde", () => {
    expect(yaml).toMatch(/plan: free/);
    expect(yaml).toMatch(/healthCheckPath: \/health/);
    expect(yaml).toMatch(/autoDeployTrigger: checksPass/);
    expect(yaml).toMatch(/region: virginia/);
  });

  it("roda as migrations antes do servidor", () => {
    expect(yaml).toMatch(/startCommand: .*migrate:up.*&&.*start/);
  });

  it("segredos nunca têm valor no arquivo", () => {
    for (const key of ["DATABASE_URL", "SMTP_URL"]) {
      const block = yaml.slice(yaml.indexOf(`key: ${key}`), yaml.indexOf(`key: ${key}`) + 80);
      expect(block, key).toMatch(/sync: false/);
      expect(block, key).not.toMatch(/value:/);
    }
  });

  it("IP do cliente pelo header do Cloudflare, sem confiar no X-Forwarded-For", () => {
    expect(yaml).toMatch(/key: CLIENT_IP_HEADER\s+value: cf-connecting-ip/);
    expect(yaml).toMatch(/key: TRUST_PROXY\s+value: "false"/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/render-config.test.ts`
Expected: FAIL — `ENOENT` no `render.yaml`.

- [ ] **Step 3: `render.yaml`**

```yaml
# Deploy da API do MenuClick no Render (plano gratuito). Roteiro completo, com
# as contas e o DNS, em docs/deploy.md. Segredos (sync: false) são pedidos
# pelo Render na criação e NUNCA ficam neste arquivo (S12).
services:
  - type: web
    name: menuclick-api
    runtime: node
    plan: free
    # perto do Neon (AWS us-east-1): API e banco no mesmo lado do oceano
    region: virginia
    rootDir: ./
    buildCommand: corepack enable && pnpm install --frozen-lockfile --filter "@menuclick/api..."
    # migrations antes do listen: uma instância só, sem subida concorrente
    # (o gancho de pré-deploy do Render é pago)
    startCommand: pnpm --filter @menuclick/api migrate:up && pnpm --filter @menuclick/api start
    healthCheckPath: /health
    # publica só depois do CI verde no GitHub
    autoDeployTrigger: checksPass
    envVars:
      - key: NODE_VERSION
        value: "24"
      - key: NODE_ENV
        value: production
      - key: TRUST_PROXY
        value: "false"
      # o Render fica atrás do Cloudflare, que sobrescreve este header na borda
      - key: CLIENT_IP_HEADER
        value: cf-connecting-ip
      - key: DATABASE_URL
        sync: false
      - key: DB_POOL_MAX
        value: "5"
      - key: CORS_ORIGINS
        value: https://menuclick.gguip.dev,https://painel.menuclick.gguip.dev
      - key: MENU_BASE_URL
        value: https://menuclick.gguip.dev
      - key: EMAIL_DRIVER
        value: smtp
      - key: SMTP_URL
        sync: false
      - key: EMAIL_FROM
        value: MenuClick <menuclick@gguip.dev>
      - key: PASSWORD_RESET_URL
        value: https://painel.menuclick.gguip.dev/recuperar-senha
      - key: EMAIL_VERIFICATION_URL
        value: https://painel.menuclick.gguip.dev/verificar-email
```

- [ ] **Step 4: Run it**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/render-config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: `docs/deploy.md`**

Escreva o roteiro, em pt-BR, com estas seções e estes passos (os valores exatos de CNAME cada plataforma mostra ao adicionar o domínio):

1. **Neon** — criar o projeto `menuclick` na região **AWS us-east-1**; copiar a connection string **direta** (não a "pooled") com `sslmode=require`.
2. **Resend** — na conta do TirzeFlow, criar a chave de API "menuclick" com permissão só de envio; o `SMTP_URL` fica `smtps://resend:<chave>@smtp.resend.com:465` (o domínio `gguip.dev` já está verificado).
3. **Render** — "New → Blueprint" apontando para o repositório; preencher `DATABASE_URL` e `SMTP_URL` quando pedido; conferir que o primeiro deploy aplicou as migrations nos logs; em "Settings → Custom Domains", adicionar `api.menuclick.gguip.dev`.
4. **Vercel, app** — novo projeto do repositório, **Root Directory `apps/menu`**, framework Next.js; variável `NEXT_PUBLIC_API_URL=https://api.menuclick.gguip.dev`; domínio `menuclick.gguip.dev`.
5. **Vercel, painel** — novo projeto, **Root Directory `apps/panel`**, framework Vite, output `dist`; variável `VITE_API_URL=https://api.menuclick.gguip.dev`; domínio `painel.menuclick.gguip.dev`.
6. **DNS do `gguip.dev`** — três registros **explícitos** (o curinga `*.gguip.dev` não pode decidir): `menuclick` e `painel.menuclick` em CNAME para o alvo que a Vercel mostrar; `api.menuclick` em CNAME para o `.onrender.com` do serviço. Nada nos registros do TirzeFlow e do Resend.
7. **Dados de demonstração** — rodar o seed uma vez contra o Neon (`DATABASE_URL=<neon> pnpm --filter @menuclick/api db:seed` da máquina local); trocar os e-mails dos donos por SQL no editor do Neon:
   ```sql
   update restaurant_users set email = '<seu-email>+tokyo@<domínio>'
    where email = 'dono@tokyoramen.com.br' and deleted_at is null;
   update restaurant_users set email = '<seu-email>+cantina@<domínio>'
    where email = 'dona@cantinadanona.com.br' and deleted_at is null;
   ```
   e definir as senhas pelo "Esqueci a senha" em `painel.menuclick.gguip.dev` — o que prova o envio pelo Resend.
8. **cron-job.org** — job `GET https://api.menuclick.gguip.dev/health`, agenda `*/10 6-22 * * *`, fuso `America/Sao_Paulo`, com aviso por e-mail em falha.
9. **Verificação**:
   - `curl -s https://api.menuclick.gguip.dev/health` → 200.
   - `https://menuclick.gguip.dev/tokyo-ramen-house` abre; o QR de uma mesa no painel aponta para `https://menuclick.gguip.dev/...`.
   - Pedido de entrega com acompanhamento em tempo real.
   - Seis logins errados seguidos, cada um com um `CF-Connecting-IP` forjado diferente (`curl -H "CF-Connecting-IP: 1.2.3.$i" ...`), dão **429** na sexta — o Cloudflare sobrescreve o header; e, logo depois, o login de outro aparelho (4G) **funciona** — a chave é por cliente.
   - `https://api.menuclick.gguip.dev/docs` → 404.
   - No dia seguinte, o histórico do cron-job.org mostra chamadas só entre 06:00 e 23:00.

Feche o documento com "Cuidados" (os mesmos da spec): o `/health` não toca no banco; nenhum outro serviço gratuito no workspace do Render; a API dorme das 23h às 6h e a primeira chamada leva ~1 min; `CLIENT_IP_HEADER` só vale atrás do Cloudflare.

- [ ] **Step 6: `CLAUDE.md`, README e spec**

- `CLAUDE.md`: em "Limites de exposição", um parágrafo sobre `CLIENT_IP_HEADER` (por que o `X-Forwarded-For` do Render não serve, que o Cloudflare sobrescreve o `CF-Connecting-IP`, que só é seguro atrás desse proxy, e que o `keyGenerator` global cobre as rotas com limite próprio porque o plugin mescla as opções); uma seção nova "Deploy" com a tabela de onde fica cada peça, os subdomínios, as regiões, o ping (horário e por quê), as cotas (750 h do Render, 100 CU-h do Neon, `/health` fora do banco), e o apontamento para `docs/deploy.md`; em "Comandos", nada novo.
- `README.md`: seção "Deploy" de três linhas com os endereços e o link para `docs/deploy.md`; tirar "Hospedagem e deploy" dos próximos passos.
- Spec: "aprovado, a implementar" → "implementado (subida pendente do roteiro)".

- [ ] **Step 7: Verificação completa e commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm lint && pnpm build && pnpm --filter @menuclick/pricing test && pnpm --filter @menuclick/api test && pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/menu test`
Expected: tudo verde.

```bash
git add render.yaml docs CLAUDE.md README.md apps/api/test/render-config.test.ts
git commit -m "chore: 🔧 adiciona o render.yaml e o roteiro do deploy gratuito"
```

### Task 5: Primeira subida (com o dono do projeto)

Não é código: é o `docs/deploy.md` executado nas contas do dono do projeto. O executor **não** cria conta, não mexe em DNS e não publica nada — conduz o roteiro com ele, passo a passo, e confere cada verificação.

- [ ] **Step 1:** Com o dono, seguir `docs/deploy.md` do passo 1 ao 8.
- [ ] **Step 2:** Rodar cada item da "Verificação" (passo 9) e anotar o resultado.
- [ ] **Step 3:** Se o teste do `CF-Connecting-IP` falhar (sem 429 com headers forjados, ou o 4G bloqueado junto), **parar**: é sinal de que o Render não está atrás do Cloudflare como a spec supõe, e a chave do limite precisa ser revista antes de abrir o link para alguém.
- [ ] **Step 4:** Qualquer ajuste de configuração descoberto na subida volta para o `render.yaml` ou para o `docs/deploy.md`, com commit `fix(deploy): 🐛 ...` ou `docs: 📝 ...`.
