# Venda sugestiva — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A loja marca produtos como sugestão no painel, e o carrinho do app do cliente os oferece em "Que tal adicionar?".

**Architecture:** Uma coluna booleana em `products` (`is_suggested`), exposta como `isSuggested` nas rotas de gestão e como `suggested` no cardápio público. O painel ganha um interruptor no formulário do produto. O app do cliente filtra as sugestões com uma função pura e as mostra numa faixa do carrinho; o toque adiciona direto ou abre a tela do produto.

**Tech Stack:** Fastify 5 + `pg` (SQL na mão) + node-pg-migrate; Vite + React 19 + Mantine 9; Next 16 + Tailwind 4; Vitest em tudo.

**Spec:** `docs/superpowers/specs/2026-10-09-venda-sugestiva-design.md`

## Global Constraints

- Nenhuma dependência nova.
- Três camadas na API: rota → serviço → repositório; SQL só no repositório.
- `SET` dinâmico percorre o mapa fixo campo→coluna, nunca as chaves do corpo (D8, S8).
- Campo novo só sai no cardápio público se entrar no `schema.response` (S10).
- Migration criada por `migrate:create`, com `Down` que desfaz o `Up`, sem `if not exists` (D16–D21).
- Imports locais da API com extensão `.ts`; só sintaxe apagável.
- Copy literal: interruptor **Sugerir no carrinho**; ajuda **Aparece em "Que tal adicionar?" quando o cliente abre o carrinho.**; título da faixa **Que tal adicionar?**; botões **Adicionar** e **Escolher**.
- Teto de 6 sugestões.
- Miniatura na largura 400 (`imageUrl(url, 400)`): nenhuma transformação nova.
- Painel: cor só por `var(--mc-*)`, sem transição nem animação.
- Commits: `<tipo>(<escopo>): <emoji> <mensagem>` em pt-BR, sem trailer de atribuição.
- Ambiente local: Postgres na porta 5434 (`DB_PORT=5434` nos comandos da API); `unset -f node pnpm` antes de usar `pnpm`.
- TDD: cada teste é visto falhar antes da implementação.

## Review Focus

1. Produto sugerido que **esgota** depois de a página entrar no cache: não pode aparecer na faixa (coberto na Task 3, `available: false`).
2. Produto sugerido **já no carrinho com opções**: não pode ser sugerido de novo (Task 3, comparação por `productId`).
3. `PATCH` que **não manda** `isSuggested` não pode desligar a marca (Task 1).
4. `isSuggested` **não pode sair** no cardápio público com esse nome (Task 1).
5. Voltar da tela do produto aberta pela faixa, **sem adicionar**, cai no carrinho e não no cardápio (Task 4).

---

### Task 1: API — coluna, gestão e cardápio público

**Files:**
- Create: `apps/api/migrations/<timestamp>_add-is-suggested-to-products.sql` (pelo `migrate:create`)
- Modify: `apps/api/src/domain/product.ts`
- Modify: `apps/api/src/domain/menu.ts`
- Modify: `apps/api/src/repositories/products.ts`
- Modify: `apps/api/src/routes/products.ts`
- Modify: `apps/api/src/routes/menu.ts`
- Modify: `apps/api/src/services/menu.ts`
- Modify: `apps/api/openapi.json` (gerado)
- Test: `apps/api/test/products.suggested.test.ts`

**Interfaces:**
- Produces: `Product.isSuggested: boolean` (gestão); `MenuProduct.suggested: boolean` (público, sem `isSuggested`).

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/test/products.suggested.test.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createProduct, createRestaurant, validProductBody } from "./helpers.ts";

/**
 * `isSuggested`: a marca de "sugerir no carrinho". Na gestão o campo é
 * `isSuggested`; no cardápio público sai como `suggested`, ao lado de
 * `available`.
 */
