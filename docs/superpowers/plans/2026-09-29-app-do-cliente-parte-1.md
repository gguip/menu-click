# App do cliente, parte 1 — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cliente escaneia o QR da mesa, abre o cardápio da loja, monta o pedido com opções e observação, e envia para a cozinha — que o painel já recebe.

**Architecture:** três frentes. (1) `packages/pricing`, o `unitPrice()` extraído da API, usado pela API e pelo app. (2) acréscimos à API: horário no cardápio público, capa e cor da marca, observação no item — com o painel mostrando/editando o que for dele. (3) `apps/menu`, Next.js 16 (App Router) + Tailwind 4: o cardápio renderiza no servidor com ISR de 60 s; mesa, carrinho e envio rodam no navegador. Regra de negócio do app mora em módulos puros (`src/lib/`), testados sem o Next.

**Tech Stack:** Fastify 5 + TS nativo no Node 24 + Postgres (API); Vite/React/Mantine (painel); Next.js 16.3, React 19.3, Tailwind 4.3 (`@tailwindcss/postcss`), Vitest + Testing Library + jsdom (app).

**Spec:** `docs/superpowers/specs/2026-09-29-app-do-cliente-parte-1-design.md`

## Global Constraints

- **Direção visual B · Balcão**; copy do protótipo (`docs/design/app-do-cliente/App do Cliente.dc.html` e `Estados e Design System.dc.html`) é literal. Desvios só os da tabela da spec.
- Tokens: ação `#1E5AE8` (temável por `brand_color`), tinta `#0B0D12`/`#5C6474`/`#8B93A5`, papel `#FFFFFF`/`#F4F6FA`/`#ECEFF5`, sucesso `#0B7A48`, atenção `#FFF4DB`/`#7A4E00`, erro `#A62B21`; Sora; raios chip 5 / campo 10 / card 12; margem lateral 16; alvo de toque ≥ 44 px; ação primária na faixa inferior.
- WCAG 2.2 AA; foco visível; todo campo com rótulo.
- API: regras de `CLAUDE.md` e `.claude/rules/*` (soft delete, `$n`, `schema.response`, `nullable` F12, migration por `migrate:create` com `Down` real, `openapi:generate` depois).
- Pacote `packages/pricing`: TypeScript só com sintaxe apagável, **um arquivo** (`src/index.ts`, sem import relativo interno).
- Sem dependência além das listadas na spec: `next`, `react`, `react-dom`, `tailwindcss`, `@tailwindcss/postcss` (+ tipos e ferramentas de teste já usadas no monorepo).
- Porta do app: **3000**. Env do app: `NEXT_PUBLIC_API_URL` (default `http://localhost:3333`).
- Rodar comandos com `unset -f node pnpm npm npx 2>/dev/null;` antes.
- Commits `<tipo>(<escopo>): <emoji> <mensagem>`, pt-BR, sem trailer.

## Review Focus

1. **Mesa via `searchParams` no servidor** mataria o ISR (a página vira dinâmica). A mesa é lida no navegador (`useSearchParams` dentro de `Suspense`). → teste na Task 9 (a página exporta `revalidate` e não lê `searchParams`).
2. **Observação só com espaços** ("   ") vira `null`, e não uma linha separada no carrinho nem no pedido. → testes nas Tasks 4 e 8.
3. **`localStorage` indisponível** (aba anônima/bloqueado): o carrinho funciona em memória, sem erro. → teste na Task 8.
4. **Loja pausada dentro do horário**: a tela mostra o estado de pausa, não "Aberto até 23h". → teste na Task 7.
5. **Cor da marca no limite** de contraste (4.5:1 exato) é aceita; um tom abaixo é recusado. → teste na Task 3.

---

## File Structure

**Pacote:** `packages/pricing/{package.json,tsconfig.json,src/index.ts,test/pricing.test.ts}` (o teste vem de `apps/api/test/option-price.test.ts`).

**API:** `migrations/<ts>_add-restaurant-branding.sql`, `migrations/<ts>_add-order-item-note.sql`; `src/domain/{option.ts,color.ts,restaurant.ts,menu.ts,order.ts}`; `src/services/{menu.ts,restaurants.ts,orders.ts}`; `src/repositories/{restaurants.ts,orders.ts}`; `src/routes/{schemas.ts,menu.ts,orders.ts,tracking.ts}`; testes novos `test/menu-opening.test.ts`, `test/restaurants.branding.test.ts`, `test/orders-note.test.ts`, `test/color.unit.test.ts`.

**Painel:** `src/api/types.ts`, `src/features/settings/{storeForm.ts,StoreDataPage.tsx}`, `src/features/orders/{OrderDrawer.tsx,presentation.ts}`, `src/features/kitchen/KitchenPage.tsx`, testes afetados.

**App `apps/menu`:**
- `package.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `vitest.config.ts`, `test/setup.ts`
- `src/app/{layout.tsx,globals.css,not-found.tsx}`, `src/app/[slug]/{page.tsx,not-found.tsx}`
- `src/lib/{api.ts,types.ts,money.ts,schedule.ts,selection.ts,cart.ts,checkout.ts}` — puros
- `src/components/{MenuApp.tsx,TableResolver.tsx,MenuHeader.tsx,StoreNotice.tsx,ProductGrid.tsx,ProductScreen.tsx,CartScreen.tsx,CheckoutScreen.tsx,SentScreen.tsx,BottomBar.tsx}`
- `test/*.test.ts(x)`

---

### Task 1: `packages/pricing` — o preço sai da API

**Files:**
- Create: `packages/pricing/package.json`, `packages/pricing/tsconfig.json`, `packages/pricing/src/index.ts`
- Move: `apps/api/test/option-price.test.ts` → `packages/pricing/test/pricing.test.ts`
- Modify: `apps/api/package.json` (dependência), `apps/api/src/domain/option.ts` (reexporta), `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `@menuclick/pricing` exporta `PRICE_RULES`, `type PriceRule`, `type PricedChoice`, `type PricedGroup`, `divideRounded(n, d)`, `groupContribution(rule, choices)`, `unitPrice(productPriceInCents, groups)` — assinaturas idênticas às de hoje em `apps/api/src/domain/option.ts`.

- [ ] **Step 1: Mover o teste e apontá-lo para o pacote (RED)**

```bash
mkdir -p packages/pricing/test packages/pricing/src
git mv apps/api/test/option-price.test.ts packages/pricing/test/pricing.test.ts
```

No topo do arquivo movido, trocar o import `from "../src/domain/option.ts"` por `from "../src/index.ts"`.

Criar `packages/pricing/package.json`:

```json
{
  "name": "@menuclick/pricing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

e `packages/pricing/tsconfig.json` copiando as `compilerOptions` de `apps/api/tsconfig.json` (NodeNext, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noEmit`, `strict`), com `"include": ["src", "test"]`.

Run: `pnpm install && pnpm --filter @menuclick/pricing test`
Expected: FAIL — `Failed to resolve import "../src/index.ts"`.

- [ ] **Step 2: Extrair o código**

`packages/pricing/src/index.ts` recebe, **sem mudar uma linha de lógica**, de `apps/api/src/domain/option.ts`: o comentário e a constante `PRICE_RULES`, o tipo `PriceRule`, `PricedChoice`, `PricedGroup`, `divideRounded`, `averageTotals` (não exportada), `groupContribution` e `unitPrice`, com os comentários. Abrir o arquivo com:

```ts
/**
 * A aritmética de dinheiro do cardápio, compartilhada pela API (que cobra) e
 * pelo app do cliente (que mostra o preço ao vivo). Um arquivo só e sem import
 * interno: a API roda `.ts` direto no Node (type stripping), e o Next o
 * compila por `transpilePackages`. Quem decide o valor cobrado continua sendo
 * a criação do pedido, que recalcula no servidor com ESTE mesmo código.
 */
```

Em `apps/api/src/domain/option.ts`, remover o que saiu e reexportar:

```ts
export {
  divideRounded,
  groupContribution,
  PRICE_RULES,
  unitPrice,
  type PricedChoice,
  type PricedGroup,
  type PriceRule,
} from "@menuclick/pricing";
import type { PriceRule } from "@menuclick/pricing";
```

(o `import type` é para os tipos locais do arquivo que usam `PriceRule`). Em `apps/api/package.json`, `dependencies`: `"@menuclick/pricing": "workspace:*"`.

- [ ] **Step 3: Conferir que o Node carrega o pacote**

Run: `pnpm install && cd apps/api && node -e "import('@menuclick/pricing').then(m => console.log(m.unitPrice(3000, [{ priceRule: 'highest', choices: [{ priceInCents: 4505, quantity: 1 }, { priceInCents: 5000, quantity: 1 }] }])))"`
Expected: `8000`.

Se o Node recusar com `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` (arquivo resolvido dentro de `node_modules`), registrar `Ruling:` e trocar a dependência por import relativo em `domain/option.ts` (`../../../../packages/pricing/src/index.ts`) — o pacote continua sendo a fonte única.

- [ ] **Step 4: Ver passar, suíte da API, CI, commit**

Run: `pnpm --filter @menuclick/pricing test && pnpm --filter @menuclick/pricing build && pnpm --filter @menuclick/api build && pnpm --filter @menuclick/api test`
Expected: pricing 11/11; API verde (a integração de opções e pedidos prova que nada mudou).

CI (`.github/workflows/ci.yml`), antes de "Test": 

```yaml
      - name: Test (pricing)
        run: pnpm --filter @menuclick/pricing run test
```

```bash
git add packages apps/api .github pnpm-lock.yaml
git commit -m "refactor(pricing): ♻️ extrai o cálculo de preço para um pacote compartilhado"
```

---

### Task 2: API — horário no cardápio público

**Files:**
- Modify: `apps/api/src/domain/menu.ts`, `src/services/menu.ts` (`getRestaurant`, `toMenuRestaurant`), `src/routes/menu.ts` (schema do `GET /menu/:slug`)
- Test: `apps/api/test/menu-opening.test.ts`

**Interfaces:**
- Consumes: `openingHoursRepository.findOpeningStatus(restaurantId, timezone, at?)`.
- Produces: `GET /menu/:slug` com `closesAt?: string`, `opensAt?: string` (só grade) e `timezone: string`; `isOpen` segue sendo grade E pausa.

- [ ] **Step 1: Teste que falha**

```ts
// apps/api/test/menu-opening.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createRestaurant, setOpeningHours } from "./helpers.ts";

/** "Aberto até 23h" / "Abre amanhã às 18h" no cardápio público. */
describe("horário no cardápio público", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const menu = async (slug: string) => (await app.inject({ method: "GET", url: `/menu/${slug}` })).json();

  it("aberta direto (grade 24x7): isOpen sem closesAt", async () => {
    const r = await createRestaurant(app); // o helper registra a grade sempre aberta
    const body = await menu(r.slug);
    expect(body.isOpen).toBe(true);
    expect(body.closesAt).toBeUndefined();
    expect(body.opensAt).toBeUndefined();
  });

  it("sem grade: fechada, sem opensAt", async () => {
    const r = await createRestaurant(app);
    await setOpeningHours(app, r, []);
    const body = await menu(r.slug);
    expect(body.isOpen).toBe(false);
    expect(body.opensAt).toBeUndefined();
  });

  it("fora da faixa de hoje: opensAt no futuro", async () => {
    const r = await createRestaurant(app);
    // uma faixa curta em TODO dia, que nunca contém o agora (a hora local
    // atual + 2h..+3h) — só para existir uma próxima abertura
    const { rows } = await (await import("../src/db/pool.ts")).pool.query<{ h: number }>(
      `select extract(hour from now() at time zone 'America/Sao_Paulo')::int as h`,
    );
    const start = String((rows[0].h + 2) % 24).padStart(2, "0");
    const end = String((rows[0].h + 3) % 24).padStart(2, "0");
    await setOpeningHours(
      app,
      r,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: `${start}:00`, closesAt: `${end}:00` })),
    );
    const body = await menu(r.slug);
    expect(body.isOpen).toBe(false);
    expect(Date.parse(body.opensAt)).toBeGreaterThan(Date.now());
  });

  // O app precisa do fuso para dizer "23h" no horário DA LOJA. Até aqui o
  // fuso ficava fora do cardápio público por S10 (nada sai sem decisão); esta
  // é a decisão: fuso não é dado sensível, e sem ele o app erraria a hora.
  it("expõe o fuso da loja", async () => {
    const r = await createRestaurant(app, { timezone: "America/Manaus" });
    expect((await menu(r.slug)).timezone).toBe("America/Manaus");
  });

  it("pausada dentro do horário: isOpen false, e o horário da grade continua lá", async () => {
    const r = await createRestaurant(app);
    await app.inject({
      method: "PATCH",
      url: `/restaurants/${r.id}`,
      headers: r.headers,
      payload: { acceptingOrders: false },
    });
    const body = await menu(r.slug);
    expect(body.isOpen).toBe(false);
    expect(body.acceptingOrders).toBe(false);
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/menu-opening.test.ts`
Expected: FAIL no teste do `opensAt` (campo ausente).

- [ ] **Step 3: Implementar**

`domain/menu.ts`: `"timezone"` entra no `Pick` de `MenuRestaurant`, `toMenuRestaurant()` o copia (`timezone: restaurant.timezone,`) e o `schema.response` de `routes/menu.ts` ganha `timezone: { type: "string" },` — os três lugares da S10, deliberadamente. No tipo `MenuRestaurant` (depois de `isOpen`):

```ts
  /** Fim do trecho aberto da GRADE; ausente se aberta direto ou fechada. */
  closesAt?: string;
  /** Próxima abertura da GRADE; ausente se aberta ou sem grade. */
  opensAt?: string;
```

`services/menu.ts`, `getRestaurant`: trocar `isOpenNow` por `findOpeningStatus` e passar o status ao mapper:

```ts
  const [status, grade] = await Promise.all([
    openingHoursRepository.findOpeningStatus(restaurant.id, restaurant.timezone),
    openingHoursRepository.findByRestaurant(restaurant.id),
  ]);

  // aberta = grade E ninguém pausou; os horários falam só da grade
  return toMenuRestaurant(restaurant, status.isOpen && restaurant.acceptingOrders, grade, status);
```

`toMenuRestaurant` ganha o parâmetro `status: OpeningStatus` e, logo depois de `isOpen,`:

```ts
    ...(status.closesAt === undefined ? {} : { closesAt: status.closesAt }),
    ...(status.opensAt === undefined ? {} : { opensAt: status.opensAt }),
```

`routes/menu.ts`, no `schema.response` do restaurante público, depois de `isOpen`:

```ts
    // só a GRADE (a pausa está em `acceptingOrders`): "Aberto até 23h" usa
    // closesAt; "Abre amanhã às 18h" usa opensAt. Ausentes quando não há o
    // que dizer (aberta direto / sem grade).
    closesAt: { type: "string" },
    opensAt: { type: "string" },
```

- [ ] **Step 4: Ver passar, suíte, OpenAPI, commit**

Run: `cd apps/api && pnpm exec vitest run test/menu-opening.test.ts test/menu-public.test.ts test/store-open.test.ts && pnpm exec tsc --noEmit && pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test`
Expected: tudo verde.

```bash
git add apps/api
git commit -m "feat(menu): ✨ diz no cardápio público até quando a loja abre ou fecha"
```

---

### Task 3: API — capa e cor da marca

**Files:**
- Create: `apps/api/migrations/<ts>_add-restaurant-branding.sql`, `apps/api/src/domain/color.ts`
- Modify: `src/domain/restaurant.ts`, `src/domain/menu.ts`, `src/repositories/restaurants.ts` (row, mapper, mapa de colunas), `src/services/restaurants.ts` (validação), `src/services/menu.ts`, `src/routes/schemas.ts` (update body + response), `src/routes/menu.ts`
- Test: `apps/api/test/color.unit.test.ts`, `apps/api/test/restaurants.branding.test.ts`

**Interfaces:**
- Produces: `contrastWithWhite(hex: string): number` e `MIN_ACTION_CONTRAST = 4.5` em `domain/color.ts`; `Restaurant.coverUrl?: string`, `Restaurant.brandColor?: string`; `PATCH` aceita `coverUrl: string|null`, `brandColor: string|null`; cardápio público devolve `coverUrl?`, `brandColor?`.

- [ ] **Step 1: Testes que falham**

```ts
// apps/api/test/color.unit.test.ts
import { describe, expect, it } from "vitest";
import { contrastWithWhite, MIN_ACTION_CONTRAST } from "../src/domain/color.ts";

describe("contraste da cor de ação com o texto branco", () => {
  it("o azul do design passa folgado", () => {
    expect(contrastWithWhite("#1E5AE8")).toBeGreaterThan(MIN_ACTION_CONTRAST);
  });
  it("preto é o máximo (21:1) e branco o mínimo (1:1)", () => {
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 1);
    expect(contrastWithWhite("#FFFFFF")).toBeCloseTo(1, 5);
  });
  it("amarelo não passa", () => {
    expect(contrastWithWhite("#F5C518")).toBeLessThan(MIN_ACTION_CONTRAST);
  });
  it("#767676 é o cinza de fronteira do AA (≈ 4.54:1) e passa", () => {
    expect(contrastWithWhite("#767676")).toBeGreaterThanOrEqual(MIN_ACTION_CONTRAST);
    expect(contrastWithWhite("#777777")).toBeLessThan(MIN_ACTION_CONTRAST);
  });
});
```

```ts
// apps/api/test/restaurants.branding.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createRestaurant, type TestRestaurant } from "./helpers.ts";

describe("capa e cor da marca", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const patch = (r: TestRestaurant, payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: `/restaurants/${r.id}`, headers: r.headers, payload });

  it("salva e sai no cardápio público", async () => {
    const r = await createRestaurant(app);
    const res = await patch(r, { coverUrl: "https://example.com/capa.jpg", brandColor: "#0B7A48" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ coverUrl: "https://example.com/capa.jpg", brandColor: "#0B7A48" });
    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu).toMatchObject({ coverUrl: "https://example.com/capa.jpg", brandColor: "#0B7A48" });
  });

  it("null tira os dois", async () => {
    const r = await createRestaurant(app);
    await patch(r, { coverUrl: "https://example.com/capa.jpg", brandColor: "#0B7A48" });
    const res = await patch(r, { coverUrl: null, brandColor: null });
    expect(res.json().coverUrl).toBeUndefined();
    expect(res.json().brandColor).toBeUndefined();
  });

  it("cor sem contraste com o branco é 400, com a razão na mensagem", async () => {
    const r = await createRestaurant(app);
    const res = await patch(r, { brandColor: "#F5C518" });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/contraste/i);
  });

  it("formato fora de #RRGGBB é 400", async () => {
    const r = await createRestaurant(app);
    expect((await patch(r, { brandColor: "blue" })).statusCode).toBe(400);
    expect((await patch(r, { brandColor: "#12345" })).statusCode).toBe(400);
  });
});
```

Run: `cd apps/api && pnpm exec vitest run test/color.unit.test.ts test/restaurants.branding.test.ts`
Expected: FAIL (módulo inexistente; campos recusados por `additionalProperties`).

- [ ] **Step 2: Migration**

Run: `pnpm --filter @menuclick/api migrate:create add-restaurant-branding`

```sql
-- Up Migration

-- A loja no app do cliente: a capa do topo do cardápio e a cor da ação (o
-- botão "Adicionar ao carrinho"). Tinta, papel e as cores semânticas ficam
-- FIXAS no app — é o que garante contraste AA; a loja troca só a ação, e a
-- API recusa cor que não contraste com o texto branco do botão.
alter table restaurants add column cover_url text;
alter table restaurants add column brand_color text;

-- Down Migration

alter table restaurants drop column brand_color;
alter table restaurants drop column cover_url;
```

Run: `pnpm --filter @menuclick/api migrate:up`

- [ ] **Step 3: Domínio da cor**

```ts
// apps/api/src/domain/color.ts
/**
 * Contraste de uma cor com o BRANCO, pela fórmula do WCAG (luminância
 * relativa). É a conta que decide se a cor da marca serve de fundo para o
 * texto branco do botão de ação no app do cliente.
 */
export const MIN_ACTION_CONTRAST = 4.5;

export const HEX_COLOR_PATTERN = "^#[0-9A-Fa-f]{6}$";