describe("produto sugerido no carrinho", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const menuProducts = async (slug: string) => {
    const response = await app.inject({ method: "GET", url: `/menu/${slug}/products` });
    return response.json().data.flatMap((section: { products: unknown[] }) => section.products) as Record<
      string,
      unknown
    >[];
  };

  it("produto criado sem a marca nasce não sugerido", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant);
    expect(product.isSuggested).toBe(false);
  });

  it("a criação aceita a marca", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant, { isSuggested: true });
    expect(product.isSuggested).toBe(true);
  });

  it("o PATCH liga e desliga, e a leitura devolve o que ficou", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant);
    const url = `/restaurants/${restaurant.id}/products/${product.id}`;

    const on = await app.inject({ method: "PATCH", url, headers: restaurant.headers, payload: { isSuggested: true } });
    expect(on.statusCode).toBe(200);
    expect(on.json().isSuggested).toBe(true);
    expect((await app.inject({ method: "GET", url, headers: restaurant.headers })).json().isSuggested).toBe(true);

    const off = await app.inject({ method: "PATCH", url, headers: restaurant.headers, payload: { isSuggested: false } });
    expect(off.json().isSuggested).toBe(false);
  });

  it("PATCH de outro campo não desliga a marca", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant, { isSuggested: true });
    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}/products/${product.id}`,
      headers: restaurant.headers,
      payload: { name: "Outro nome" },
    });
    expect(response.json().isSuggested).toBe(true);
  });

  it("valor que não é booleano é 400", async () => {
    const restaurant = await createRestaurant(app);
    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/products`,
      headers: restaurant.headers,
      payload: { ...validProductBody, isSuggested: "sim" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("o cardápio público diz `suggested`, e não vaza `isSuggested`", async () => {
    const restaurant = await createRestaurant(app);
    await createProduct(app, restaurant, { name: "Água", stock: 5, isSuggested: true });
    await createProduct(app, restaurant, { name: "Ramen", stock: 5 });

    const products = await menuProducts(restaurant.slug);
    const byName = Object.fromEntries(products.map((product) => [product.name, product]));
    expect(byName["Água"].suggested).toBe(true);
    expect(byName["Ramen"].suggested).toBe(false);
    expect(products.every((product) => !("isSuggested" in product))).toBe(true);
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `DB_PORT=5434 pnpm --filter @menuclick/api exec vitest run test/products.suggested.test.ts`
Expected: FAIL — `isSuggested` vem `undefined` no primeiro teste (o campo não existe na resposta).

- [ ] **Step 3: Criar a migration**

Run: `pnpm --filter @menuclick/api migrate:create add-is-suggested-to-products`

Preencher o arquivo gerado:

```sql
-- Up Migration

-- "Sugerir no carrinho": a loja marca o produto e o app do cliente o oferece
-- em "Que tal adicionar?". O default é o backfill — produto que já existe
-- nasce NÃO sugerido, e o carrinho de nenhuma loja muda no deploy.
--
-- Sem índice: a coluna nunca é filtro de consulta. O cardápio público já traz
-- todos os produtos, e quem separa os sugeridos é o app.
alter table products add column is_suggested boolean not null default false;

-- Down Migration

alter table products drop column is_suggested;
```

Run: `DB_PORT=5434 pnpm --filter @menuclick/api migrate:up`
Expected: a migration aparece como aplicada. (O banco de teste é migrado sozinho pelo `globalSetup`.)

- [ ] **Step 4: Domínio**

Em `apps/api/src/domain/product.ts`, dentro de `CreateProductInput`, depois de `stock`:

```ts
  /** "Sugerir no carrinho". Ausente = `false` (o default da coluna). */
  isSuggested?: boolean;
```

E em `Product`, depois de `stock: number;`:

```ts
  /** Sempre presente na leitura, como o `stock`. */
  isSuggested: boolean;
```

Em `apps/api/src/domain/menu.ts`, `MenuProduct` passa a omitir também `isSuggested` e a declarar `suggested`:

```ts
export type MenuProduct = Omit<
  Product,
  "stock" | "restaurantId" | "createdAt" | "updatedAt" | "categoryId" | "isSuggested"
> & {
  available: boolean;
  /**
   * A loja marcou este produto para ser oferecido no carrinho. Sai sem o `is`
   * para acompanhar `available`; `isSuggested` é o nome da gestão e não chega
   * aqui — um nome só por superfície.
   */
  suggested: boolean;
```

(o restante do tipo, `optionGroupIds`, fica como está)

- [ ] **Step 5: Repositório**

Em `apps/api/src/repositories/products.ts`:

`ProductRow` ganha `is_suggested: boolean;` depois de `stock`.

`toProduct` ganha, depois de `stock: row.stock,`:

```ts
    isSuggested: row.is_suggested,
```

`productColumns` ganha `isSuggested: "is_suggested",` depois de `stock`.

`insert` passa a gravar a coluna:

```ts
    `insert into products
       (restaurant_id, name, category_id, price_in_cents, description, photo_url, stock, is_suggested)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning *`,
    [
      restaurantId,
      input.name,
      input.categoryId ?? null,
      input.priceInCents,
      input.description ?? null,
      input.photoUrl ?? null,
      // a coluna é `not null default 0`; sem valor explícito o driver mandaria
      // NULL (que não é "ausente") e a inserção estouraria.
      input.stock ?? 0,
      // mesmo motivo do `stock`: `not null default false`
      input.isSuggested ?? false,
    ],
```

- [ ] **Step 6: Rotas de gestão**

Em `apps/api/src/routes/products.ts`:

`createProductBodySchema.properties`, depois de `stock`:

```ts
    // "sugerir no carrinho"; ausente = false
    isSuggested: { type: "boolean" },
```

`updateProductBodySchema.properties`, depois de `stock`:

```ts
    isSuggested: { type: "boolean" },
```

`productResponseSchema.properties`, depois de `stock`:

```ts
    isSuggested: { type: "boolean" },
```

Na `description` do `POST`, acrescentar ao fim: `` `isSuggested` marca o produto para ser oferecido no carrinho do cliente (ausente = `false`).``
Na `description` do `PATCH`, acrescentar ao fim: `` `isSuggested` liga e desliga a sugestão no carrinho.``

⚠️ O validador do corpo é o estrito (sem coerção): `"sim"` é 400 e não `true`. Não trocar de validador.

- [ ] **Step 7: Cardápio público**

Em `apps/api/src/routes/menu.ts`, `menuProductResponseSchema.properties`, depois de `available`:

```ts
    // a loja marcou para oferecer no carrinho (S10: entra por decisão — o app
    // precisa para montar a faixa, e quem abre o carrinho já vê as sugestões)
    suggested: { type: "boolean" },
```

Em `apps/api/src/services/menu.ts`, `toMenuProduct`, depois de `available: …,`:

```ts
    suggested: product.isSuggested,
```

Na `description` da rota `GET /menu/:slug/products`, acrescentar ao fim: `` `suggested` diz que a loja quer oferecer aquele produto no carrinho.``

- [ ] **Step 8: Ver passar**

Run: `DB_PORT=5434 pnpm --filter @menuclick/api exec vitest run test/products.suggested.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 9: Regerar o OpenAPI e rodar a suíte**

Run: `pnpm --filter @menuclick/api openapi:generate`
Run: `DB_PORT=5434 pnpm --filter @menuclick/api test`
Expected: PASS em tudo (inclusive `openapi.test.ts`, que compara o arquivo commitado com o gerado).
Run: `pnpm --filter @menuclick/api build`
Expected: sem erro de tipo.

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(products): ✨ marca produto como sugestão do carrinho"
```

---

### Task 2: Painel — interruptor "Sugerir no carrinho"

**Files:**
- Modify: `apps/panel/src/api/types.ts`
- Modify: `apps/panel/src/api/products.ts` (tipos `CreateProductBody`/`UpdateProductBody`)
- Modify: `apps/panel/src/features/products/productForm.ts`
- Modify: `apps/panel/src/features/products/ProductFormPage.tsx`
- Modify: `apps/panel/test/fixtures.ts`
- Test: `apps/panel/test/productForm.test.ts`, `apps/panel/test/product-form.test.tsx`

**Interfaces:**
- Consumes: `isSuggested: boolean` nas respostas e corpos de produto (Task 1).
- Produces: `ProductForm.isSuggested: boolean`; `ValidProduct.isSuggested: boolean`.

- [ ] **Step 1: Testes que falham**

Em `apps/panel/test/fixtures.ts`, `makeProduct` ganha `isSuggested: false,` depois de `stock: 12,` (vai dar erro de tipo até o Step 3 — esperado).

Em `apps/panel/test/productForm.test.ts`:

- no teste "valida e converte o preço por string", o `value` esperado ganha `isSuggested: false,` depois de `stock: 12,`;
- no teste "criação omite o que ficou vazio", o esperado vira `{ name: "Pizza Grande", priceInCents: 4590, stock: 12, isSuggested: false }`;
- acrescentar:

```ts
  it("leva a marca de sugestão do produto para o formulário e de volta para o corpo", () => {
    const form = fromProduct(makeProduct({ isSuggested: true }));
    expect(form.isSuggested).toBe(true);
    const result = validateProductForm(form);
    if (!result.ok) throw new Error("devia ser válido");
    expect(toCreateBody(result.value).isSuggested).toBe(true);
    expect(toUpdateBody(result.value).isSuggested).toBe(true);
  });

  it("ligar a sugestão suja o formulário", () => {
    const initial = fromProduct(makeProduct());
    expect(isDirty({ ...initial, isSuggested: true }, initial)).toBe(true);
  });
```

Em `apps/panel/test/product-form.test.tsx`, acrescentar dentro do `describe`:

```ts
  it("o interruptor de sugestão reflete o produto e sai no PATCH", async () => {
    const api = setup(
      [
        { method: "GET", path: `${BASE}/products/prod-1`, body: makeProduct({ isSuggested: false }) },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ isSuggested: true }) },
      ],
      "/produtos/prod-1",
    );
    const toggle = (await screen.findByLabelText("Sugerir no carrinho")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    screen.getByText('Aparece em "Que tal adicionar?" quando o cliente abre o carrinho.');

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    const patches = () => api.calls.filter((call) => call.method === "PATCH" && call.path === `${BASE}/products/prod-1`);
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toMatchObject({ isSuggested: true });
  });
```

(`api.calls` é a lista de chamadas que o `mockApi` devolve: `{ method, path, query, body, headers, host }`.)

- [ ] **Step 2: Ver falhar**

Run: `pnpm --filter @menuclick/panel exec vitest run test/productForm.test.ts test/product-form.test.tsx`
Expected: FAIL — `isSuggested` não existe no formulário; o rótulo "Sugerir no carrinho" não é encontrado.

- [ ] **Step 3: Tipos**

`apps/panel/src/api/types.ts`, em `Product`, depois de `stock: number;`:

```ts
  isSuggested: boolean;
```

`apps/panel/src/api/products.ts`: `CreateProductBody` e `UpdateProductBody` ganham `isSuggested?: boolean;`.

- [ ] **Step 4: Regra do formulário**

`apps/panel/src/features/products/productForm.ts`:

- `ProductForm` ganha `isSuggested: boolean;` depois de `categoryId`;
- `EMPTY_FORM` ganha `isSuggested: false,`;
- `fromProduct` ganha `isSuggested: product.isSuggested,`;
- `ValidProduct` ganha `isSuggested: boolean;`;
- `validateProductForm` devolve `isSuggested: form.isSuggested,` no `value`;
- `toCreateBody` e `toUpdateBody` ganham `isSuggested: value.isSuggested,` depois de `stock`.

- [ ] **Step 5: O interruptor**

`apps/panel/src/features/products/ProductFormPage.tsx`: acrescentar `Switch` ao import de `@mantine/core` e, entre o `</div>` de `classes.priceRow` e o `<ImageField`:

```tsx
            <Switch
              label="Sugerir no carrinho"
              description={'Aparece em "Que tal adicionar?" quando o cliente abre o carrinho.'}
              checked={form.isSuggested}
              onChange={(e) => update({ isSuggested: e.currentTarget.checked })}
            />
```

O interruptor faz parte do formulário: suja a `SaveBar` e sai no `POST`/`PATCH` — não salva sozinho.

- [ ] **Step 6: Ver passar e rodar tudo**

Run: `pnpm --filter @menuclick/panel test`
Expected: PASS em tudo.
Run: `pnpm --filter @menuclick/panel build`
Expected: sem erro de tipo.

- [ ] **Step 7: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ adiciona o interruptor de sugerir no carrinho"
```

---

### Task 3: App do cliente — a regra das sugestões

**Files:**
- Modify: `apps/menu/src/lib/types.ts`
- Create: `apps/menu/src/lib/suggestions.ts`
- Modify: `apps/menu/test/fixtures.ts`
- Test: `apps/menu/test/suggestions.test.ts`

**Interfaces:**
- Consumes: `suggested: boolean` no cardápio público (Task 1).
- Produces:
  - `MenuProduct.suggested?: boolean`
  - `suggestionsFor(products: MenuProduct[], lines: CartLine[], limit?: number): MenuProduct[]`
  - `needsChoice(product: MenuProduct, groups: MenuOptionGroup[]): boolean`
  - `SUGGESTION_LIMIT = 6`

- [ ] **Step 1: Teste que falha**

`apps/menu/test/suggestions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CartLine } from "@/lib/cart.ts";
import { needsChoice, suggestionsFor } from "@/lib/suggestions.ts";
import type { MenuProduct } from "@/lib/types.ts";
import { makeMenu } from "./fixtures.ts";

function product(id: string, overrides: Partial<MenuProduct> = {}): MenuProduct {
  return { id, name: id, priceInCents: 600, available: true, optionGroupIds: [], suggested: true, ...overrides };
}

function line(productId: string, key = productId): CartLine {
  return { key, productId, name: productId, unitPriceInCents: 600, quantity: 1, options: [], note: null };
}

describe("sugestões do carrinho", () => {
  it("só entra o que a loja marcou, na ordem do cardápio", () => {
    const products = [product("a"), product("b", { suggested: false }), product("c"), product("d", { suggested: undefined })];
    expect(suggestionsFor(products, []).map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("produto indisponível não é sugerido", () => {
    expect(suggestionsFor([product("a", { available: false }), product("b")], []).map((p) => p.id)).toEqual(["b"]);
  });

  it("o que já está no carrinho não é sugerido, com quaisquer opções", () => {
    const products = [product("a"), product("b")];
    expect(suggestionsFor(products, [line("a", "a|opt-1|note:")]).map((p) => p.id)).toEqual(["b"]);
  });

  it("corta em 6", () => {
    const products = Array.from({ length: 9 }, (_, index) => product(`p${index}`));
    expect(suggestionsFor(products, []).map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });

  it("sem nada marcado, não há sugestão", () => {
    expect(suggestionsFor([product("a", { suggested: false })], [])).toEqual([]);
  });
});

describe("o toque na sugestão", () => {
  const menu = makeMenu();
  const byId = (id: string) => menu.sections.flatMap((s) => s.products).find((p) => p.id === id)!;

  it("grupo obrigatório pede a tela do produto", () => {
    // "Meio a meio" exige 2 sabores
    expect(needsChoice(byId("p-meio"), menu.optionGroups)).toBe(true);
  });

  it("grupo opcional não impede o toque direto", () => {
    // "Margherita" só tem a borda, que é opcional
    expect(needsChoice(byId("p-marg"), menu.optionGroups)).toBe(false);
  });

  it("produto sem grupo entra direto", () => {
    expect(needsChoice(byId("p-agua"), menu.optionGroups)).toBe(false);
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `pnpm --filter @menuclick/menu exec vitest run test/suggestions.test.ts`
Expected: FAIL — `@/lib/suggestions.ts` não existe.

- [ ] **Step 3: Tipo**

`apps/menu/src/lib/types.ts`, em `MenuProduct`, depois de `available: boolean;`:

```ts
  /**
   * A loja marcou para oferecer no carrinho. Opcional: a página do cardápio
   * pode ter saído do cache antes de a API mandar o campo.
   */
  suggested?: boolean;
```

- [ ] **Step 4: A regra**

`apps/menu/src/lib/suggestions.ts`:

```ts
import type { CartLine } from "./cart.ts";
import { productGroups } from "./selection.ts";
import type { MenuOptionGroup, MenuProduct } from "./types.ts";

/** Quantas sugestões cabem na faixa do carrinho. */
export const SUGGESTION_LIMIT = 6;

/**
 * O que oferecer em "Que tal adicionar?": o que a loja marcou, que dá para
 * pedir agora e que ainda não está no carrinho — na ordem do cardápio.
 *
 * Sai sempre do cardápio de agora, nunca do carrinho guardado: produto que
 * esgotou ou deixou de ser sugerido some sozinho.
 */
export function suggestionsFor(
  products: MenuProduct[],
  lines: CartLine[],
  limit: number = SUGGESTION_LIMIT,
): MenuProduct[] {
  const inCart = new Set(lines.map((line) => line.productId));
  return products
    .filter((product) => product.suggested === true && product.available && !inCart.has(product.id))
    .slice(0, limit);
}

/**
 * Produto com grupo obrigatório não entra com um toque: a pessoa precisa
 * escolher (tamanho, sabor) na tela do produto. Grupo opcional não impede.
 */
export function needsChoice(product: MenuProduct, groups: MenuOptionGroup[]): boolean {
  return productGroups(product, groups).some((group) => group.minOptions > 0);
}
```

- [ ] **Step 5: Ver passar**

Run: `pnpm --filter @menuclick/menu exec vitest run test/suggestions.test.ts`
Expected: PASS, 8 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/menu
git commit -m "feat(menu): ✨ escolhe o que sugerir no carrinho"
```

---

### Task 4: App do cliente — a faixa e o toque

**Files:**
- Modify: `apps/menu/src/components/CartScreen.tsx`
- Modify: `apps/menu/src/components/MenuApp.tsx`
- Test: `apps/menu/test/cart-suggestions.test.tsx`

**Interfaces:**
- Consumes: `suggestionsFor`, `needsChoice` (Task 3); `addLine`, `lineKey` (`lib/cart.ts`); `fromPrice` (`lib/selection.ts`); `imageUrl` (`lib/image.ts`).
- Produces: props novas de `CartScreen`:
  - `suggestions?: CartSuggestion[]` com `type CartSuggestion = { id: string; name: string; priceLabel: string; photoUrl?: string; needsChoice: boolean }`
  - `onSuggestion?: (productId: string) => void`

- [ ] **Step 1: Teste que falha**

`apps/menu/test/cart-suggestions.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type CartSuggestion, CartScreen } from "@/components/CartScreen.tsx";
import { MenuApp } from "@/components/MenuApp.tsx";
import { type CartLine, saveCart } from "@/lib/cart.ts";
import type { MenuSection } from "@/lib/types.ts";
import { makeMenu, SECTIONS } from "./fixtures.ts";

function line(productId: string, name: string): CartLine {
  return { key: productId, productId, name, unitPriceInCents: 4900, quantity: 1, options: [], note: null };
}

const agua: CartSuggestion = { id: "p-agua", name: "Água com gás", priceLabel: "R$ 6,00", needsChoice: false };
const meio: CartSuggestion = { id: "p-meio", name: "Meio a meio", priceLabel: "a partir de R$ 75,00", needsChoice: true };

function renderCart(suggestions: CartSuggestion[], onSuggestion = vi.fn()) {
  render(
    <CartScreen
      lines={[line("p-cala", "Calabresa")]}
      context="Mesa 7"
      suggestions={suggestions}
      onSuggestion={onSuggestion}
      onChange={() => {}}
      onBack={() => {}}
      onCheckout={() => {}}
    />,
  );
  return onSuggestion;
}

/** O cardápio de exemplo, com alguns produtos marcados como sugestão. */
function menuWith(suggested: string[]) {
  const sections: MenuSection[] = SECTIONS.map((section) => ({
    ...section,
    products: section.products.map((product) => ({ ...product, suggested: suggested.includes(product.id) })),
  }));
  return makeMenu({}, sections);
}

async function openCart(suggested: string[]) {
  saveCart("cart:cantina-do-porto:a7f3", [line("p-cala", "Calabresa")]);
  render(<MenuApp menu={menuWith(suggested)} table={{ kind: "found", hash: "a7f3", label: "Mesa 7" }} />);
  fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
  return screen.findByRole("region", { name: "Que tal adicionar?" });
}

describe("faixa de sugestões do carrinho", () => {
  it("sem sugestão, a faixa não aparece", () => {
    renderCart([]);
    expect(screen.queryByText("Que tal adicionar?")).toBeNull();
  });

  it("mostra nome e preço, com o botão certo para cada caso", () => {
    renderCart([agua, meio]);
    const strip = screen.getByRole("region", { name: "Que tal adicionar?" });
    within(strip).getByText("Água com gás");
    within(strip).getByText("R$ 6,00");
    within(strip).getByRole("button", { name: "Adicionar Água com gás" });
    within(strip).getByText("a partir de R$ 75,00");
    within(strip).getByRole("button", { name: "Escolher Meio a meio" });
  });

  it("o toque avisa qual produto foi escolhido", () => {
    const onSuggestion = renderCart([agua]);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar Água com gás" }));
    expect(onSuggestion).toHaveBeenCalledWith("p-agua");
  });

  it("a miniatura é pedida na largura da grade", () => {
    const photoUrl = "https://res.cloudinary.com/nuvem/image/upload/v1/menuclick/r1/products/p1.jpg";
    renderCart([{ ...agua, photoUrl }]);
    const strip = screen.getByRole("region", { name: "Que tal adicionar?" });
    expect(strip.querySelector("img")?.getAttribute("src")).toContain("c_limit,w_400/v1/");
  });
});

describe("sugestão no fluxo do pedido", () => {
  it("Adicionar põe o item no carrinho e o tira da faixa", async () => {
    const strip = await openCart(["p-agua", "p-marg"]);
    fireEvent.click(within(strip).getByRole("button", { name: "Adicionar Água com gás" }));

    // entrou como linha do carrinho
    screen.getByRole("button", { name: "Aumentar Água com gás" });
    // saiu da faixa; a outra sugestão continua
    const after = screen.getByRole("region", { name: "Que tal adicionar?" });
    expect(within(after).queryByText("Água com gás")).toBeNull();
    within(after).getByRole("button", { name: "Adicionar Margherita" });
  });

  it("a última sugestão adicionada leva a faixa embora", async () => {
    const strip = await openCart(["p-agua"]);
    fireEvent.click(within(strip).getByRole("button", { name: "Adicionar Água com gás" }));
    expect(screen.queryByText("Que tal adicionar?")).toBeNull();
  });

  it("não sugere o que já está no carrinho nem o que está indisponível", async () => {
    // Calabresa está no carrinho; Quatro queijos está indisponível
    const strip = await openCart(["p-cala", "p-quatro", "p-agua"]);
    expect(within(strip).getAllByRole("button")).toHaveLength(1);
    within(strip).getByRole("button", { name: "Adicionar Água com gás" });
  });

  it("Escolher abre a tela do produto, e o voltar cai no carrinho", async () => {
    const strip = await openCart(["p-meio"]);
    fireEvent.click(within(strip).getByRole("button", { name: "Escolher Meio a meio" }));

    // tela do produto, com o grupo obrigatório
    await screen.findByText("Sabores");
    expect(screen.queryByText("Seu carrinho")).toBeNull();

    window.history.back();
    await screen.findByText("Seu carrinho");
    screen.getByRole("button", { name: "Escolher Meio a meio" });
  });
});
```

(`window.history.back()` seguido de `findBy…` é o mesmo jeito de `test/history.test.tsx`: o jsdom dispara o `popstate` de forma assíncrona.)

- [ ] **Step 2: Ver falhar**

Run: `pnpm --filter @menuclick/menu exec vitest run test/cart-suggestions.test.tsx`
Expected: FAIL — `CartSuggestion` não é exportado e nenhuma região "Que tal adicionar?" existe.

- [ ] **Step 3: A faixa no `CartScreen`**

Em `apps/menu/src/components/CartScreen.tsx`:

Exportar o tipo, acima do componente:

```tsx
/** Um cartão da faixa "Que tal adicionar?", já pronto para mostrar. */
export type CartSuggestion = {
  id: string;
  name: string;
  /** Já formatado, como na grade: "R$ 6,00" ou "a partir de R$ 75,00". */
  priceLabel: string;
  photoUrl?: string;
  /** Tem grupo obrigatório: o toque abre a tela do produto em vez de adicionar. */
  needsChoice: boolean;
};
```

Props novas (com padrão), depois de `hint`:

```tsx
  suggestions = [],
  onSuggestion = () => {},
```

e no tipo das props:

```tsx
  /** O que a loja marcou para oferecer, já filtrado pelo carrinho e pelo cardápio de agora. */
  suggestions?: CartSuggestion[];
  /** O toque num cartão; quem decide entre adicionar e abrir o produto é quem chama. */
  onSuggestion?: (productId: string) => void;
```

A faixa, entre o botão "+ Adicionar mais itens" e o `<dl>` do total (só no carrinho com itens — o vazio não muda):

```tsx
      {suggestions.length > 0 && (
        <section aria-labelledby="sugestoes-titulo" className="mt-5 border-t border-paper-3 pt-4">
          <h2 id="sugestoes-titulo" className="px-4 text-[15px] font-semibold tracking-[-0.01em]">
            Que tal adicionar?
          </h2>
          <ul className="mt-3 flex gap-3 overflow-x-auto px-4 pb-1">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="flex w-[132px] flex-none flex-col overflow-hidden rounded-card border border-paper-3">
                <div className="aspect-[4/3] w-full bg-paper-3">
                  {suggestion.photoUrl !== undefined && (
                    // largura da grade (400): já está no cache e não cria transformação nova
                    <img src={imageUrl(suggestion.photoUrl, 400)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 px-2.5 pb-2.5 pt-2">
                  <span className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{suggestion.name}</span>
                  <span className="text-xs tabular-nums text-ink-2">{suggestion.priceLabel}</span>
                  <button
                    type="button"
                    aria-label={`${suggestion.needsChoice ? "Escolher" : "Adicionar"} ${suggestion.name}`}
                    onClick={() => onSuggestion(suggestion.id)}
                    className="mt-auto min-h-11 rounded-field border border-action text-[13px] font-semibold text-action"
                  >
                    {suggestion.needsChoice ? "Escolher" : "Adicionar"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
```

(`<section>` com `aria-labelledby` é a região que os testes procuram por nome. Botão com 44 px de altura, como os outros alvos de toque do carrinho.)

- [ ] **Step 4: Ligar no `MenuApp`**

Em `apps/menu/src/components/MenuApp.tsx`:

Imports: `needsChoice`, `suggestionsFor` de `@/lib/suggestions.ts`; `fromPrice` de `@/lib/selection.ts`; `lineKey` de `@/lib/cart.ts` (junto dos que já vêm de lá); `formatCents` já é importado; o tipo `CartSuggestion` de `./CartScreen.tsx`.

Depois do `useMemo` de `photos`:

```tsx
  // "Que tal adicionar?": do cardápio de agora, sem o que já está no carrinho
  const suggestions = useMemo<CartSuggestion[]>(
    () =>
      suggestionsFor(products, lines).map((suggested) => {
        const price = fromPrice(suggested, menu.optionGroups);
        return {
          id: suggested.id,
          name: suggested.name,
          // `prefix` é "" ou "a partir de", sem espaço no fim
          priceLabel: [price.prefix, formatCents(price.cents)].filter(Boolean).join(" "),
          photoUrl: suggested.photoUrl,
          needsChoice: needsChoice(suggested, menu.optionGroups),
        };
      }),
    [products, lines, menu.optionGroups],
  );
```

Depois de `const back = …`:

```tsx
  // Sugestão do carrinho: entra com um toque quando não há o que escolher;
  // com grupo obrigatório, a tela do produto é que monta a linha — e o
  // `back()` dela devolve a pessoa ao carrinho, de onde ela veio.
  const pickSuggestion = (productId: string) => {
    const chosen = products.find((candidate) => candidate.id === productId);
    if (!chosen) return;
    if (needsChoice(chosen, menu.optionGroups)) {
      go("product", productId);
      return;
    }
    updateLines(
      addLine(lines, {
        key: lineKey(chosen.id, {}, null),
        productId: chosen.id,
        name: chosen.name,
        unitPriceInCents: chosen.priceInCents,
        quantity: 1,
        options: [],
        note: null,
      }),
    );
  };
```

E no `<CartScreen`, duas props:

```tsx
          suggestions={suggestions}
          onSuggestion={pickSuggestion}
```

⚠️ `go()` grava a altura do cardápio só quando `screen === "menu"`; saindo do carrinho ele não mexe em `menuScroll`, que é o certo.

- [ ] **Step 5: Ver passar e rodar tudo**

Run: `pnpm --filter @menuclick/menu exec vitest run test/cart-suggestions.test.tsx`
Expected: PASS, 8 testes.
Run: `pnpm --filter @menuclick/menu test`
Expected: PASS em tudo (inclusive `ssr.test.tsx` e `history.test.tsx`).
Run: `pnpm --filter @menuclick/menu build`
Expected: build verde, `/[slug]` continua `●` (ISR).

- [ ] **Step 6: Commit**

```bash
git add apps/menu
git commit -m "feat(menu): ✨ oferece as sugestões da loja no carrinho"
```

---

### Task 5: Documentação e conferência final

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: `CLAUDE.md`**

Na seção "Painel da loja", um item novo ao fim da lista:

```md
- **"Sugerir no carrinho" é interruptor do formulário do produto**, não um que salva sozinho: suja a `SaveBar` e sai no `POST`/`PATCH` como `isSuggested`. Sugerir produto esgotado ou sem foto é permitido — quem filtra é o app.
```

Na seção "App do cliente", um item novo depois do da miniatura do carrinho:

```md
- **O carrinho oferece "Que tal adicionar?"** com o que a loja marcou (`suggested` no cardápio público): a regra é `suggestionsFor()` em `lib/suggestions.ts` — sugerido, disponível, fora do carrinho, no máximo 6, na ordem do cardápio, sempre do **cardápio de agora**. O toque adiciona direto ("Adicionar"); com grupo obrigatório (`needsChoice`) o botão é "Escolher" e abre a tela do produto, cujo `back()` devolve ao carrinho. Sem sugestão sobrando, a faixa some.
```

No parágrafo do cardápio público que lista os campos fora do frete ("Fora do frete, o cardápio também traz…"), acrescentar ao fim: `` Cada produto traz `suggested` (a loja quer oferecê-lo no carrinho); o nome de gestão, `isSuggested`, não sai por ali.``

- [ ] **Step 2: Conferência do monorepo**

Run: `pnpm lint`
Expected: sem erro.
Run: `pnpm build`
Expected: verde nos quatro pacotes.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: 📝 documenta a venda sugestiva"
```