function channel(hex: string): number {
  const c = parseInt(hex, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** `#RRGGBB` → razão de contraste com `#FFFFFF` (1 a 21). */
export function contrastWithWhite(hex: string): number {
  const r = channel(hex.slice(1, 3));
  const g = channel(hex.slice(3, 5));
  const b = channel(hex.slice(5, 7));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05);
}
```

- [ ] **Step 4: Tipos, repositório, schemas, serviço, cardápio**

- `domain/restaurant.ts`: em `CreateRestaurantInput`, `coverUrl?: string; brandColor?: string;`. Em `UpdateRestaurantInput`, tirar `"coverUrl" | "brandColor"` do `Omit` (como `logoUrl`) e acrescentar `coverUrl?: string | null; brandColor?: string | null;` com o comentário "null tira".
- `repositories/restaurants.ts`: `RestaurantRow` ganha `cover_url: string | null; brand_color: string | null;`; o mapper ganha
  `...(row.cover_url === null ? {} : { coverUrl: row.cover_url }),` e o mesmo para `brandColor`; `restaurantColumns` ganha `coverUrl: "cover_url", brandColor: "brand_color",`.
- `routes/schemas.ts`: em `updateRestaurantBodySchema.properties`:

```ts
    // capa do topo do cardápio do cliente; `null` tira (F12)
    coverUrl: { type: "string", format: "uri", nullable: true },
    // cor da ação no app do cliente (#RRGGBB); o serviço recusa sem contraste
    brandColor: { type: "string", pattern: HEX_COLOR_PATTERN, nullable: true },
```

  e em `restaurantResponseSchema.properties`: `coverUrl: { type: "string" }, brandColor: { type: "string" },` (importar `HEX_COLOR_PATTERN` de `../domain/color.ts`).
- `services/restaurants.ts`, no começo de `update()` (depois do `isUuid`):

```ts
  if (typeof input.brandColor === "string" && contrastWithWhite(input.brandColor) < MIN_ACTION_CONTRAST) {
    throw new ValidationError(
      `A cor ${input.brandColor} tem contraste de ${contrastWithWhite(input.brandColor).toFixed(2)}:1 com o texto branco do botão; o mínimo é ${MIN_ACTION_CONTRAST}:1. Escolha um tom mais escuro.`,
    );
  }
```

- `domain/menu.ts`: `"coverUrl" | "brandColor"` entram no `Pick` de `MenuRestaurant`; `services/menu.ts` `toMenuRestaurant` espalha os dois como `logoUrl` (`...(restaurant.coverUrl === undefined ? {} : { coverUrl: restaurant.coverUrl })`); `routes/menu.ts` `schema.response`: `coverUrl: { type: "string" }, brandColor: { type: "string" },`.

- [ ] **Step 5: Ver passar, suíte, OpenAPI, commit**

Run: `cd apps/api && pnpm exec vitest run test/color.unit.test.ts test/restaurants.branding.test.ts && pnpm exec tsc --noEmit && pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test`
Expected: verde.

```bash
git add apps/api
git commit -m "feat(restaurants): ✨ adiciona capa e cor da marca, com trava de contraste"
```

---

### Task 4: API — observação no item

**Files:**
- Create: `apps/api/migrations/<ts>_add-order-item-note.sql`
- Modify: `src/domain/order.ts` (`CreateOrderItemInput.note?`, `OrderItem.note`), `src/repositories/orders.ts` (`OrderItemRow`, `toOrderItem`, `InsertOrderItemData`, `insertItems`), `src/services/orders.ts` (`chaveDeFusao`, `LinhaEmMontagem`, montagem dos itens), `src/routes/orders.ts` (body e resposta), `src/routes/tracking.ts`
- Test: `apps/api/test/orders-note.test.ts`

**Interfaces:**
- Produces: item do corpo aceita `note?: string` (≤ 140); resposta do item com `note: string | null` (painel e acompanhamento).

- [ ] **Step 1: Teste que falha**

```ts
// apps/api/test/orders-note.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOrder, createProduct, createRestaurant } from "./helpers.ts";

/** "Sem cebola": a observação do item, congelada e separando linhas. */
describe("observação no item", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("congela a observação e separa linhas com observações diferentes", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [
      { productId: p.id, quantity: 1, note: "sem cebola" },
      { productId: p.id, quantity: 2, note: "sem cebola" },
      { productId: p.id, quantity: 1 },
    ]);
    const notes = order.items.map((item: { note: string | null; quantity: number }) => [item.note, item.quantity]);
    expect(notes).toEqual(expect.arrayContaining([["sem cebola", 3], [null, 1]]));
    expect(order.items).toHaveLength(2);
  });

  it("observação só com espaços é nenhuma observação", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [
      { productId: p.id, quantity: 1, note: "   " },
      { productId: p.id, quantity: 1 },
    ]);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ note: null, quantity: 2 });
  });

  it("mais de 140 caracteres é 400", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const res = await app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders`,
      payload: {
        type: "dine_in",
        customer: { name: "Ana", phone: "11999990000" },
        items: [{ productId: p.id, quantity: 1, note: "x".repeat(141) }],
        paymentMethod: "cash",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("sai no detalhe do painel e no acompanhamento", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1, note: "bem passado" }], {
      type: "takeaway",
    });
    const detail = await app.inject({
      method: "GET",
      url: `/restaurants/${r.id}/orders/${order.id}`,
      headers: r.headers,
    });
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });
    expect(detail.json().items[0].note).toBe("bem passado");
    expect(tracked.json().items[0].note).toBe("bem passado");
  });
});
```

(`createOrder` do helper tipa os itens sem `note`: ampliar o tipo do parâmetro `items` com `note?: string` em `test/helpers.ts`.)

Run: `cd apps/api && pnpm exec vitest run test/orders-note.test.ts`
Expected: FAIL (400 por `additionalProperties`).

- [ ] **Step 2: Migration**

Run: `pnpm --filter @menuclick/api migrate:create add-order-item-note`

```sql
-- Up Migration

-- "Sem cebola", "bem passado": a observação que o cliente escreve no item.
-- Congelada como nome e preço — é o que foi pedido, não o cardápio de hoje.
alter table order_items add column note text;

-- Down Migration

-- ⚠️ PERDA DE INFORMAÇÃO: as observações dos pedidos feitos desde o Up.
alter table order_items drop column note;
```

Run: `pnpm --filter @menuclick/api migrate:up`

- [ ] **Step 3: Implementar**

- `routes/orders.ts`, item do corpo: `note: { type: "string", maxLength: 140 },` (comentário: "observação do cliente; só espaços = nenhuma"); `orderItemResponseSchema.properties`: `note: { type: "string", nullable: true },`. `routes/tracking.ts`, item: `note: { type: "string", nullable: true },`.
- `domain/order.ts`: `CreateOrderItemInput` ganha `note?: string;`; `OrderItem` ganha `/** Observação do cliente; null = nenhuma. */ note: string | null;`.
- `services/orders.ts`:
  - `LinhaEmMontagem` ganha `note: string | null;`.
  - No laço de montagem: `const note = item.note?.trim() ? item.note.trim() : null;` e `chaveDeFusao(item.productId, escolhas, note)`; ao criar a linha, `note`.
  - `chaveDeFusao(productId, escolhas, note: string | null)`: `return [productId, ...partes, \`note:${note ?? ""}\`].join("|");` — e no comentário: "a observação separa linhas: 'sem cebola' e 'com cebola' não são dois iguais".
  - Os `items` montados carregam `note: linha.note`.
- `repositories/orders.ts`: `OrderItemRow.note: string | null`; `toOrderItem` com `note: row.note`; `InsertOrderItemData.note: string | null`; `insertItems` acrescenta `note` às colunas e à tupla (7 valores por linha: ajustar o gerador de `$n` para `n - 6 … n`).

- [ ] **Step 4: Ver passar, suíte, OpenAPI, commit**

Run: `cd apps/api && pnpm exec vitest run test/orders-note.test.ts test/orders-options.test.ts test/orders.test.ts && pnpm exec tsc --noEmit && pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test`
Expected: verde.

```bash
git add apps/api
git commit -m "feat(orders): ✨ aceita observação no item do pedido"
```

---

### Task 5: Painel — capa, cor da marca e a observação

**Files:**
- Modify: `apps/panel/src/api/types.ts` (`Restaurant.coverUrl?`, `brandColor?`; `OrderItem.note`), `src/api/restaurant.ts` (`RestaurantPatch`), `src/features/settings/storeForm.ts`, `src/features/settings/StoreDataPage.tsx`, `src/features/orders/OrderDrawer.tsx`, `src/features/kitchen/KitchenPage.tsx`, `test/fixtures.ts`, `test/storeForm.test.ts`, `test/order-drawer.test.tsx`, `test/kitchen-page.test.tsx`

**Interfaces:**
- Consumes: Tasks 3 e 4.

- [ ] **Step 1: Testes que falham**

`test/storeForm.test.ts`:

```ts
  it("capa e cor esvaziadas vão como null; preenchidas, como texto", () => {
    const withBrand = { ...initial, coverUrl: "https://cdn.exemplo/capa.jpg", brandColor: "#0B7A48" };
    expect(changedPatch({ ...withBrand, coverUrl: "", brandColor: "" }, withBrand)).toEqual({
      coverUrl: null,
      brandColor: null,
    });
    expect(changedPatch({ ...initial, brandColor: "#0b7a48" }, initial)).toEqual({ brandColor: "#0B7A48" });
  });

  it("cor fora de #RRGGBB não chega à API", () => {
    expect(validateStoreForm({ ...initial, brandColor: "azul" })).toBe(
      "Use a cor no formato #RRGGBB, por exemplo #1E5AE8.",
    );
  });
```

`test/order-drawer.test.tsx` e `test/kitchen-page.test.tsx`: um item com `note: "sem cebola"` mostra "Obs.: sem cebola".

Run: `cd apps/panel && pnpm exec vitest run test/storeForm.test.ts test/order-drawer.test.tsx test/kitchen-page.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implementar**

- `types.ts`: `Restaurant` ganha `coverUrl?: string; brandColor?: string;`; `OrderItem` ganha `note: string | null;`. `fixtures.ts`: itens de `makeOrderDetail` com `note: null`.
- `restaurant.ts` (`RestaurantPatch`): `coverUrl: string | null; brandColor: string | null;`.
- `storeForm.ts`: `StoreForm` ganha `coverUrl` e `brandColor` (strings; `fromRestaurant` usa `?? ""`); `validateStoreForm` recusa capa que não seja http(s) (mesma mensagem do logo) e cor fora de `/^#[0-9A-Fa-f]{6}$/` com "Use a cor no formato #RRGGBB, por exemplo #1E5AE8."; `changedPatch` manda `coverUrl`/`brandColor` quando mudaram, `""` → `null`, cor em maiúsculas.
- `StoreDataPage.tsx`: na seção de dados, dois campos — "Capa do cardápio (URL)" e "Cor da marca" (TextInput com placeholder `#1E5AE8`) — e, abaixo da cor, uma prévia: um botão de exemplo "Adicionar ao carrinho" com `style={{ background: form.brandColor || "#1E5AE8", color: "#FFFFFF" }}` e a nota "É a cor do botão principal no cardápio do cliente. Precisa de contraste com o texto branco — a loja recusa tons claros." O erro 400 da API aparece pelo fluxo de erro que a tela já tem.
- `OrderDrawer.tsx` e `KitchenPage.tsx`: abaixo das opções de cada item, `{item.note && <span className={classes.options}>Obs.: {item.note}</span>}`.

- [ ] **Step 3: Ver passar, commit**

Run: `cd apps/panel && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: verde.

```bash
git add apps/panel
git commit -m "feat(panel): ✨ edita capa e cor da marca e mostra a observação do item"
```

---

### Task 6: `apps/menu` — o esqueleto do app

**Files:**
- Create: `apps/menu/package.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `vitest.config.ts`, `test/setup.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/not-found.tsx`, `test/smoke.test.tsx`, `.gitignore` (se `.next` não estiver no da raiz)
- Modify: `.github/workflows/ci.yml`, `apps/api/.env.example` (comentários de `MENU_BASE_URL`/`CORS_ORIGINS`)

**Interfaces:**
- Produces: `pnpm --filter @menuclick/menu dev` em `:3000`; tokens do tema como utilitários Tailwind (`bg-action`, `text-ink`, `text-ink-2`, `bg-paper-2`, `border-line`, `rounded-card`…).

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@menuclick/menu",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "tsc --noEmit && next build",
    "start": "next start --port 3000",
    "test": "vitest run"
  },
  "dependencies": {
    "@menuclick/pricing": "workspace:*",
    "next": "^16.3.6",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.3",
    "@testing-library/dom": "^10.4.2",
    "@testing-library/react": "^16.3.3",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.1",
    "jsdom": "^30.1.0",
    "tailwindcss": "^4.3.3",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

Run: `pnpm install`. Se o pnpm acusar script de instalação não decidido (`sharp`, `@parcel/watcher`, `@tailwindcss/oxide`…), decidir cada um em `allowBuilds` do `pnpm-workspace.yaml` com o comentário do porquê (preferir `false` quando há binário pré-compilado, como o `bcrypt`), e registrar `Ruling:`.

- [ ] **Step 2: Configuração**

```ts
// apps/menu/next.config.ts
import type { NextConfig } from "next";

const config: NextConfig = {
  // o pacote de preço é TypeScript cru (a API o roda direto no Node)
  transpilePackages: ["@menuclick/pricing"],
  // o type-check é o `tsc --noEmit` do script de build — o mesmo TS do
  // monorepo; o do Next não roda duas vezes
  typescript: { ignoreBuildErrors: true },
};

export default config;
```

```js
// apps/menu/postcss.config.mjs
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`tsconfig.json`: `target` ES2022, `lib` dom + esnext, `module` esnext, `moduleResolution` bundler, `jsx` preserve, `strict`, `noEmit`, `allowImportingTsExtensions`, `isolatedModules`, `plugins: [{ "name": "next" }]`, `paths: { "@/*": ["./src/*"] }`, `include` `next-env.d.ts`, `src`, `test`, `.next/types/**/*.ts`.

```ts
// apps/menu/vitest.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
```

```ts
// apps/menu/test/setup.ts
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
```

- [ ] **Step 3: Tema e layout**

```css
/* apps/menu/src/app/globals.css */
@import "tailwindcss";

/* Direção Balcão. Só a AÇÃO é temável (a loja troca pela cor da marca);
   tinta, papel e semânticas ficam fixas — é o que garante o contraste AA. */
:root {
  --brand-action: #1e5ae8;
}

@theme inline {
  --color-action: var(--brand-action);
  --font-sans: var(--font-sora), system-ui, sans-serif;
}

@theme {
  --color-ink: #0b0d12;
  --color-ink-2: #5c6474;
  --color-ink-3: #8b93a5;
  --color-paper: #ffffff;
  --color-paper-2: #f4f6fa;
  --color-paper-3: #eceff5;
  --color-line: #e1e5ee;
  --color-success: #0b7a48;
  --color-success-soft: #e8f5ee;
  --color-warn-soft: #fff4db;
  --color-warn: #7a4e00;
  --color-danger: #a62b21;
  --radius-chip: 5px;
  --radius-field: 10px;
  --radius-card: 12px;
}

html {
  background: var(--color-paper);
  color: var(--color-ink);
}

:focus-visible {
  outline: 2px solid var(--brand-action);
  outline-offset: 2px;
}
```

```tsx
// apps/menu/src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Sora } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// auto-hospedada no build: o celular do cliente não pede nada ao Google
const sora = Sora({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sora" });

export const metadata: Metadata = { title: "Cardápio" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={sora.variable}>
      <body className="min-h-dvh bg-paper font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
```

```tsx
// apps/menu/src/app/not-found.tsx
/** Não há home: sem slug não existe cardápio, e a tela orienta sem botão falso. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-2 px-4">
      <h1 className="text-[19px] font-semibold">Este link não existe mais</h1>
      <p className="text-[15px] text-ink-2">
        Confira o endereço com o restaurante ou escaneie o QR code da mesa outra vez.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Teste de fumaça**

```tsx
// apps/menu/test/smoke.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotFound from "../src/app/not-found.tsx";

describe("esqueleto do app", () => {
  it("renderiza a tela de link inexistente", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Este link não existe mais" })).toBeTruthy();
  });
});
```

Run: `pnpm --filter @menuclick/menu test && pnpm --filter @menuclick/menu build`
Expected: 1/1; build ok. Se o `next build` quebrar carregando o TypeScript 7 (API JS do TS), registrar `Ruling:` e fixar `apps/menu` em `typescript` 6.x (o mesmo da raiz).

- [ ] **Step 5: CI, env, commit**

CI, depois de "Test (painel)":

```yaml
      - name: Build (app do cliente)
        run: pnpm --filter @menuclick/menu run build

      - name: Test (app do cliente)
        run: pnpm --filter @menuclick/menu run test
```

`apps/api/.env.example`: `MENU_BASE_URL=http://localhost:3000` com o comentário "a origem do app do cliente (apps/menu), não a do painel", e `CORS_ORIGINS=http://localhost:3000` (o app chama a API do navegador). Atualizar o `apps/api/.env` local igual (não é commitado).

```bash
git add apps/menu .github apps/api/.env.example pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(menu): ✨ cria o app do cliente em next.js com tailwind"
```

---

### Task 7: App — tipos, API, dinheiro e horário (puros)

**Files:**
- Create: `apps/menu/src/lib/{types.ts,api.ts,money.ts,schedule.ts}`, `apps/menu/test/{money.test.ts,schedule.test.ts,api.test.ts}`

**Interfaces:**
- Produces:
  - `types.ts`: `MenuRestaurant` (espelho da resposta de `GET /menu/:slug`), `MenuOption { id, name, priceInCents, maxQuantity }`, `MenuOptionGroup { id, name, minOptions, maxOptions, priceRule, options }`, `MenuProduct { id, name, priceInCents, description?, photoUrl?, available, optionGroupIds }`, `MenuSection { id?, name, products }`, `Menu { restaurant, sections, optionGroups }`, `PaymentMethod`.
  - `api.ts`: `API_URL`; `getMenu(slug): Promise<Menu | null>` (servidor, `next: { revalidate: 60 }`, percorre páginas); `fetchLiveRestaurant(slug)`, `resolveTable(slug, hash): Promise<string | null>` (label), `createDineInOrder(restaurantId, body)` (navegador).
  - `money.ts`: `formatCents(cents): string` → `"R$ 52,00"` (espaço comum, não NBSP).
  - `schedule.ts`: `openChip(r, nowMs)`, `closedHeadline(r, nowMs)`, `weekRows(openingHours)`.

- [ ] **Step 1: Testes que falham**

```ts
// apps/menu/test/money.test.ts
import { describe, expect, it } from "vitest";
import { formatCents } from "../src/lib/money.ts";

describe("dinheiro", () => {
  it("R$ com vírgula e milhar com ponto", () => {
    expect(formatCents(5200)).toBe("R$ 52,00");
    expect(formatCents(123456)).toBe("R$ 1.234,56");
    expect(formatCents(0)).toBe("R$ 0,00");
  });
});
```

```ts
// apps/menu/test/schedule.test.ts
import { describe, expect, it } from "vitest";
import { closedHeadline, openChip, weekRows } from "../src/lib/schedule.ts";

const TZ = "America/Sao_Paulo";
const base = { timezone: TZ, isOpen: true, acceptingOrders: true };
// segunda 2026-09-21, 15:00 em São Paulo
const now = Date.parse("2026-09-21T15:00:00-03:00");

describe("horário na tela", () => {
  it("aberta com fechamento: 'Aberto até 23h' (e 23h30 quando há minutos)", () => {
    expect(openChip({ ...base, closesAt: "2026-09-22T02:00:00.000Z" }, now)).toEqual({ tone: "open", text: "Aberto até 23h" });
    expect(openChip({ ...base, closesAt: "2026-09-22T02:30:00.000Z" }, now).text).toBe("Aberto até 23h30");
  });

  it("aberta direto: 'Aberto agora'", () => {
    expect(openChip(base, now)).toEqual({ tone: "open", text: "Aberto agora" });
  });

  it("pausada vence o horário (Review Focus 4)", () => {
    expect(openChip({ ...base, isOpen: false, acceptingOrders: false, closesAt: "2026-09-22T02:00:00.000Z" }, now))
      .toEqual({ tone: "paused", text: "Pedidos pausados" });
  });

  it("fechada: 'Fechado agora'", () => {
    expect(openChip({ ...base, isOpen: false, opensAt: "2026-09-21T21:00:00.000Z" }, now)).toEqual({
      tone: "closed",
      text: "Fechado agora",
    });
  });

  it("manchete de fechada: hoje, amanhã, ou o dia", () => {
    const closed = { ...base, isOpen: false };
    expect(closedHeadline({ ...closed, opensAt: "2026-09-21T21:00:00.000Z" }, now)).toBe("Fechado. Abre hoje às 18h");
    expect(closedHeadline({ ...closed, opensAt: "2026-09-22T21:00:00.000Z" }, now)).toBe("Fechado. Abre amanhã às 18h");
    expect(closedHeadline({ ...closed, opensAt: "2026-09-25T21:00:00.000Z" }, now)).toBe("Fechado. Abre sexta às 18h");
    expect(closedHeadline(closed, now)).toBe("Fechado agora");
  });

  it("grade da semana começa na segunda e junta dias iguais seguidos", () => {
    const rows = weekRows([
      { weekday: 2, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 3, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 4, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 5, opensAt: "18:00", closesAt: "00:30" },
      { weekday: 6, opensAt: "18:00", closesAt: "00:30" },
      { weekday: 0, opensAt: "12:00", closesAt: "22:00" },
    ]);
    expect(rows).toEqual([
      { days: "Segunda", hours: "Fechado" },
      { days: "Terça a quinta", hours: "18h – 23h" },
      { days: "Sexta e sábado", hours: "18h – 00h30" },
      { days: "Domingo", hours: "12h – 22h" },
    ]);
  });
});
```

```ts
// apps/menu/test/api.test.ts
import { describe, expect, it, vi } from "vitest";
import { getMenu, resolveTable } from "../src/lib/api.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("API do cardápio", () => {
  it("getMenu junta as páginas de seções e devolve null em 404", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/menu/nao-existe")) return json({ message: "x" }, 404);
      if (url.endsWith("/menu/cantina")) return json({ id: "r1", name: "Cantina" });
      if (url.includes("offset=0")) {
        return json({ data: [{ id: "s1", name: "Pizzas", products: [] }], optionGroups: [{ id: "g1" }], limit: 100, offset: 0, total: 2 });
      }
      return json({ data: [{ id: "s2", name: "Bebidas", products: [] }], optionGroups: [{ id: "g2" }], limit: 100, offset: 100, total: 2 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const menu = await getMenu("cantina");
    expect(menu?.sections.map((s) => s.name)).toEqual(["Pizzas", "Bebidas"]);
    expect(menu?.optionGroups.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(await getMenu("nao-existe")).toBeNull();
  });

  it("resolveTable devolve o rótulo, ou null quando a mesa não existe", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/ok") ? json({ label: "Mesa 7" }) : json({}, 404))));
    expect(await resolveTable("cantina", "ok")).toBe("Mesa 7");
    expect(await resolveTable("cantina", "velho")).toBeNull();
  });
});
```

Run: `pnpm --filter @menuclick/menu test`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 2: Implementar**

```ts
// apps/menu/src/lib/types.ts
export type PriceRule = "sum" | "highest" | "average";
export type PaymentMethod = "cash" | "card_on_delivery" | "pix" | "meal_voucher";

export type OpeningHour = { weekday: number; opensAt: string; closesAt: string };

export type MenuRestaurant = {
  id: string;
  slug: string;
  name: string;
  cuisineType: string;
  logoUrl?: string;
  coverUrl?: string;
  brandColor?: string;
  isDelivery: boolean;
  isTakeaway: boolean;
  isQrcode: boolean;
  freeDeliveryAboveInCents?: number;
  minimumOrderInCents: number;
  isOpen: boolean;
  acceptingOrders: boolean;
  closesAt?: string;
  opensAt?: string;
  timezone: string;
  openingHours: OpeningHour[];
  paymentMethods: PaymentMethod[];
};

export type MenuOption = { id: string; name: string; priceInCents: number; maxQuantity: number };
export type MenuOptionGroup = {
  id: string;
  name: string;
  minOptions: number;
  maxOptions: number;
  priceRule: PriceRule;
  options: MenuOption[];
};
export type MenuProduct = {
  id: string;
  name: string;
  priceInCents: number;
  description?: string;
  photoUrl?: string;
  available: boolean;
  optionGroupIds: string[];
};
export type MenuSection = { id?: string; name: string; products: MenuProduct[] };
export type Menu = { restaurant: MenuRestaurant; sections: MenuSection[]; optionGroups: MenuOptionGroup[] };
```

O `timezone` vem do cardápio público desde a Task 2; `schedule.ts` o usa, com `America/Sao_Paulo` só como rede se faltar.

```ts
// apps/menu/src/lib/money.ts
/** "R$ 52,00" — com espaço comum (o Intl usa NBSP, que quebra busca e teste). */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100).replace(/ /g, " ");
}
```

```ts
// apps/menu/src/lib/schedule.ts
import type { MenuRestaurant, OpeningHour } from "./types.ts";

type Status = Pick<MenuRestaurant, "isOpen" | "acceptingOrders" | "closesAt" | "opensAt"> & { timezone?: string };

const DEFAULT_TZ = "America/Sao_Paulo";
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "18h", "23h30" — o formato do handoff. */
export function hourLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":");
  return m === "00" ? `${h}h` : `${h}h${m}`;
}

function localParts(iso: string | number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm: `${get("hour")}:${get("minute")}`,
    weekday: days.indexOf(get("weekday")),
  };
}

/** O chip do topo: pausa ganha de tudo, depois aberta, depois fechada. */
export function openChip(r: Status, nowMs: number): { tone: "open" | "closed" | "paused"; text: string } {
  if (!r.acceptingOrders) return { tone: "paused", text: "Pedidos pausados" };
  if (r.isOpen) {
    return r.closesAt
      ? { tone: "open", text: `Aberto até ${hourLabel(localParts(r.closesAt, r.timezone ?? DEFAULT_TZ).hhmm)}` }
      : { tone: "open", text: "Aberto agora" };
  }
  void nowMs;
  return { tone: "closed", text: "Fechado agora" };
}

/** "Fechado. Abre amanhã às 18h" — a grade é a saída, não o aviso. */
export function closedHeadline(r: Status, nowMs: number): string {
  if (!r.opensAt) return "Fechado agora";
  const tz = r.timezone ?? DEFAULT_TZ;
  const opens = localParts(r.opensAt, tz);
  const today = localParts(nowMs, tz);
  const tomorrow = localParts(nowMs + 24 * 60 * 60 * 1000, tz);
  const when =
    opens.date === today.date ? "hoje" : opens.date === tomorrow.date ? "amanhã" : WEEKDAYS[opens.weekday];
  return `Fechado. Abre ${when} às ${hourLabel(opens.hhmm)}`;
}

const DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** A grade da semana, da segunda ao domingo, juntando dias iguais seguidos. */
export function weekRows(hours: OpeningHour[]): { days: string; hours: string }[] {
  const text = (weekday: number) => {
    const ranges = hours
      .filter((h) => h.weekday === weekday)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
      .map((h) => `${hourLabel(h.opensAt)} – ${hourLabel(h.closesAt)}`);
    return ranges.length === 0 ? "Fechado" : ranges.join(", ");
  };
  const rows: { first: number; last: number; hours: string }[] = [];
  for (const weekday of WEEK_ORDER) {
    const value = text(weekday);
    const previous = rows[rows.length - 1];
    if (previous && previous.hours === value) previous.last = weekday;
    else rows.push({ first: weekday, last: weekday, hours: value });
  }
  return rows.map((row) => {
    const span = WEEK_ORDER.indexOf(row.last) - WEEK_ORDER.indexOf(row.first);
    const days =
      span === 0
        ? DAY_NAMES[row.first]
        : span === 1
          ? `${DAY_NAMES[row.first]} e ${DAY_NAMES[row.last].toLowerCase()}`
          : `${DAY_NAMES[row.first]} a ${DAY_NAMES[row.last].toLowerCase()}`;
    return { days, hours: row.hours };
  });
}
```

```ts
// apps/menu/src/lib/api.ts
import type { Menu, MenuOptionGroup, MenuRestaurant, MenuSection } from "./types.ts";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

/** Revalidação do cardápio no servidor (ISR). Preço visto com até 60 s de atraso é aceito. */
export const MENU_REVALIDATE_SECONDS = 60;

/**
 * O cardápio inteiro, no SERVIDOR (ISR). `null` = a loja não existe (ou não
 * verificou o e-mail, que por fora é a mesma coisa). O cardápio público é
 * paginado por seção, com teto de 100 por página: percorre até o fim.
 */
export async function getMenu(slug: string): Promise<Menu | null> {
  const cache = { next: { revalidate: MENU_REVALIDATE_SECONDS } };
  const restaurantRes = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}`, cache);
  if (restaurantRes.status === 404) return null;
  if (!restaurantRes.ok) throw new Error(`cardápio de ${slug}: ${restaurantRes.status}`);
  const restaurant = (await restaurantRes.json()) as MenuRestaurant;

  const sections: MenuSection[] = [];
  const groups = new Map<string, MenuOptionGroup>();
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}/products?limit=100&offset=${offset}`, cache);
    if (!res.ok) throw new Error(`produtos de ${slug}: ${res.status}`);
    const page = (await res.json()) as { data: MenuSection[]; optionGroups: MenuOptionGroup[]; total: number };
    sections.push(...page.data);
    for (const group of page.optionGroups) groups.set(group.id, group);
    if (offset + 100 >= page.total) break;
  }
  return { restaurant, sections, optionGroups: [...groups.values()] };
}

/** Horário e pausa AGORA, no navegador e sem cache: o da página tem até 60 s. */
export async function fetchLiveRestaurant(slug: string): Promise<MenuRestaurant | null> {
  const res = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as MenuRestaurant) : null;
}

/** O rótulo da mesa do QR, ou `null` (adesivo velho, mesa removida, hash girado). */
export async function resolveTable(slug: string, hash: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}/table/${encodeURIComponent(hash)}`, {
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as { label: string }).label : null;
  } catch {
    return null;
  }
}

export type OrderItemBody = {
  productId: string;
  quantity: number;
  options?: { optionId: string; quantity: number }[];
  note?: string;
};

export type DineInOrderBody = {
  type: "dine_in";
  customer: { name: string; phone: string };
  items: OrderItemBody[];
  paymentMethod: "cash" | "card_on_delivery" | "pix";
  tableHash?: string;
};

/** Erro com a mensagem da API (pt-BR, escrita para o cliente ler). */
export class OrderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function createDineInOrder(restaurantId: string, body: DineInOrderBody): Promise<{ id: string; number: number }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/restaurants/${restaurantId}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OrderError(0, "Sem conexão. Seu carrinho continua aqui — tente de novo.");
  }
  const payload = (await res.json().catch(() => null)) as { message?: string; id?: string; number?: number } | null;
  if (!res.ok) throw new OrderError(res.status, payload?.message ?? "Não deu para enviar. Tente de novo.");
  return { id: payload?.id as string, number: payload?.number as number };
}
```

- [ ] **Step 3: Ver passar, commit**

Run: `pnpm --filter @menuclick/menu test && pnpm --filter @menuclick/menu exec tsc --noEmit`
Expected: verde.

```bash
git add apps/menu
git commit -m "feat(menu): ✨ adiciona o acesso à api, o dinheiro e o horário da loja"
```

---

### Task 8: App — seleção de opções, preço e carrinho (puros)

**Files:**
- Create: `apps/menu/src/lib/{selection.ts,cart.ts,checkout.ts}`, `apps/menu/test/{selection.test.ts,cart.test.ts,checkout.test.ts}`

**Interfaces:**
- Consumes: `unitPrice` de `@menuclick/pricing`; tipos da Task 7.
- Produces:
  - `selection.ts`: `type Selection = Record<string, string[]>` (grupo → ids); `toggleOption(sel, group, optionId): Selection`; `missingGroup(groups, sel): MenuOptionGroup | null`; `lockReason(group): string`; `groupHint(group): string`; `groupBadge(group, sel): string`; `optionPriceLabel(group, option): string`; `itemUnitPrice(product, groups, sel): number`; `fromPrice(product, groups): { prefix: string; cents: number }`.
  - `cart.ts`: `type CartLine = { key, productId, name, unitPriceInCents, quantity, options: { optionId, name }[], note: string | null }`; `lineKey(productId, sel, note)`; `addLine(lines, line)`; `bump(lines, key, delta)`; `subtotal(lines)`; `optionsText(line)`; `toOrderItems(lines)`; `loadCart(storageKey)`, `saveCart(storageKey, lines)`; `cartStorageKey(slug, tableHash)`.
  - `checkout.ts`: `DINE_IN_PAYMENTS`, `dineInPayments(accepted)`, `checkoutBlock({ name, phone, payment }): string | null`.

- [ ] **Step 1: Testes que falham**

```ts
// apps/menu/test/selection.test.ts
import { describe, expect, it } from "vitest";
import {
  fromPrice,
  groupBadge,
  groupHint,
  itemUnitPrice,
  lockReason,
  missingGroup,
  optionPriceLabel,
  toggleOption,
} from "../src/lib/selection.ts";
import type { MenuOptionGroup, MenuProduct } from "../src/lib/types.ts";

const sabores: MenuOptionGroup = {
  id: "g-sab",
  name: "Sabores",
  minOptions: 2,
  maxOptions: 2,
  priceRule: "highest",
  options: [
    { id: "marg", name: "Margherita", priceInCents: 4500, maxQuantity: 1 },
    { id: "quatro", name: "Quatro queijos", priceInCents: 5000, maxQuantity: 1 },
    { id: "cala", name: "Calabresa", priceInCents: 4500, maxQuantity: 1 },
  ],
};
const borda: MenuOptionGroup = {
  id: "g-bo",
  name: "Borda",
  minOptions: 0,
  maxOptions: 1,
  priceRule: "sum",
  options: [
    { id: "cat", name: "Catupiry", priceInCents: 800, maxQuantity: 1 },
    { id: "ched", name: "Cheddar", priceInCents: 800, maxQuantity: 1 },
  ],
};
const pizza: MenuProduct = {
  id: "p2",
  name: "Meio a meio",
  priceInCents: 3000,
  available: true,
  optionGroupIds: ["g-sab", "g-bo"],
};

describe("seleção de opções", () => {
  it("marca, desmarca e respeita o teto; grupo de uma escolha troca a seleção", () => {
    let sel = toggleOption({}, sabores, "marg");
    sel = toggleOption(sel, sabores, "quatro");
    expect(toggleOption(sel, sabores, "cala")["g-sab"]).toEqual(["marg", "quatro"]); // teto
    expect(toggleOption(sel, sabores, "marg")["g-sab"]).toEqual(["quatro"]); // desmarca
    const b = toggleOption(toggleOption({}, borda, "cat"), borda, "ched");
    expect(b["g-bo"]).toEqual(["ched"]); // troca
  });

  it("o que falta é o primeiro obrigatório incompleto, e o botão diz", () => {
    const sel = toggleOption({}, sabores, "marg");
    expect(missingGroup([sabores, borda], sel)?.id).toBe("g-sab");
    expect(lockReason(sabores)).toBe("Escolha 2 em Sabores");
    expect(missingGroup([sabores, borda], toggleOption(sel, sabores, "cala"))).toBeNull();
  });

  it("dicas e contadores do grupo", () => {
    expect(groupHint(sabores)).toBe("Cobramos o sabor mais caro");
    expect(groupHint(borda)).toBe("Opcional");
    expect(groupHint({ ...borda, minOptions: 1 })).toBe("Obrigatório");
    expect(groupHint({ ...sabores, priceRule: "average" })).toBe("Cobramos a média dos sabores");
    expect(groupBadge(sabores, { "g-sab": ["marg"] })).toBe("1 de 2");
    expect(groupBadge(borda, {})).toBe("0/1");
  });

  it("rótulo de preço da opção muda com a regra", () => {
    expect(optionPriceLabel(borda, borda.options[0])).toBe("+ R$ 8,00");
    expect(optionPriceLabel(sabores, sabores.options[1])).toBe("até + R$ 50,00");
    expect(optionPriceLabel(borda, { ...borda.options[0], priceInCents: 0 })).toBe("");
  });

  it("total do item ao vivo sai do pacote de preço", () => {
    const sel = { "g-sab": ["marg", "quatro"], "g-bo": ["cat"] };
    expect(itemUnitPrice(pizza, [sabores, borda], sel)).toBe(3000 + 5000 + 800);
  });

  it("'a partir de' escolhe as opções mais baratas até o mínimo", () => {
    expect(fromPrice(pizza, [sabores, borda])).toEqual({ prefix: "a partir de", cents: 3000 + 4500 });
    expect(fromPrice({ ...pizza, optionGroupIds: ["g-bo"] }, [borda])).toEqual({ prefix: "", cents: 3000 });
  });
});
```

```ts
// apps/menu/test/cart.test.ts
import { describe, expect, it, vi } from "vitest";
import { addLine, bump, cartStorageKey, lineKey, loadCart, saveCart, subtotal, toOrderItems } from "../src/lib/cart.ts";
import type { CartLine } from "../src/lib/cart.ts";

const line = (over: Partial<CartLine> = {}): CartLine => ({
  key: lineKey("p1", { g: ["b"] }, null),
  productId: "p1",
  name: "Margherita",
  unitPriceInCents: 5800,
  quantity: 1,
  options: [{ optionId: "b", name: "Bacon" }],
  note: null,
  ...over,
});

describe("carrinho", () => {
  it("mesma seleção em ordem diferente e mesma observação é a mesma linha", () => {
    expect(lineKey("p1", { g: ["a", "b"] }, "sem cebola")).toBe(lineKey("p1", { g: ["b", "a"] }, "sem cebola"));
    expect(lineKey("p1", {}, "sem cebola")).not.toBe(lineKey("p1", {}, "com cebola"));
  });

  it("observação só com espaços é nenhuma (Review Focus 2)", () => {
    expect(lineKey("p1", {}, "   ")).toBe(lineKey("p1", {}, null));
  });

  it("junta linhas iguais, e zero remove", () => {
    let lines = addLine([], line());
    lines = addLine(lines, line({ quantity: 2 }));
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
    expect(subtotal(lines)).toBe(3 * 5800);
    expect(bump(lines, lines[0].key, -3)).toEqual([]);
  });

  it("vira itens do pedido, com opções e observação", () => {
    expect(toOrderItems([line({ note: "sem cebola", quantity: 2 })])).toEqual([
      { productId: "p1", quantity: 2, options: [{ optionId: "b", quantity: 1 }], note: "sem cebola" },
    ]);
    expect(toOrderItems([line({ options: [] })])).toEqual([{ productId: "p1", quantity: 1 }]);
  });

  it("persiste por loja e por mesa", () => {
    expect(cartStorageKey("cantina", "a7f3")).toBe("cart:cantina:a7f3");
    expect(cartStorageKey("cantina", null)).toBe("cart:cantina:link");
    saveCart("cart:cantina:a7f3", [line()]);
    expect(loadCart("cart:cantina:a7f3")).toHaveLength(1);
    expect(loadCart("cart:cantina:link")).toEqual([]);
  });

  it("storage indisponível: vazio e sem erro (Review Focus 3)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(loadCart("cart:x:link")).toEqual([]);
    expect(() => saveCart("cart:x:link", [line()])).not.toThrow();
    vi.restoreAllMocks();
  });
});
```

```ts
// apps/menu/test/checkout.test.ts
import { describe, expect, it } from "vitest";
import { checkoutBlock, dineInPayments } from "../src/lib/checkout.ts";

describe("finalizar no salão", () => {
  it("formas do salão, só as que a loja aceita, sem vale-refeição", () => {
    expect(dineInPayments(["cash", "pix", "meal_voucher"])).toEqual([
      { method: "cash", label: "Dinheiro no caixa" },
      { method: "pix", label: "Pix" },
    ]);
  });

  it("o botão diz o que falta", () => {
    expect(checkoutBlock({ name: " ", phone: "11999990000", payment: "pix" })).toBe("Informe seu nome");
    expect(checkoutBlock({ name: "Ana", phone: "1199", payment: "pix" })).toBe("Informe um telefone válido");
    expect(checkoutBlock({ name: "Ana", phone: "(11) 99999-0000", payment: null })).toBe("Escolha a forma de pagamento");
    expect(checkoutBlock({ name: "Ana", phone: "(11) 99999-0000", payment: "pix" })).toBeNull();
  });
});
```

Run: `pnpm --filter @menuclick/menu test`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 2: Implementar**

```ts
// apps/menu/src/lib/selection.ts
import { unitPrice } from "@menuclick/pricing";
import { formatCents } from "./money.ts";
import type { MenuOption, MenuOptionGroup, MenuProduct } from "./types.ts";

/** Grupo → ids escolhidos. Uma unidade por opção na parte 1. */
export type Selection = Record<string, string[]>;

export function toggleOption(sel: Selection, group: MenuOptionGroup, optionId: string): Selection {
  const current = sel[group.id] ?? [];
  let next: string[];
  if (current.includes(optionId)) next = current.filter((id) => id !== optionId);
  else if (current.length < group.maxOptions) next = [...current, optionId];
  else if (group.maxOptions === 1) next = [optionId];
  else next = current;
  return { ...sel, [group.id]: next };
}

export function missingGroup(groups: MenuOptionGroup[], sel: Selection): MenuOptionGroup | null {
  return groups.find((g) => g.minOptions > 0 && (sel[g.id] ?? []).length < g.minOptions) ?? null;
}

/** O botão travado diz o que falta — nunca só apagado. */
export function lockReason(group: MenuOptionGroup): string {
  return `Escolha ${group.minOptions} em ${group.name}`;
}

export function groupHint(group: MenuOptionGroup): string {
  if (group.priceRule === "highest") return "Cobramos o sabor mais caro";
  if (group.priceRule === "average") return "Cobramos a média dos sabores";
  return group.minOptions > 0 ? "Obrigatório" : "Opcional";
}

export function groupBadge(group: MenuOptionGroup, sel: Selection): string {
  const count = (sel[group.id] ?? []).length;
  return group.minOptions > 0 ? `${count} de ${group.maxOptions}` : `${count}/${group.maxOptions}`;
}

export function optionPriceLabel(group: MenuOptionGroup, option: MenuOption): string {
  if (option.priceInCents === 0) return "";
  return group.priceRule === "highest" ? `até + ${formatCents(option.priceInCents)}` : `+ ${formatCents(option.priceInCents)}`;
}

export function productGroups(product: MenuProduct, groups: MenuOptionGroup[]): MenuOptionGroup[] {
  return product.optionGroupIds
    .map((id) => groups.find((g) => g.id === id))
    .filter((g): g is MenuOptionGroup => g !== undefined);
}

/** O preço de uma unidade, pelo MESMO código que a API usa para cobrar. */
export function itemUnitPrice(product: MenuProduct, groups: MenuOptionGroup[], sel: Selection): number {
  return unitPrice(
    product.priceInCents,
    productGroups(product, groups).map((group) => ({
      priceRule: group.priceRule,
      choices: (sel[group.id] ?? [])
        .map((id) => group.options.find((o) => o.id === id))
        .filter((o): o is MenuOption => o !== undefined)
        .map((o) => ({ priceInCents: o.priceInCents, quantity: 1 })),
    })),
  );
}

/** "a partir de": as opções mais baratas até o mínimo de cada grupo obrigatório. */
export function fromPrice(product: MenuProduct, groups: MenuOptionGroup[]): { prefix: string; cents: number } {
  const required = productGroups(product, groups).filter((g) => g.minOptions > 0);
  if (required.length === 0) return { prefix: "", cents: product.priceInCents };
  const cheapest: Selection = {};
  for (const group of required) {
    cheapest[group.id] = [...group.options]
      .sort((a, b) => a.priceInCents - b.priceInCents)
      .slice(0, group.minOptions)
      .map((o) => o.id);
  }
  return { prefix: "a partir de", cents: itemUnitPrice(product, groups, cheapest) };
}
```

```ts
// apps/menu/src/lib/cart.ts
import type { OrderItemBody } from "./api.ts";
import type { Selection } from "./selection.ts";

export type CartLine = {
  key: string;
  productId: string;
  name: string;
  unitPriceInCents: number;
  quantity: number;
  options: { optionId: string; name: string }[];
  note: string | null;
};

export function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Mesma fusão da API: produto + opções (sem ordem) + observação. */
export function lineKey(productId: string, sel: Selection, note: string | null): string {
  const options = Object.values(sel).flat().sort();
  return [productId, ...options, `note:${normalizeNote(note) ?? ""}`].join("|");
}

export function addLine(lines: CartLine[], line: CartLine): CartLine[] {
  const hit = lines.find((l) => l.key === line.key);
  if (!hit) return [...lines, line];
  return lines.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + line.quantity } : l));
}

export function bump(lines: CartLine[], key: string, delta: number): CartLine[] {
  return lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0);
}

export function subtotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceInCents * l.quantity, 0);
}

export function optionsText(line: CartLine): string {
  return line.options.length === 0 ? "Sem complementos" : line.options.map((o) => o.name).join(" · ");
}

export function toOrderItems(lines: CartLine[]): OrderItemBody[] {
  return lines.map((l) => ({
    productId: l.productId,
    quantity: l.quantity,
    ...(l.options.length > 0 ? { options: l.options.map((o) => ({ optionId: o.optionId, quantity: 1 })) } : {}),
    ...(l.note ? { note: l.note } : {}),
  }));
}

export function cartStorageKey(slug: string, tableHash: string | null): string {
  return `cart:${slug}:${tableHash ?? "link"}`;
}

/** Aba anônima ou storage bloqueado: carrinho só em memória, nunca erro. */
export function loadCart(key: string): CartLine[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function saveCart(key: string, lines: CartLine[]): void {
  try {
    if (lines.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(lines));
  } catch {
    // sem storage: segue em memória
  }
}
```

```ts
// apps/menu/src/lib/checkout.ts
import type { PaymentMethod } from "./types.ts";

export type DineInPayment = "cash" | "card_on_delivery" | "pix";

/** No salão paga-se no caixa, ao sair: sem troco, sem vale-refeição. */
export const DINE_IN_PAYMENTS: { method: DineInPayment; label: string }[] = [
  { method: "cash", label: "Dinheiro no caixa" },
  { method: "card_on_delivery", label: "Cartão no caixa" },
  { method: "pix", label: "Pix" },
];

export function dineInPayments(accepted: PaymentMethod[]) {
  return DINE_IN_PAYMENTS.filter((p) => accepted.includes(p.method));
}

export function checkoutBlock(form: { name: string; phone: string; payment: DineInPayment | null }): string | null {
  if (!form.name.trim()) return "Informe seu nome";
  if (form.phone.replace(/\D/g, "").length < 10) return "Informe um telefone válido";
  if (!form.payment) return "Escolha a forma de pagamento";
  return null;
}
```

- [ ] **Step 3: Ver passar, commit**

Run: `pnpm --filter @menuclick/menu test && pnpm --filter @menuclick/menu exec tsc --noEmit`
Expected: verde.

```bash
git add apps/menu
git commit -m "feat(menu): ✨ adiciona a seleção de opções, o preço ao vivo e o carrinho"
```

---

### Task 9: App — a página do cardápio

**Files:**
- Create: `apps/menu/src/app/[slug]/page.tsx`, `apps/menu/src/app/[slug]/not-found.tsx`, `apps/menu/src/components/{MenuApp.tsx,TableResolver.tsx,MenuHeader.tsx,StoreNotice.tsx,ProductGrid.tsx,BottomBar.tsx}`, `apps/menu/test/menu-page.test.tsx`

**Interfaces:**
- Consumes: Tasks 7 e 8.
- Produces: `MenuApp({ menu, tableHash, tableLabel, tableUnknown })` — o componente testável; `TableResolver({ menu })` lê `?mesa=` no navegador e renderiza `MenuApp`.

- [ ] **Step 1: Testes que falham**

```tsx
// apps/menu/test/menu-page.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { makeMenu } from "./fixtures.ts";

describe("cardápio", () => {
  it("topo, chips, seções e cards", () => {
    render(<MenuApp menu={makeMenu()} tableHash={null} tableLabel={null} tableUnknown={false} />);
    expect(screen.getByRole("heading", { name: "Cantina do Porto" })).toBeTruthy();
    expect(screen.getByText("Aberto até 23h")).toBeTruthy();
    expect(screen.getByText("Pedido mínimo R$ 30,00")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Pizzas" })).toBeTruthy();
    expect(screen.getByText("a partir de")).toBeTruthy();
    expect(screen.getByText("Indisponível hoje")).toBeTruthy();
  });

  it("na mesa: faixa com o rótulo, sem mínimo nem frete grátis", () => {
    render(<MenuApp menu={makeMenu()} tableHash="a7f3" tableLabel="Mesa 7" tableUnknown={false} />);
    expect(screen.getByText("Mesa 7")).toBeTruthy();
    expect(screen.getByText("Pedido no salão")).toBeTruthy();
    expect(screen.queryByText(/Pedido mínimo/)).toBeNull();
  });

  it("mesa não resolveu: aviso discreto, cardápio segue", () => {
    render(<MenuApp menu={makeMenu()} tableHash="velho" tableLabel={null} tableUnknown />);
    expect(
      screen.getByText("Não reconhecemos esta mesa. Você pode pedir normalmente — a loja vai confirmar sua mesa."),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cantina do Porto" })).toBeTruthy();
  });

  it("busca filtra no aparelho", () => {
    render(<MenuApp menu={makeMenu()} tableHash={null} tableLabel={null} tableUnknown={false} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar no cardápio" }), { target: { value: "calab" } });
    expect(screen.getByText("Calabresa")).toBeTruthy();
    expect(screen.queryByText("Margherita")).toBeNull();
  });

  it("fechada: manchete, grade da semana, sem adicionar", () => {
    const menu = makeMenu({ isOpen: false, closesAt: undefined, opensAt: "2026-09-22T21:00:00.000Z" });
    render(<MenuApp menu={menu} tableHash="a7f3" tableLabel="Mesa 7" tableUnknown={false} now={Date.parse("2026-09-21T15:00:00-03:00")} />);
    expect(screen.getByText("Fechado. Abre amanhã às 18h")).toBeTruthy();
    expect(screen.getByText("O cardápio continua visível abaixo — só não dá para pedir.")).toBeTruthy();
  });

  it("pausada: texto sem prometer hora", () => {
    render(<MenuApp menu={makeMenu({ isOpen: false, acceptingOrders: false })} tableHash="a7f3" tableLabel="Mesa 7" tableUnknown={false} />);
    expect(screen.getByText("A loja não está aceitando pedidos no momento")).toBeTruthy();
    expect(screen.getByText("Pode ser uma pausa curta. Vale tentar de novo em alguns minutos.")).toBeTruthy();
  });

  it("cardápio vazio", () => {
    render(<MenuApp menu={makeMenu({}, [])} tableHash={null} tableLabel={null} tableUnknown={false} />);
    expect(screen.getByText("Cardápio ainda não publicado")).toBeTruthy();
  });

  it("a página usa ISR e NÃO lê searchParams no servidor (Review Focus 1)", () => {
    const source = readFileSync(new URL("../src/app/[slug]/page.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/export const revalidate = 60/);
    expect(source).not.toMatch(/searchParams/);
  });

  it("a cor da marca vira a cor de ação", () => {
    const { container } = render(
      <MenuApp menu={makeMenu({ brandColor: "#0B7A48" })} tableHash={null} tableLabel={null} tableUnknown={false} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--brand-action")).toBe("#0B7A48");
  });
});
```

`apps/menu/test/fixtures.ts` com `makeMenu(overrides?: Partial<MenuRestaurant>, sections?: MenuSection[])` montando a "Cantina do Porto" do protótipo: seção Pizzas (Margherita R$ 52 disponível sem grupo obrigatório; Meio a meio R$ 30 com o grupo "Sabores" `highest` min 2 max 2 e "Borda" opcional; Quatro queijos indisponível; Calabresa R$ 49), seção Bebidas; `isOpen: true`, `acceptingOrders: true`, `closesAt: "2026-09-22T02:00:00.000Z"`, `timezone: "America/Sao_Paulo"`, `minimumOrderInCents: 3000`, `freeDeliveryAboveInCents: 5000`, `paymentMethods: ["cash","card_on_delivery","pix"]`, `openingHours` da semana.

Run: `pnpm --filter @menuclick/menu test`
Expected: FAIL.

- [ ] **Step 2: A página (servidor)**

```tsx
// apps/menu/src/app/[slug]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TableResolver } from "@/components/TableResolver.tsx";
import { getMenu } from "@/lib/api.ts";

// ISR: o cardápio sai do cache e se refaz a cada 60 s. A mesa (?mesa=) é lida
// NO NAVEGADOR — ler searchParams aqui tornaria a página dinâmica e mataria o
// cache (e com ele a folga para a API acordar num plano gratuito).
export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const menu = await getMenu(slug);
  if (!menu) return { title: "Cardápio" };
  return {
    title: `${menu.restaurant.name} · Cardápio`,
    description: `${menu.restaurant.cuisineType} — peça pelo celular.`,
    openGraph: { title: menu.restaurant.name, images: menu.restaurant.coverUrl ? [menu.restaurant.coverUrl] : [] },
  };
}

export default async function MenuPage({ params }: Props) {
  const { slug } = await params;
  const menu = await getMenu(slug);
  if (!menu) notFound();
  return (
    <Suspense fallback={null}>
      <TableResolver menu={menu} />
    </Suspense>
  );
}
```

`apps/menu/src/app/[slug]/not-found.tsx` reexporta o `not-found` da raiz (`export { default } from "../not-found.tsx";`).

```tsx
// apps/menu/src/components/TableResolver.tsx
"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { resolveTable } from "@/lib/api.ts";
import type { Menu } from "@/lib/types.ts";
import { MenuApp } from "./MenuApp.tsx";

/** Lê ?mesa= no navegador e resolve o rótulo. Mesa que não resolve não trava nada. */
export function TableResolver({ menu }: { menu: Menu }) {
  const hash = useSearchParams().get("mesa");
  const [label, setLabel] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);

  useEffect(() => {
    if (!hash) return;
    let alive = true;
    void resolveTable(menu.restaurant.slug, hash).then((found) => {
      if (!alive) return;
      setLabel(found);
      setUnknown(found === null);
    });
    return () => {
      alive = false;
    };
  }, [hash, menu.restaurant.slug]);

  return <MenuApp menu={menu} tableHash={unknown ? null : hash} tableLabel={label} tableUnknown={unknown} />;
}
```

- [ ] **Step 3: `MenuApp` e o cardápio**

`MenuApp` é o dono das telas (`"menu" | "product" | "cart" | "checkout" | "sent"`) e do carrinho (carregado de `loadCart(cartStorageKey(slug, tableHash))` num `useEffect` e salvo a cada mudança). Assinatura:

```tsx
export function MenuApp(props: {
  menu: Menu;
  tableHash: string | null;
  tableLabel: string | null;
  tableUnknown: boolean;
  /** Relógio injetável para teste; padrão Date.now(). */
  now?: number;
}): JSX.Element
```

O elemento raiz leva `style={{ "--brand-action": menu.restaurant.brandColor ?? "#1E5AE8" } as CSSProperties}` e `className="mx-auto min-h-dvh max-w-[480px] bg-paper pb-28"`. Na tela `menu`:

- `MenuHeader`: capa (`<img>` com `alt=""` em bloco `aspect-[16/7] bg-paper-3`, ou o bloco vazio com o texto "capa da loja" em `text-ink-3` quando não há), logo 56×56 `rounded-card` (ou bloco "LOGO"), `<h1>` nome 19/600, `cuisineType` 13 `text-ink-2`; chips (`rounded-full border px-3 py-1 text-[13px] font-semibold`): o de `openChip` (verde `border-success/30 text-success` aberto; `bg-warn-soft text-warn` pausado/fechado), e **só quando `tableHash` é nulo** "Pedido mínimo R$ 30,00" (se `minimumOrderInCents > 0`) e "Entrega grátis acima de R$ 50,00" (se definido), em azul `text-action border-action/30`.
- Faixa da mesa (se `tableLabel`): `sticky top-0` com "Mesa 7" (600) e "Pedido no salão" (13 `text-ink-2`).
- `StoreNotice`: o aviso da mesa não reconhecida (`bg-warn-soft text-warn`, 13 px); fechado → `closedHeadline` + `weekRows` numa lista + "O cardápio continua visível abaixo — só não dá para pedir."; pausada → os dois textos do board.
- Busca: `<input type="search" aria-label="Buscar no cardápio" placeholder="Buscar no cardápio">` com ícone de lupa em SVG próprio (`aria-hidden`), `rounded-field bg-paper-2 h-12`. Filtra por nome e descrição, sem acento e sem caixa (`normalize("NFD")`).
- Abas: `role="tablist"` com `role="tab"` por seção (sublinhado `border-b-2 border-action` na ativa), `sticky`; tocar rola até a seção (`scrollIntoView`).
- `ProductGrid`: por seção, rótulo 13/600 caixa alta `text-ink-3`, grade `grid-cols-2 gap-3`; card `rounded-card border border-line overflow-hidden` com foto `aspect-square` (ou bloco "FOTO"), nome 15/600, descrição 13 `text-ink-2 line-clamp-2`, `fromPrice` (prefixo 12 `text-ink-3` + preço 16/600). Indisponível: `opacity-60`, "Indisponível hoje", `aria-disabled`, não abre. O card inteiro é um `<button>` (alvo ≥ 44 px).
- Cardápio vazio: "Cardápio ainda não publicado" / "A loja está montando os pratos. Volte em breve."
- `BottomBar` (`fixed bottom-0 inset-x-0 mx-auto max-w-[480px] p-4 bg-paper border-t border-line`): quando o carrinho tem itens, `<button className="h-14 w-full rounded-field bg-action text-white">` com o contador, "Ver carrinho" e o subtotal. Some quando a loja não aceita pedido agora (fechada/pausada) e, na parte 1, quando não há mesa (`tableHash` nulo).

- [ ] **Step 4: Ver passar, commit**

Run: `pnpm --filter @menuclick/menu test && pnpm --filter @menuclick/menu exec tsc --noEmit`
Expected: verde.

```bash
git add apps/menu
git commit -m "feat(menu): ✨ adiciona o cardápio com os estados da loja e a mesa"
```

---

### Task 10: App — a tela do produto

**Files:**
- Create: `apps/menu/src/components/ProductScreen.tsx`, `apps/menu/test/product-screen.test.tsx`
- Modify: `MenuApp.tsx` (abre o produto e recebe a linha)

**Interfaces:**
- Produces: `ProductScreen({ product, groups, canOrder, onBack, onAdd(line: CartLine) })`.

- [ ] **Step 1: Teste que falha**

```tsx
// apps/menu/test/product-screen.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductScreen } from "../src/components/ProductScreen.tsx";
import { makeMenu } from "./fixtures.ts";

const menu = makeMenu();
const meio = menu.sections[0].products.find((p) => p.name === "Meio a meio")!;

describe("produto", () => {
  it("trava dizendo o que falta, libera ao completar, total ao vivo", () => {
    const onAdd = vi.fn();
    render(<ProductScreen product={meio} groups={menu.optionGroups} canOrder onBack={() => {}} onAdd={onAdd} />);
    const locked = screen.getByRole("button", { name: "Escolha 2 em Sabores" });
    expect(locked.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /Margherita/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Quatro queijos/ }));
    expect(screen.getByText("R$ 80,00")).toBeTruthy(); // 30 + mais caro (50)

    fireEvent.click(screen.getByRole("button", { name: "Aumentar quantidade" }));
    expect(screen.getByText("R$ 160,00")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Observação"), { target: { value: "sem cebola" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ao carrinho" }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ productId: meio.id, quantity: 2, unitPriceInCents: 8000, note: "sem cebola" }),
    );
  });

  it("sem poder pedir (fechada ou sem mesa), não há botão de adicionar", () => {
    render(<ProductScreen product={meio} groups={menu.optionGroups} canOrder={false} onBack={() => {}} onAdd={() => {}} />);
    expect(screen.queryByRole("button", { name: /carrinho|Escolha/ })).toBeNull();
  });
});
```

Run: `pnpm --filter @menuclick/menu test`
Expected: FAIL.

- [ ] **Step 2: Implementar**

`ProductScreen`: cabeçalho com botão "Voltar" (`aria-label="Voltar"`, SVG de seta, 44 px), foto (`aspect-[4/3]`), nome 19/600, descrição 15 `text-ink-2`, preço base. Por grupo de `productGroups(product, groups)`: `<fieldset>` com `<legend>` (nome 15/600), `groupHint` (13 `text-ink-2`) e `groupBadge` (chip `rounded-chip bg-paper-2 text-[12px]`); cada opção é `<label>` de 48 px com `<input type="checkbox">` (ou `radio` quando `maxOptions === 1`) estilizado, nome e `optionPriceLabel`, controlado por `toggleOption`. Depois:

- "Observação" (`<label htmlFor>` + `<textarea maxLength={140} placeholder="ex.: sem cebola">`, `rounded-field`).
- Stepper "−" / qty / "+" com `aria-label="Diminuir quantidade"` / `"Aumentar quantidade"` (mínimo 1).
- Rodapé fixo (só com `canOrder`): "Total do item" + `formatCents(itemUnitPrice(...) * qty)` e o botão — `missingGroup` presente → `disabled` com o texto `lockReason(group)`; senão "Adicionar ao carrinho", que chama `onAdd` com `{ key: lineKey(product.id, sel, note), productId, name, unitPriceInCents, quantity: qty, options: [...] (id + nome), note: normalizeNote(note) }`.

Em `MenuApp`: tocar num card disponível abre `ProductScreen`; `onAdd` faz `addLine`, salva e volta ao cardápio; `canOrder = tableHash !== null && restaurant.isOpen` (o `isOpen` já considera a pausa).

- [ ] **Step 3: Ver passar, commit**

Run: `pnpm --filter @menuclick/menu test && pnpm --filter @menuclick/menu exec tsc --noEmit`
Expected: verde.

```bash
git add apps/menu
git commit -m "feat(menu): ✨ adiciona a tela do produto com opções, observação e preço ao vivo"
```

---

### Task 11: App — carrinho, finalizar no salão e enviado

**Files:**
- Create: `apps/menu/src/components/{CartScreen.tsx,CheckoutScreen.tsx,SentScreen.tsx}`, `apps/menu/test/dine-in-flow.test.tsx`
- Modify: `MenuApp.tsx`

**Interfaces:**
- Consumes: `createDineInOrder`, `checkoutBlock`, `dineInPayments`, `toOrderItems`, `subtotal`, `bump`, `optionsText`.

- [ ] **Step 1: Teste que falha**

```tsx
// apps/menu/test/dine-in-flow.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { saveCart } from "../src/lib/cart.ts";
import { makeMenu } from "./fixtures.ts";

const menu = makeMenu();
const marg = menu.sections[0].products.find((p) => p.name === "Margherita")!;

function withCart() {
  saveCart("cart:cantina-do-porto:a7f3", [
    { key: `${marg.id}|note:sem cebola`, productId: marg.id, name: "Margherita", unitPriceInCents: 5200, quantity: 2, options: [], note: "sem cebola" },
  ]);
  render(<MenuApp menu={menu} tableHash="a7f3" tableLabel="Mesa 7" tableUnknown={false} />);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("pedido no salão", () => {
  it("do carrinho ao enviado, com mesa, observação e pagamento", async () => {
    const fetchMock = vi.fn(async () => json({ id: "o1", number: 42 }, 201));
    vi.stubGlobal("fetch", fetchMock);
    withCart();

    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    expect(screen.getByText("Mesa 7")).toBeTruthy();
    expect(screen.getByText("sem cebola")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));

    const send = () => screen.getByRole("button", { name: /Enviar para a cozinha|Informe|Escolha/ });
    expect(send().textContent).toBe("Informe seu nome");
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "(11) 99999-0000" } });
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar para a cozinha" }));

    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeTruthy();
    expect(screen.getByText("É só aguardar na Mesa 7. A comida chega até você.")).toBeTruthy();
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({
      type: "dine_in",
      tableHash: "a7f3",
      paymentMethod: "pix",
      customer: { name: "Ana", phone: "(11) 99999-0000" },
      items: [{ productId: marg.id, quantity: 2, note: "sem cebola" }],
    });
    expect(localStorage.getItem("cart:cantina-do-porto:a7f3")).toBeNull();
  });

  it("409 da API (loja pausou no meio): mostra a mensagem e mantém o carrinho", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "A loja não está aceitando pedidos no momento" }, 409)));
    withCart();
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11999990000" } });
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar para a cozinha" }));
    expect(await screen.findByText("A loja não está aceitando pedidos no momento")).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem("cart:cantina-do-porto:a7f3")).not.toBeNull());
  });

  it("carrinho vazio orienta de volta ao cardápio", async () => {
    render(<MenuApp menu={menu} tableHash="a7f3" tableLabel="Mesa 7" tableUnknown={false} initialScreen="cart" />);
    expect(screen.getByText("Carrinho vazio")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver cardápio" })).toBeTruthy();
  });
});
```

(`MenuApp` ganha a prop opcional `initialScreen` só para este teste de estado; o slug do fixture é `cantina-do-porto`.)

Run: `pnpm --filter @menuclick/menu test`
Expected: FAIL.

- [ ] **Step 2: Implementar**

- `CartScreen`: título "Seu carrinho" + contexto (`tableLabel ?? ""`); linhas (nome 15/600, `optionsText`, observação em 13 `text-ink-2`, stepper com `aria-label` por linha, total da linha); vazio → "Carrinho vazio" / "Volte ao cardápio e escolha o primeiro item." / botão "Ver cardápio"; "+ Adicionar mais itens" (volta ao cardápio); "Itens" + subtotal; rodapé fixo "Finalizar pedido" (desabilitado com carrinho vazio). Sem pedido mínimo (salão).
- `CheckoutScreen` (salão, "Passo único"): "Quem está pedindo?" + "Sem cadastro. Só o nome e o telefone para a loja te achar." + campos "Nome" (`autoComplete="name"`) e "Telefone" (`inputMode="tel" autoComplete="tel"`); "Como você paga?" com `dineInPayments(restaurant.paymentMethods)` como `radiogroup` (linhas de 52 px) e a nota "O pagamento é no caixa, na hora de sair. Você pode pedir mais coisas antes disso."; "Resumo" (Itens + TOTAL 16/700); rodapé fixo com o botão: `checkoutBlock` não nulo → `disabled` com o texto do bloqueio; senão "Enviar para a cozinha". Envio: `createDineInOrder(restaurant.id, { type: "dine_in", customer: { name: name.trim(), phone }, items: toOrderItems(lines), paymentMethod, ...(tableHash ? { tableHash } : {}) })`; enquanto envia, o botão fica ocupado e desabilitado; `OrderError` mostra `error.message` em `role="alert"` (`text-danger`) e mantém o carrinho; 400 acrescenta "Revise o carrinho: algo mudou no cardápio." e um botão "Voltar ao carrinho".
- `SentScreen`: "Pedido enviado para a cozinha" (display 26/600/−3%), "É só aguardar na Mesa 7. A comida chega até você." (sem mesa: "É só aguardar. A comida chega até você."), resumo (itens e TOTAL) e "Voltar ao cardápio". Ao montar, o carrinho já foi limpo (`saveCart(key, [])`).

- [ ] **Step 3: Ver passar, commit**

Run: `pnpm --filter @menuclick/menu test && pnpm --filter @menuclick/menu exec tsc --noEmit && pnpm --filter @menuclick/menu build`
Expected: verde.

```bash
git add apps/menu
git commit -m "feat(menu): ✨ adiciona o carrinho e o envio do pedido do salão"
```

---

### Task 12: Documentação e verificação ponta a ponta

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-09-29-app-do-cliente-parte-1-design.md` (estado), `README.md` (estrutura, se listar apps)

- [ ] **Step 1: `CLAUDE.md`** — seção "App do cliente (`apps/menu`)": Next 16 + Tailwind 4; ISR de 60 s só no cardápio e ⚠️ **a mesa é lida no navegador** (ler `searchParams` na página a torna dinâmica); `packages/pricing` é a fonte única de preço (API e app), TypeScript apagável e um arquivo só; carrinho em `localStorage` por loja e mesa, com fusão igual à da API (opções + observação); a cor de ação vem de `brand_color` e a API recusa contraste < 4.5:1; o cardápio público passou a trazer `timezone` (decisão deliberada da S10: sem ele o app erraria a hora); `MENU_BASE_URL` agora é a origem do app (`:3000`) e ela entra em `CORS_ORIGINS`. Seção Comandos: `pnpm --filter @menuclick/menu dev|test|build` e `pnpm --filter @menuclick/pricing test`.

- [ ] **Step 2: Ponta a ponta no navegador (390 px)**

Com `pnpm dev` (API, painel e app) e o `.env` da API com `MENU_BASE_URL=http://localhost:3000` e `CORS_ORIGINS=http://localhost:3000`:
1. No painel, criar/usar uma mesa e copiar o `qrUrl` (deve começar com `http://localhost:3000/`).
2. Abrir o `qrUrl` a 390 px: faixa da mesa, chips, grade.
3. Abrir "Meio a meio", ver o botão travado, escolher 2 sabores, ver o total ao vivo, escrever "sem cebola", adicionar.
4. Carrinho → Finalizar → nome, telefone, Pix → "Enviar para a cozinha" → tela de enviado.
5. No painel, o pedido chega em "Novos" com a mesa; no detalhe, "Obs.: sem cebola" e o total igual ao da tela.

- [ ] **Step 3: Verificação e commit**

Run: `pnpm lint && pnpm build && pnpm --filter @menuclick/pricing test && pnpm --filter @menuclick/api test && pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/menu test`
Expected: tudo verde.

```bash
git add CLAUDE.md README.md docs
git commit -m "docs: 📝 documenta o app do cliente e o pacote de preço"
```
