# Painel da loja, parte 2b — Entrega e Grupos de opções — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao painel da loja as telas de Entrega (frete por bairro ou fixo, grátis acima de X, pedido mínimo, a combinar) e de Grupos de opções (CRUD de grupos e opções com as três regras de preço).

**Architecture:** Duas telas novas em `apps/panel`, cada uma com um módulo puro de regra (sem React, com os testes) e hooks do TanStack Query que gravam o cache no `onSuccess` do próprio hook. Entrega é um formulário com uma `SaveBar` que grava em dois recursos, bairros antes do restaurante; Grupos de opções edita na linha, e cada linha, cabeçalho e interruptor tem a sua própria mutação.

**Tech Stack:** Vite 8, React 19, Mantine 9, React Router 8, TanStack Query 5, TypeScript 7; testes em Vitest 4 + Testing Library 16 + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-21-painel-entrega-opcoes-parte-2b-design.md`

## Global Constraints

- Branch `feat/painel-entrega-opcoes`, empilhada na 2a (`feat/painel-configuracao`). A API (`apps/api`) **não muda**.
- **Nenhuma dependência nova.**
- **Cor só por `var(--mc-*)`**; hex só em `src/theme/tokens.ts`. Sem sombra, sem transição, sem animação. `.n` para números tabulares.
- **Copy do handoff é literal** (`docs/design/painel-da-loja/README.md` e `Painel da Loja.dc.html`); texto novo só onde a spec o registra.
- **Toda chamada passa por `apiRequest`** (`src/api/client.ts`).
- **Carregando/erro só quando `data === undefined`** — um refetch que falha mantém o `data` antigo, e trocar o formulário pela mensagem apagaria o que a pessoa digitava.
- **Uma instância de mutação por controle independente**, com a escrita no cache no `onSuccess`/`onSettled` **do hook**. Nunca callback por chamada (`mutate(x, { onSuccess })`): no `@tanstack/query-core` 5, `mutate()` desanexa o observer da mutação anterior e esses callbacks deixam de disparar. Quando a tela precisa agir depois do sucesso (fechar uma linha), use `await mutation.mutateAsync(...)` dentro de `try/catch`.
- Imports locais com extensão (`.ts`/`.tsx`); `import type` para tipos; sem `enum`.
- Textos para o usuário em pt-BR; identificadores em inglês.
- Comandos com o prefixo `unset -f node npm npx pnpm nvm 2>/dev/null;` (as funções do nvm recursam neste shell).
- Commits no padrão de `.claude/rules/commits.md`: `<tipo>(<escopo>): <emoji> <mensagem>`, pt-BR, presente, minúscula, sem ponto final.
- Verificação de cada task: `pnpm --filter @menuclick/panel test`, `pnpm lint`, `pnpm build` — todos verdes antes do commit. A suíte do painel parte de **225** testes.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/api/optionGroups.ts` (modificar) | chamadas de grupo e de opção |
| `src/api/delivery.ts` (modificar) | `putNeighborhoods` |
| `src/api/products.ts` (modificar) | `listAllProducts` (para contar uso de grupo) |
| `src/api/restaurant.ts` (modificar) | campos de entrega em `RestaurantPatch` |
| `src/features/settings/delivery.ts` (criar) | regra pura da tela de Entrega |
| `src/features/settings/useDelivery.ts` (criar) | query e mutação dos bairros |
| `src/features/settings/DeliveryPage.tsx` + `.module.css` (criar) | tela de Entrega |
| `src/features/optionGroups/optionGroups.ts` (criar) | regra pura de Grupos de opções |
| `src/features/optionGroups/useOptionGroups.ts` (criar) | queries e mutações de grupo e opção |
| `src/features/optionGroups/OptionGroupsPage.tsx` + `.module.css` (criar) | página, cartão de regras, lista |
| `src/features/optionGroups/GroupCard.tsx` (criar) | um grupo: cabeçalho, tabela, aviso |
| `src/features/optionGroups/GroupFields.tsx` (criar) | campos do grupo (novo e edição) |
| `src/features/optionGroups/OptionRow.tsx` (criar) | uma opção e a linha nova |
| `src/features/orders/OrdersNotices.tsx` (modificar) | "Configurar entrega" no `DeliveryAlert` |
| `src/features/settings/ModalitiesPage.tsx` (modificar) | links para `/entrega` |
| `src/features/products/ProductFormPage.tsx` (modificar) | link para `/grupos-de-opcoes` |
| `src/router.tsx`, `src/layout/Rail.tsx` (modificar) | rotas e itens do rail |

---

### Task 1: As chamadas de API da 2b

**Files:**
- Modify: `apps/panel/src/api/optionGroups.ts`
- Modify: `apps/panel/src/api/delivery.ts`
- Modify: `apps/panel/src/api/products.ts`
- Modify: `apps/panel/src/api/restaurant.ts`
- Test: `apps/panel/test/configuration-api.test.ts`

**Interfaces:**
- Consumes: `apiRequest`, `fetchAllPages`/`FetchAllResult`, `listProducts`, os tipos de `src/api/types.ts`.
- Produces:
  - `type OptionGroupBody = { name: string; minOptions: number; maxOptions: number; priceRule: PriceRule }`
  - `createOptionGroup(restaurantId: string, body: OptionGroupBody): Promise<OptionGroup>`
  - `updateOptionGroup(restaurantId: string, id: string, patch: Partial<OptionGroupBody>): Promise<OptionGroup>`
  - `deleteOptionGroup(restaurantId: string, id: string): Promise<void>`
  - `type OptionBody = { name: string; priceInCents: number; maxQuantity: number; available: boolean }`
  - `type NewOptionBody = Pick<OptionBody, "name" | "priceInCents" | "maxQuantity">`
  - `createOption(restaurantId: string, groupId: string, body: NewOptionBody): Promise<Option>`
  - `updateOption(restaurantId: string, groupId: string, id: string, patch: Partial<OptionBody>): Promise<Option>`
  - `deleteOption(restaurantId: string, groupId: string, id: string): Promise<void>`
  - `putNeighborhoods(restaurantId: string, neighborhoods: DeliveryNeighborhood[]): Promise<DeliveryNeighborhood[]>`
  - `listAllProducts(restaurantId: string): Promise<FetchAllResult<Product>>`
  - `RestaurantPatch` ganha `deliveryFeeMode: "neighborhood" | "fixed"`, `deliveryFixedFeeInCents: number`, `freeDeliveryAboveInCents: number | null`, `deliveryFeeToArrange: boolean`, `minimumOrderInCents: number`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/configuration-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { putNeighborhoods } from "../src/api/delivery.ts";
import {
  createOption,
  createOptionGroup,
  deleteOption,
  deleteOptionGroup,
  updateOption,
  updateOptionGroup,
} from "../src/api/optionGroups.ts";
import { listAllProducts } from "../src/api/products.ts";
import { updateRestaurant } from "../src/api/restaurant.ts";
import { mockApi } from "./api-mock.ts";
import { makeOptionGroup, makeProduct, makeRestaurant, RESTAURANT_ID } from "./fixtures.ts";

const BASE = `/restaurants/${RESTAURANT_ID}`;

describe("grupos de opções", () => {
  it("cria, edita e remove grupo", async () => {
    const api = mockApi([
      { method: "POST", path: `${BASE}/option-groups`, status: 201, body: makeOptionGroup() },
      { method: "PATCH", path: `${BASE}/option-groups/grp-1`, body: makeOptionGroup() },
      { method: "DELETE", path: `${BASE}/option-groups/grp-1`, status: 204 },
    ]);
    await createOptionGroup(RESTAURANT_ID, { name: "Borda", minOptions: 0, maxOptions: 1, priceRule: "sum" });
    await updateOptionGroup(RESTAURANT_ID, "grp-1", { name: "Bordas" });
    await deleteOptionGroup(RESTAURANT_ID, "grp-1");
    expect(api.calls.map((call) => [call.method, call.body])).toEqual([
      ["POST", { name: "Borda", minOptions: 0, maxOptions: 1, priceRule: "sum" }],
      ["PATCH", { name: "Bordas" }],
      ["DELETE", undefined],
    ]);
  });

  it("cria, edita e remove opção dentro do grupo", async () => {
    const option = { id: "opt-1", name: "Catupiry", priceInCents: 800, maxQuantity: 1, available: true, position: 0 };
    const api = mockApi([
      { method: "POST", path: `${BASE}/option-groups/grp-1/options`, status: 201, body: option },
      { method: "PATCH", path: `${BASE}/option-groups/grp-1/options/opt-1`, body: option },
      { method: "DELETE", path: `${BASE}/option-groups/grp-1/options/opt-1`, status: 204 },
    ]);
    await createOption(RESTAURANT_ID, "grp-1", { name: "Catupiry", priceInCents: 800, maxQuantity: 1 });
    await updateOption(RESTAURANT_ID, "grp-1", "opt-1", { available: false });
    await deleteOption(RESTAURANT_ID, "grp-1", "opt-1");
    expect(api.calls.map((call) => [call.method, call.path, call.body])).toEqual([
      ["POST", `${BASE}/option-groups/grp-1/options`, { name: "Catupiry", priceInCents: 800, maxQuantity: 1 }],
      ["PATCH", `${BASE}/option-groups/grp-1/options/opt-1`, { available: false }],
      ["DELETE", `${BASE}/option-groups/grp-1/options/opt-1`, undefined],
    ]);
  });
});

describe("entrega", () => {
  it("putNeighborhoods manda a lista inteira e devolve a lista salva", async () => {
    const saved = [{ name: "Centro", feeInCents: 500 }];
    const api = mockApi([
      { method: "PUT", path: `${BASE}/delivery-neighborhoods`, body: { neighborhoods: saved } },
    ]);
    const result = await putNeighborhoods(RESTAURANT_ID, saved);
    expect(api.calls[0].body).toEqual({ neighborhoods: saved });
    expect(result).toEqual(saved);
  });

  it("'grátis acima de' desligado vai como null no PATCH", async () => {
    const api = mockApi([{ method: "PATCH", path: BASE, body: makeRestaurant() }]);
    await updateRestaurant(RESTAURANT_ID, { freeDeliveryAboveInCents: null, deliveryFeeMode: "neighborhood" });
    expect(api.calls[0].body).toEqual({ freeDeliveryAboveInCents: null, deliveryFeeMode: "neighborhood" });
  });
});

describe("listAllProducts", () => {
  it("percorre as páginas até o total", async () => {
    const api = mockApi([
      {
        method: "GET",
        path: `${BASE}/products`,
        query: { offset: "0" },
        body: { data: [makeProduct({ id: "p1" })], limit: 100, offset: 0, total: 2 },
      },
      {
        method: "GET",
        path: `${BASE}/products`,
        query: { offset: "1" },
        body: { data: [makeProduct({ id: "p2" })], limit: 100, offset: 1, total: 2 },
      },
    ]);
    const result = await listAllProducts(RESTAURANT_ID);
    expect(result.items.map((product) => product.id)).toEqual(["p1", "p2"]);
    expect(result.truncated).toBe(false);
    expect(api.calls.every((call) => call.query.limit === "100")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/configuration-api.test.ts`
Expected: FAIL — `createOptionGroup`/`putNeighborhoods`/`listAllProducts` não existem (erro de import).

- [ ] **Step 3: Implementar**

Substitua `apps/panel/src/api/optionGroups.ts` por:

```ts
import { apiRequest } from "./client.ts";
import { fetchAllPages } from "./pagination.ts";
import type { Option, OptionGroup, Page, PriceRule } from "./types.ts";

export function listAllOptionGroups(restaurantId: string): Promise<OptionGroup[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<OptionGroup>>(`/restaurants/${restaurantId}/option-groups`, {
      query: { limit: 100, offset },
    }),
  ).then((result) => result.items);
}

export type OptionGroupBody = {
  name: string;
  minOptions: number;
  maxOptions: number;
  priceRule: PriceRule;
};

export function createOptionGroup(restaurantId: string, body: OptionGroupBody): Promise<OptionGroup> {
  return apiRequest<OptionGroup>(`/restaurants/${restaurantId}/option-groups`, { method: "POST", body });
}

export function updateOptionGroup(
  restaurantId: string,
  id: string,
  patch: Partial<OptionGroupBody>,
): Promise<OptionGroup> {
  return apiRequest<OptionGroup>(`/restaurants/${restaurantId}/option-groups/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

/**
 * A API remove o grupo, as opções dele E o vínculo com todo produto que o
 * usava, na mesma transação e sem avisar — por isso a tela confirma dizendo
 * quantos produtos perdem o grupo.
 */
export function deleteOptionGroup(restaurantId: string, id: string): Promise<void> {
  return apiRequest<void>(`/restaurants/${restaurantId}/option-groups/${id}`, { method: "DELETE" });
}

export type OptionBody = {
  name: string;
  priceInCents: number;
  maxQuantity: number;
  available: boolean;
};

/** Opção nasce disponível: o `available` só se mexe depois, pelo interruptor. */
export type NewOptionBody = Pick<OptionBody, "name" | "priceInCents" | "maxQuantity">;

function optionsPath(restaurantId: string, groupId: string): string {
  return `/restaurants/${restaurantId}/option-groups/${groupId}/options`;
}

export function createOption(restaurantId: string, groupId: string, body: NewOptionBody): Promise<Option> {
  return apiRequest<Option>(optionsPath(restaurantId, groupId), { method: "POST", body });
}

export function updateOption(
  restaurantId: string,
  groupId: string,
  id: string,
  patch: Partial<OptionBody>,
): Promise<Option> {
  return apiRequest<Option>(`${optionsPath(restaurantId, groupId)}/${id}`, { method: "PATCH", body: patch });
}

export function deleteOption(restaurantId: string, groupId: string, id: string): Promise<void> {
  return apiRequest<void>(`${optionsPath(restaurantId, groupId)}/${id}`, { method: "DELETE" });
}
```

Em `apps/panel/src/api/delivery.ts`, acrescente ao fim:

```ts
/**
 * Substitui a lista inteira: bairro que não vier some. Lista vazia é válida
 * e limpa a configuração — o que, no modo por bairro, faz a loja recusar
 * entrega (não é frete grátis).
 */
export async function putNeighborhoods(
  restaurantId: string,
  neighborhoods: DeliveryNeighborhood[],
): Promise<DeliveryNeighborhood[]> {
  const result = await apiRequest<{ neighborhoods: DeliveryNeighborhood[] }>(
    `/restaurants/${restaurantId}/delivery-neighborhoods`,
    { method: "PUT", body: { neighborhoods } },
  );
  return result.neighborhoods;
}
```

Em `apps/panel/src/api/products.ts`, troque a primeira linha de imports por:

```ts
import { apiRequest } from "./client.ts";
import { type FetchAllResult, fetchAllPages } from "./pagination.ts";
import type { OptionGroup, Page, Product } from "./types.ts";
```

e acrescente logo depois de `listProducts`:

```ts
/**
 * Todos os produtos, para a conta que a API não faz: em quantos produtos
 * cada grupo de opções é usado. Até 20 páginas de 100 — acima disso a
 * contagem vem marcada como `truncated`, e a tela diz "pelo menos".
 */
export function listAllProducts(restaurantId: string): Promise<FetchAllResult<Product>> {
  return fetchAllPages((offset) => listProducts(restaurantId, { limit: 100, offset }), 20);
}
```

Em `apps/panel/src/api/restaurant.ts`, substitua o comentário e o tipo `RestaurantPatch` por:

```ts
/**
 * O que o painel edita no restaurante. O `slug` não está aqui porque a API
 * não o aceita: é a URL dentro do QR code impresso. `deliveryFeeMode` só
 * aceita os dois modos que a API deixa escolher (`distance` ainda não tem
 * como calcular nada). `freeDeliveryAboveInCents: null` DESLIGA a promoção —
 * zero seria "grátis acima de R$ 0", sempre grátis.
 */
export type RestaurantPatch = Partial<{
  name: string;
  cuisineType: string;
  logoUrl: string;
  address: Address;
  isDelivery: boolean;
  isTakeaway: boolean;
  isQrcode: boolean;
  timezone: string;
  acceptingOrders: boolean;
  acceptsCash: boolean;
  acceptsCardOnDelivery: boolean;
  acceptsPix: boolean;
  acceptsMealVoucher: boolean;
  deliveryFeeMode: "neighborhood" | "fixed";
  deliveryFixedFeeInCents: number;
  freeDeliveryAboveInCents: number | null;
  deliveryFeeToArrange: boolean;
  minimumOrderInCents: number;
}>;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/configuration-api.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src/api apps/panel/test/configuration-api.test.ts
git commit -m "feat(panel): ✨ adiciona as chamadas de entrega e de grupos de opções"
```

---

### Task 2: A regra da tela de Entrega, em forma pura

**Files:**
- Create: `apps/panel/src/features/settings/delivery.ts`
- Test: `apps/panel/test/delivery.test.ts`

**Interfaces:**
- Consumes: `RestaurantPatch` (Task 1), `parseReaisToCents`/`centsToInput` de `src/lib/money.ts`, `DeliveryFeeMode`/`DeliveryNeighborhood`/`Restaurant` de `src/api/types.ts`.
- Produces:
  - `normalizeNeighborhood(name: string): string`
  - `addNeighborhood(list: readonly DeliveryNeighborhood[], name: string, feeText: string): { list: DeliveryNeighborhood[] } | { error: string }`
  - `neighborhoodsChanged(a: readonly DeliveryNeighborhood[], b: readonly DeliveryNeighborhood[]): boolean`
  - `neighborhoodCountLabel(count: number): string`
  - `type DeliveryForm = { mode: DeliveryFeeMode; fixedFee: string; freeAbove: string; minimumOrder: string; toArrange: boolean }`
  - `fromRestaurant(restaurant: Restaurant): DeliveryForm`
  - `validateDeliveryForm(form: DeliveryForm): string | null`
  - `changedDeliveryPatch(form: DeliveryForm, restaurant: Restaurant): RestaurantPatch`
  - `isDeliveryDirty(form: DeliveryForm, restaurant: Restaurant, listChanged: boolean): boolean`
  - `DELIVERY_MODES: readonly { value: DeliveryFeeMode; label: string; help: string; disabled: boolean }[]`
  - `toArrangeHelp(on: boolean): string`

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/delivery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addNeighborhood,
  changedDeliveryPatch,
  DELIVERY_MODES,
  fromRestaurant,
  isDeliveryDirty,
  neighborhoodCountLabel,
  neighborhoodsChanged,
  normalizeNeighborhood,
  toArrangeHelp,
  validateDeliveryForm,
} from "../src/features/settings/delivery.ts";
import { makeRestaurant } from "./fixtures.ts";

describe("normalizeNeighborhood", () => {
  it("é a mesma chave da API: sem acento, sem caixa, sem espaço sobrando", () => {
    expect(normalizeNeighborhood("  Jardim   América ")).toBe("jardim america");
    expect(normalizeNeighborhood("Centro")).toBe(normalizeNeighborhood("centro "));
  });
});

describe("addNeighborhood", () => {
  const list = [{ name: "Vila Madalena", feeInCents: 800 }];

  it("acrescenta com o nome aparado e o frete em centavos", () => {
    expect(addNeighborhood(list, "  Pinheiros ", "7,50")).toEqual({
      list: [...list, { name: "Pinheiros", feeInCents: 750 }],
    });
  });

  it("frete zero é permitido: entrega grátis naquele bairro", () => {
    expect(addNeighborhood([], "Centro", "0")).toEqual({ list: [{ name: "Centro", feeInCents: 0 }] });
  });

  it("barra o repetido pela mesma comparação da API", () => {
    expect(addNeighborhood(list, "vila madalena ", "5,00")).toEqual({
      error: 'O bairro "vila madalena" já está na lista.',
    });
  });

  it("barra nome vazio e frete ilegível", () => {
    expect(addNeighborhood(list, "   ", "5,00")).toEqual({ error: "Informe o nome do bairro." });
    expect(addNeighborhood(list, "Centro", "cinco")).toEqual({
      error: "Informe o frete em reais, como 8,50 — ou 0 para entrega grátis.",
    });
  });
});

describe("neighborhoodsChanged", () => {
  it("não depende de ordem", () => {
    const a = [{ name: "Centro", feeInCents: 500 }, { name: "Pinheiros", feeInCents: 700 }];
    expect(neighborhoodsChanged(a, [...a].reverse())).toBe(false);
  });

  it("percebe frete, nome e tamanho diferentes", () => {
    const a = [{ name: "Centro", feeInCents: 500 }];
    expect(neighborhoodsChanged(a, [{ name: "Centro", feeInCents: 600 }])).toBe(true);
    expect(neighborhoodsChanged(a, [{ name: "centro", feeInCents: 500 }])).toBe(true);
    expect(neighborhoodsChanged(a, [])).toBe(true);
  });
});

describe("o formulário de entrega", () => {
  it("nasce do restaurante, com 'grátis acima de' vazio quando a promoção está desligada", () => {
    expect(fromRestaurant(makeRestaurant({ deliveryFixedFeeInCents: 900, minimumOrderInCents: 3000 }))).toEqual({
      mode: "fixed",
      fixedFee: "9,00",
      freeAbove: "",
      minimumOrder: "30,00",
      toArrange: false,
    });
    expect(fromRestaurant(makeRestaurant({ freeDeliveryAboveInCents: 5000 })).freeAbove).toBe("50,00");
  });

  it("sem mudança nenhuma, o PATCH sai vazio e a tela está limpa", () => {
    const restaurant = makeRestaurant();
    const form = fromRestaurant(restaurant);
    expect(changedDeliveryPatch(form, restaurant)).toEqual({});
    expect(isDeliveryDirty(form, restaurant, false)).toBe(false);
    expect(isDeliveryDirty(form, restaurant, true)).toBe(true);
  });

  it("o PATCH leva só o que mudou", () => {
    const restaurant = makeRestaurant();
    const form = { ...fromRestaurant(restaurant), mode: "neighborhood" as const, minimumOrder: "30,00" };
    expect(changedDeliveryPatch(form, restaurant)).toEqual({
      deliveryFeeMode: "neighborhood",
      minimumOrderInCents: 3000,
    });
  });

  it("'grátis acima de' esvaziado vai como null, nunca 0", () => {
    const restaurant = makeRestaurant({ freeDeliveryAboveInCents: 5000 });
    const form = { ...fromRestaurant(restaurant), freeAbove: "  " };
    expect(changedDeliveryPatch(form, restaurant)).toEqual({ freeDeliveryAboveInCents: null });
  });

  it("'8,5' e '8,50' são o mesmo valor", () => {
    const restaurant = makeRestaurant({ deliveryFixedFeeInCents: 850 });
    const form = { ...fromRestaurant(restaurant), fixedFee: "8,5" };
    expect(changedDeliveryPatch(form, restaurant)).toEqual({});
  });

  it("valida os valores em reais; a taxa fixa só no modo fixo", () => {
    const form = fromRestaurant(makeRestaurant());
    expect(validateDeliveryForm(form)).toBeNull();
    expect(validateDeliveryForm({ ...form, fixedFee: "abc" })).toBe("Informe a taxa fixa em reais, como 8,50.");
    expect(validateDeliveryForm({ ...form, mode: "neighborhood", fixedFee: "abc" })).toBeNull();
    expect(validateDeliveryForm({ ...form, freeAbove: "muito" })).toBe(
      "Informe o valor da entrega grátis em reais, como 50,00 — ou deixe em branco.",
    );
    expect(validateDeliveryForm({ ...form, minimumOrder: "" })).toBe(
      "Informe o pedido mínimo em reais, como 30,00 — ou 0 para sem mínimo.",
    );
  });

  it("texto inválido deixa a tela suja, para o Salvar mostrar o erro", () => {
    const restaurant = makeRestaurant();
    expect(isDeliveryDirty({ ...fromRestaurant(restaurant), minimumOrder: "x" }, restaurant, false)).toBe(true);
  });
});

describe("copy", () => {
  it("contagem de bairros no singular e no plural", () => {
    expect(neighborhoodCountLabel(1)).toBe("1 bairro");
    expect(neighborhoodCountLabel(3)).toBe("3 bairros");
  });

  it("por distância vem desabilitado", () => {
    expect(DELIVERY_MODES.map((mode) => [mode.label, mode.disabled])).toEqual([
      ["Por bairro", false],
      ["Taxa fixa", false],
      ["Por distância", true],
    ]);
  });

  it("a ajuda do 'a combinar' muda com o estado", () => {
    expect(toArrangeHelp(true)).toContain("o pedido entra com");
    expect(toArrangeHelp(false)).toContain("é recusado na hora");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/delivery.test.ts`
Expected: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar**

Crie `apps/panel/src/features/settings/delivery.ts`:

```ts
import type { RestaurantPatch } from "../../api/restaurant.ts";
import type { DeliveryFeeMode, DeliveryNeighborhood, Restaurant } from "../../api/types.ts";
import { centsToInput, parseReaisToCents } from "../../lib/money.ts";

/**
 * A chave de igualdade de um bairro — a MESMA de `normalizeNeighborhood` em
 * `apps/api/src/domain/delivery.ts`: sem acento, sem caixa, sem espaço
 * sobrando. Se as duas divergirem, a tela deixa passar um repetido que a API
 * recusa com 409, ou barra um que ela aceitaria.
 */
export function normalizeNeighborhood(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function addNeighborhood(
  list: readonly DeliveryNeighborhood[],
  name: string,
  feeText: string,
): { list: DeliveryNeighborhood[] } | { error: string } {
  const trimmed = name.trim();
  const key = normalizeNeighborhood(trimmed);
  if (key === "") return { error: "Informe o nome do bairro." };
  const feeInCents = parseReaisToCents(feeText);
  if (feeInCents === null) return { error: "Informe o frete em reais, como 8,50 — ou 0 para entrega grátis." };
  if (list.some((item) => normalizeNeighborhood(item.name) === key)) {
    return { error: `O bairro "${trimmed}" já está na lista.` };
  }
  return { list: [...list, { name: trimmed, feeInCents }] };
}

function sortedForCompare(list: readonly DeliveryNeighborhood[]): string[] {
  return list
    .map((item) => `${normalizeNeighborhood(item.name)}\u0000${item.name}\u0000${item.feeInCents}`)
    .sort();
}

/** A API devolve a lista na ordem dela: comparar em ordem deixaria a tela suja depois de salvar. */
export function neighborhoodsChanged(
  a: readonly DeliveryNeighborhood[],
  b: readonly DeliveryNeighborhood[],
): boolean {
  if (a.length !== b.length) return true;
  const left = sortedForCompare(a);
  const right = sortedForCompare(b);
  return left.some((value, index) => value !== right[index]);
}

export function neighborhoodCountLabel(count: number): string {
  return count === 1 ? "1 bairro" : `${count} bairros`;
}

export type DeliveryForm = {
  mode: DeliveryFeeMode;
  fixedFee: string;
  /** Vazio = promoção desligada (vai como `null`). */
  freeAbove: string;
  minimumOrder: string;
  toArrange: boolean;
};

export function fromRestaurant(restaurant: Restaurant): DeliveryForm {
  return {
    mode: restaurant.deliveryFeeMode,
    fixedFee: centsToInput(restaurant.deliveryFixedFeeInCents),
    freeAbove:
      restaurant.freeDeliveryAboveInCents === undefined ? "" : centsToInput(restaurant.freeDeliveryAboveInCents),
    minimumOrder: centsToInput(restaurant.minimumOrderInCents),
    toArrange: restaurant.deliveryFeeToArrange,
  };
}

export function validateDeliveryForm(form: DeliveryForm): string | null {
  if (form.mode === "fixed" && parseReaisToCents(form.fixedFee) === null) {
    return "Informe a taxa fixa em reais, como 8,50.";
  }
  if (form.freeAbove.trim() !== "" && parseReaisToCents(form.freeAbove) === null) {
    return "Informe o valor da entrega grátis em reais, como 50,00 — ou deixe em branco.";
  }
  if (parseReaisToCents(form.minimumOrder) === null) {
    return "Informe o pedido mínimo em reais, como 30,00 — ou 0 para sem mínimo.";
  }
  return null;
}

/**
 * Só o que mudou, comparado com o cache. Texto que não é valor (que a
 * validação barra antes do salvar) fica de fora — nunca vira "0" por engano.
 */
export function changedDeliveryPatch(form: DeliveryForm, restaurant: Restaurant): RestaurantPatch {
  const patch: RestaurantPatch = {};
  if (form.mode !== restaurant.deliveryFeeMode && form.mode !== "distance") {
    patch.deliveryFeeMode = form.mode;
  }
  const fixed = parseReaisToCents(form.fixedFee);
  if (fixed !== null && fixed !== restaurant.deliveryFixedFeeInCents) {
    patch.deliveryFixedFeeInCents = fixed;
  }
  // Vazio DESLIGA: `null`, nunca 0 — zero seria "grátis acima de R$ 0".
  const savedFree = restaurant.freeDeliveryAboveInCents ?? null;
  const blank = form.freeAbove.trim() === "";
  const free = blank ? null : parseReaisToCents(form.freeAbove);
  if ((blank || free !== null) && free !== savedFree) {
    patch.freeDeliveryAboveInCents = free;
  }
  const minimum = parseReaisToCents(form.minimumOrder);
  if (minimum !== null && minimum !== restaurant.minimumOrderInCents) {
    patch.minimumOrderInCents = minimum;
  }
  if (form.toArrange !== restaurant.deliveryFeeToArrange) {
    patch.deliveryFeeToArrange = form.toArrange;
  }
  return patch;
}

export function isDeliveryDirty(form: DeliveryForm, restaurant: Restaurant, listChanged: boolean): boolean {
  return (
    listChanged ||
    validateDeliveryForm(form) !== null ||
    Object.keys(changedDeliveryPatch(form, restaurant)).length > 0
  );
}

/** Texto literal do protótipo do handoff. */
export const DELIVERY_MODES: readonly { value: DeliveryFeeMode; label: string; help: string; disabled: boolean }[] = [
  { value: "neighborhood", label: "Por bairro", help: "Uma lista de bairros, cada um com o seu preço", disabled: false },
  { value: "fixed", label: "Taxa fixa", help: "Um valor só para toda a área atendida", disabled: false },
  { value: "distance", label: "Por distância", help: "Ainda não disponível nesta versão", disabled: true },
];

export function toArrangeHelp(on: boolean): string {
  return on
    ? 'Quando o frete não pode ser calculado, o pedido entra com "frete a combinar" e o valor é acertado por telefone. O total do pedido chega sem o frete.'
    : "Quando o frete não pode ser calculado, o pedido de entrega é recusado na hora. Nenhum pedido entra com valor em aberto.";
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/delivery.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src/features/settings/delivery.ts apps/panel/test/delivery.test.ts
git commit -m "feat(panel): ✨ adiciona a regra da tela de entrega"
```

---

### Task 3: A tela de Entrega

**Files:**
- Create: `apps/panel/src/features/settings/useDelivery.ts`
- Create: `apps/panel/src/features/settings/DeliveryPage.tsx`
- Create: `apps/panel/src/features/settings/DeliveryPage.module.css`
- Modify: `apps/panel/src/router.tsx`, `apps/panel/src/layout/Rail.tsx`
- Modify: `apps/panel/src/features/orders/OrdersNotices.tsx` (o botão "Configurar entrega" e a prop `withAction`)
- Test: `apps/panel/test/delivery-page.test.tsx`

**Interfaces:**
- Consumes: tudo de `delivery.ts` (Task 2); `listNeighborhoods`/`putNeighborhoods` (Task 1); `useRestaurant`, `useUpdateRestaurant`; `useDeliveryAlert`; `DeliveryAlert`; `SaveBar`.
- Produces:
  - `neighborhoodsQueryKey(restaurantId: string): readonly ["delivery-neighborhoods", string]`
  - `useNeighborhoods(restaurantId: string)`, `useSaveNeighborhoods(restaurantId: string)`
  - `DeliveryPage` na rota `/entrega` (título "Entrega")
  - `DeliveryAlert({ withAction?: boolean })` — com o botão "Configurar entrega" para `/entrega`; a tela de Entrega passa `withAction={false}`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/delivery-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeliveryPage } from "../src/features/settings/DeliveryPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeRestaurant, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";
import type { DeliveryNeighborhood, Restaurant } from "../src/api/types.ts";

const RESTAURANT = `/restaurants/${RESTAURANT_ID}`;
const NEIGHBORHOODS = `${RESTAURANT}/delivery-neighborhoods`;
const routes = [{ path: "/entrega", element: <DeliveryPage /> }];

function setup(
  extra: MockHandler[],
  { restaurant = {}, neighborhoods = [] }: { restaurant?: Partial<Restaurant>; neighborhoods?: DeliveryNeighborhood[] } = {},
) {
  signIn();
  const api = mockApi([
    ...extra,
    { method: "GET", path: NEIGHBORHOODS, body: { neighborhoods } },
    ...panelHandlers({ restaurant }),
  ]);
  renderInPanel(routes, "/entrega");
  return api;
}

function addBairro(name: string, fee: string) {
  fireEvent.change(screen.getByLabelText("Novo bairro"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Frete do novo bairro"), { target: { value: fee } });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar bairro" }));
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Salvar entrega" }));
}

describe("DeliveryPage", () => {
  it("salva os bairros antes do restaurante", async () => {
    const saved = [
      { name: "Centro", feeInCents: 500 },
      { name: "Vila Madalena", feeInCents: 800 },
    ];
    const api = setup([
      { method: "PUT", path: NEIGHBORHOODS, body: { neighborhoods: saved } },
      { method: "PATCH", path: RESTAURANT, body: makeRestaurant({ deliveryFeeMode: "neighborhood" }) },
    ]);
    fireEvent.click(await screen.findByRole("radio", { name: "Por bairro" }));
    addBairro("Centro", "5,00");
    addBairro("Vila Madalena", "8,00");
    save();
    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    const put = api.calls.findIndex((call) => call.method === "PUT");
    const patch = api.calls.findIndex((call) => call.method === "PATCH");
    expect(put).toBeGreaterThanOrEqual(0);
    expect(put).toBeLessThan(patch);
    expect(api.calls[put].body).toEqual({ neighborhoods: saved });
    expect(api.calls[patch].body).toEqual({ deliveryFeeMode: "neighborhood" });
  });

  it("PATCH que falha deixa os bairros salvos e a barra suja só no que faltou", async () => {
    const api = setup([
      { method: "PUT", path: NEIGHBORHOODS, body: { neighborhoods: [{ name: "Centro", feeInCents: 500 }] } },
      { method: "PATCH", path: RESTAURANT, status: 500, body: { message: "Algo deu errado no servidor" } },
    ]);
    fireEvent.click(await screen.findByRole("radio", { name: "Por bairro" }));
    addBairro("Centro", "5,00");
    save();
    expect(await screen.findByText("Algo deu errado no servidor")).toBeTruthy();
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();

    save();
    await waitFor(() => expect(api.calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    expect(api.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("bairro repetido é barrado antes de qualquer chamada", async () => {
    const api = setup([], {
      restaurant: { deliveryFeeMode: "neighborhood" },
      neighborhoods: [{ name: "Vila Madalena", feeInCents: 800 }],
    });
    await screen.findByText("Vila Madalena");
    addBairro("vila madalena ", "5,00");
    expect(await screen.findByText('O bairro "vila madalena" já está na lista.')).toBeTruthy();
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(api.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("por distância aparece desabilitado", async () => {
    setup([]);
    const distance = (await screen.findByRole("radio", { name: "Por distância" })) as HTMLInputElement;
    expect(distance.disabled).toBe(true);
  });

  it("o aviso do topo segue o que está salvo, não o que está sendo digitado", async () => {
    setup([], { restaurant: { deliveryFeeMode: "neighborhood" }, neighborhoods: [] });
    expect(await screen.findByText("Entrega por bairro sem nenhum bairro cadastrado")).toBeTruthy();
    addBairro("Centro", "5,00");
    expect(screen.getByText("Entrega por bairro sem nenhum bairro cadastrado")).toBeTruthy();
  });

  it("escolher 'por bairro' sem salvar não liga o aviso do topo", async () => {
    setup([], { restaurant: { deliveryFeeMode: "fixed" }, neighborhoods: [] });
    fireEvent.click(await screen.findByRole("radio", { name: "Por bairro" }));
    expect(screen.getByText("Nenhum bairro cadastrado")).toBeTruthy();
    expect(screen.queryByText("Entrega por bairro sem nenhum bairro cadastrado")).toBeNull();
  });

  it("a ajuda do 'a combinar' troca com o interruptor", async () => {
    setup([], { restaurant: { deliveryFeeToArrange: false } });
    expect(await screen.findByText(/é recusado na hora/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Aceitar pedido com frete a combinar" }));
    expect(screen.getByText(/o valor é acertado por telefone/)).toBeTruthy();
  });

  it("esvaziar 'grátis acima de' manda null", async () => {
    const api = setup(
      [{ method: "PATCH", path: RESTAURANT, body: makeRestaurant() }],
      { restaurant: { freeDeliveryAboveInCents: 5000 } },
    );
    fireEvent.change(await screen.findByLabelText("Entrega grátis acima de"), { target: { value: "" } });
    save();
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ freeDeliveryAboveInCents: null }),
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/delivery-page.test.tsx`
Expected: FAIL — `DeliveryPage` não existe.

- [ ] **Step 3: Os hooks dos bairros**

Crie `apps/panel/src/features/settings/useDelivery.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listNeighborhoods, putNeighborhoods } from "../../api/delivery.ts";
import type { DeliveryNeighborhood } from "../../api/types.ts";

/**
 * A MESMA chave do `useDeliveryAlert` (`features/orders/useOrders.ts`):
 * salvar os bairros aqui atualiza sozinho o aviso do kanban e o de
 * Modalidades.
 */
export function neighborhoodsQueryKey(restaurantId: string) {
  return ["delivery-neighborhoods", restaurantId] as const;
}

export function useNeighborhoods(restaurantId: string) {
  return useQuery({
    queryKey: neighborhoodsQueryKey(restaurantId),
    queryFn: () => listNeighborhoods(restaurantId),
  });
}

export function useSaveNeighborhoods(restaurantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (neighborhoods: DeliveryNeighborhood[]) => putNeighborhoods(restaurantId, neighborhoods),
    onSuccess: (saved) => queryClient.setQueryData(neighborhoodsQueryKey(restaurantId), saved),
  });
}
```

- [ ] **Step 4: O botão do `DeliveryAlert`**

Em `apps/panel/src/features/orders/OrdersNotices.tsx`, acrescente `import { Link } from "react-router";` e substitua o componente `DeliveryAlert` por:

```tsx
/**
 * O botão "Configurar entrega" do handoff, adiado na parte 1 até a tela de
 * Entrega existir. `withAction={false}` só na própria tela de Entrega: lá ele
 * apontaria para a tela em que a pessoa já está.
 */
export function DeliveryAlert({ withAction = true }: { withAction?: boolean }) {
  return (
    <div className={classes.notice}>
      <Notice tone="warn" title="Entrega por bairro sem nenhum bairro cadastrado">
        <div className={classes.noticeRow}>
          <span>
            Não é frete grátis: a loja não consegue calcular o frete e vai recusar pedidos de entrega.
            Cadastre os bairros ou mude para taxa fixa.
          </span>
          {withAction && (
            <Button component={Link} to="/entrega" variant="default">
              Configurar entrega
            </Button>
          )}
        </div>
      </Notice>
    </div>
  );
}
```

O texto continua inteiro num nó só (o `<span>`), então os testes que já o procuram seguem achando.

- [ ] **Step 5: A tela**

Crie `apps/panel/src/features/settings/DeliveryPage.module.css`:

```css
.page {
  display: grid;
  gap: 16px;
  max-width: 880px;
  padding: 18px 20px 0;
}

.card {
  display: grid;
  gap: 14px;
  padding: 18px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.cardHead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.cardTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.count {
  font-size: 13px;
  color: var(--mc-ink3);
}

.modes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
}

.mode {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px 10px;
  align-items: center;
  min-height: 78px;
  padding: 12px 14px;
  border: 1px solid var(--mc-line);
  border-radius: 8px;
  background: var(--mc-surface);
  cursor: pointer;
}

.mode:hover {
  background: var(--mc-surface3);
}

.selected,
.selected:hover {
  background: var(--mc-accent-soft);
  border-color: var(--mc-accent-line);
}

.disabledMode,
.disabledMode:hover {
  background: var(--mc-surface2);
  border-color: var(--mc-line);
  cursor: not-allowed;
  color: var(--mc-ink3);
}

.radio {
  grid-row: span 2;
  accent-color: var(--mc-accent);
}

.modeLabel {
  font-size: 14px;
  font-weight: 600;
}

.modeHelp {
  font-size: 12.5px;
  color: var(--mc-ink2);
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--mc-line);
  border-radius: 8px;
  overflow: hidden;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) 130px 90px;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--mc-line);
}

.row:last-child {
  border-bottom: 0;
}

.name {
  min-width: 0;
  font-size: 14px;
}

.fee {
  font-size: 14px;
  text-align: right;
}

.empty {
  display: grid;
  gap: 4px;
  justify-items: center;
  padding: 20px 12px;
  text-align: center;
}

.emptyTitle {
  color: var(--mc-warn);
  font-size: 14px;
}

.emptyBody {
  margin: 0;
  max-width: 60ch;
  font-size: 13px;
  color: var(--mc-ink2);
}

.addRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px auto;
  gap: 8px;
  padding: 10px;
  background: var(--mc-surface2);
  border-radius: 8px;
}

.fixed {
  max-width: 320px;
}

.rules {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}

.error {
  margin: 0;
  font-size: 12.5px;
  color: var(--mc-danger);
}

.loading {
  padding: 18px 20px;
  color: var(--mc-ink2);
}
```

Crie `apps/panel/src/features/settings/DeliveryPage.tsx`:

```tsx
import { Button, Switch, TextInput } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { DeliveryNeighborhood, Restaurant } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { formatCents } from "../../lib/money.ts";
import buttons from "../../ui/buttons.module.css";
import { SaveBar } from "../../ui/SaveBar.tsx";
import { DeliveryAlert } from "../orders/OrdersNotices.tsx";
import { useDeliveryAlert } from "../orders/useOrders.ts";
import { useRestaurant, useUpdateRestaurant } from "../restaurant/useRestaurant.ts";
import {
  addNeighborhood,
  changedDeliveryPatch,
  DELIVERY_MODES,
  type DeliveryForm,
  fromRestaurant,
  isDeliveryDirty,
  neighborhoodCountLabel,
  neighborhoodsChanged,
  toArrangeHelp,
  validateDeliveryForm,
} from "./delivery.ts";
import classes from "./DeliveryPage.module.css";
import { useNeighborhoods, useSaveNeighborhoods } from "./useDelivery.ts";

/**
 * `restaurant` e `saved` são o CACHE, relidos a cada render: é contra eles
 * que a sujeira é medida. Por isso um PATCH que falha depois de um PUT que
 * deu certo deixa a barra suja só no que faltou, sem estado extra.
 */
function DeliveryEditor({
  restaurant,
  saved,
}: {
  restaurant: Restaurant;
  saved: readonly DeliveryNeighborhood[];
}) {
  const [form, setForm] = useState<DeliveryForm>(() => fromRestaurant(restaurant));
  const [list, setList] = useState<DeliveryNeighborhood[]>(() => [...saved]);
  const [newName, setNewName] = useState("");
  const [newFee, setNewFee] = useState("");
  const [addProblem, setAddProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const saveList = useSaveNeighborhoods(restaurant.id);
  const update = useUpdateRestaurant(restaurant.id);
  // O aviso do topo lê o SALVO (`restaurant` e a query dos bairros), não o
  // formulário: ele diz o que o servidor está fazendo agora.
  const alert = useDeliveryAlert(restaurant.id, restaurant);

  const listChanged = neighborhoodsChanged(list, saved);
  const dirty = isDeliveryDirty(form, restaurant, listChanged);

  const set = <K extends keyof DeliveryForm>(key: K, value: DeliveryForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const add = () => {
    const result = addNeighborhood(list, newName, newFee);
    if ("error" in result) {
      setAddProblem(result.error);
      return;
    }
    setList(result.list);
    setNewName("");
    setNewFee("");
    setAddProblem(null);
  };

  const submit = async () => {
    const found = validateDeliveryForm(form);
    setProblem(found);
    if (found !== null) return;
    try {
      // Bairros ANTES do restaurante: trocar para "por bairro" antes de a
      // lista existir faria a loja recusar entrega por um instante.
      if (listChanged) await saveList.mutateAsync(list);
      const patch = changedDeliveryPatch(form, restaurant);
      if (Object.keys(patch).length > 0) await update.mutateAsync(patch);
    } catch {
      // A mensagem sai de `saveList.error`/`update.error`. O que deu certo já
      // está no cache, e a barra continua suja só no que faltou.
    }
  };

  const cancel = () => {
    setForm(fromRestaurant(restaurant));
    setList([...saved]);
    setNewName("");
    setNewFee("");
    setAddProblem(null);
    setProblem(null);
    saveList.reset();
    update.reset();
  };

  return (
    <>
      <div className={classes.page}>
        {alert && <DeliveryAlert withAction={false} />}

        <section className={classes.card}>
          <h2 className={classes.cardTitle}>Como o frete é calculado</h2>
          <div className={classes.modes} role="radiogroup" aria-label="Como o frete é calculado">
            {DELIVERY_MODES.map((mode) => {
              const selected = form.mode === mode.value;
              const className = [
                classes.mode,
                selected ? classes.selected : "",
                mode.disabled ? classes.disabledMode : "",
              ].join(" ");
              return (
                <label key={mode.value} className={className}>
                  <input
                    type="radio"
                    name="delivery-mode"
                    className={classes.radio}
                    aria-label={mode.label}
                    value={mode.value}
                    checked={selected}
                    disabled={mode.disabled}
                    onChange={() => set("mode", mode.value)}
                  />
                  <span className={classes.modeLabel}>{mode.label}</span>
                  <span className={classes.modeHelp}>{mode.help}</span>
                </label>
              );
            })}
          </div>
        </section>

        {form.mode === "neighborhood" && (
          <section className={classes.card}>
            <div className={classes.cardHead}>
              <h2 className={classes.cardTitle}>Bairros atendidos</h2>
              <span className={`${classes.count} n`}>{neighborhoodCountLabel(list.length)}</span>
            </div>
            {list.length === 0 ? (
              <div className={classes.empty}>
                <strong className={classes.emptyTitle}>Nenhum bairro cadastrado</strong>
                <p className={classes.emptyBody}>
                  Neste estado a loja não consegue calcular frete nenhum e recusa os pedidos de entrega.
                  Isto não é entrega grátis.
                </p>
              </div>
            ) : (
              <ul className={classes.list}>
                {list.map((item) => (
                  <li key={item.name} className={classes.row}>
                    <span className={classes.name}>{item.name}</span>
                    <span className={`${classes.fee} n`}>{formatCents(item.feeInCents)}</span>
                    <Button
                      variant="subtle"
                      className={buttons.dangerText}
                      aria-label={`Remover ${item.name}`}
                      onClick={() => setList(list.filter((other) => other !== item))}
                    >
                      Remover
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className={classes.addRow}>
              <TextInput
                aria-label="Novo bairro"
                placeholder="Bairro"
                value={newName}
                onChange={(event) => setNewName(event.currentTarget.value)}
              />
              <TextInput
                aria-label="Frete do novo bairro"
                placeholder="0,00"
                value={newFee}
                onChange={(event) => setNewFee(event.currentTarget.value)}
              />
              <Button variant="default" onClick={add}>
                Adicionar bairro
              </Button>
            </div>
            {addProblem !== null && (
              <p role="alert" className={classes.error}>
                {addProblem}
              </p>
            )}
          </section>
        )}

        {form.mode === "fixed" && (
          <section className={classes.card}>
            <TextInput
              label="Taxa fixa para toda a área atendida"
              className={classes.fixed}
              value={form.fixedFee}
              onChange={(event) => set("fixedFee", event.currentTarget.value)}
            />
          </section>
        )}

        <section className={classes.card}>
          <h2 className={classes.cardTitle}>Regras de valor</h2>
          <div className={classes.rules}>
            <TextInput
              label="Entrega grátis acima de"
              description="Compara com o valor dos itens, sem o frete. Uma sacola de R$ 115 + R$ 9 de frete não ganha a isenção."
              placeholder="Sem entrega grátis"
              value={form.freeAbove}
              onChange={(event) => set("freeAbove", event.currentTarget.value)}
            />
            <TextInput
              label="Pedido mínimo"
              description="Vale só para entrega. Zero significa sem mínimo — retirada e salão nunca são afetados."
              value={form.minimumOrder}
              onChange={(event) => set("minimumOrder", event.currentTarget.value)}
            />
          </div>
          <Switch
            label="Aceitar pedido com frete a combinar"
            aria-label="Aceitar pedido com frete a combinar"
            description={toArrangeHelp(form.toArrange)}
            checked={form.toArrange}
            onChange={(event) => set("toArrange", event.currentTarget.checked)}
          />
        </section>

        {problem !== null && (
          <p role="alert" className={classes.error}>
            {problem}
          </p>
        )}
        {saveList.isError && (
          <p role="alert" className={classes.error}>
            {describeError(saveList.error)}
          </p>
        )}
        {update.isError && (
          <p role="alert" className={classes.error}>
            {describeError(update.error)}
          </p>
        )}
      </div>
      <SaveBar
        dirty={dirty}
        busy={saveList.isPending || update.isPending}
        saveLabel="Salvar entrega"
        onSave={() => void submit()}
        cancel={{ onClick: cancel }}
      />
    </>
  );
}

export function DeliveryPage() {
  const { restaurantId } = useSessionUser();
  const restaurant = useRestaurant(restaurantId);
  const neighborhoods = useNeighborhoods(restaurantId);

  // Carregando/erro só quando não há dado: um refetch que falha mantém o
  // `data` antigo, e trocar o formulário pela mensagem apagaria o que a
  // pessoa estava digitando.
  if (restaurant.data === undefined || neighborhoods.data === undefined) {
    const error = restaurant.error ?? neighborhoods.error;
    return <p className={classes.loading}>{error ? describeError(error) : "Carregando entrega…"}</p>;
  }
  return <DeliveryEditor restaurant={restaurant.data} saved={neighborhoods.data} />;
}
```

- [ ] **Step 6: Rota e rail**

Em `apps/panel/src/router.tsx`, importe `import { DeliveryPage } from "./features/settings/DeliveryPage.tsx";` e acrescente, logo depois da rota `/modalidades`:

```tsx
              { path: "/entrega", handle: { title: "Entrega" }, element: <DeliveryPage /> },
```

Em `apps/panel/src/layout/Rail.tsx`, no grupo "Configuração", acrescente Entrega entre Modalidades e Horário:

```tsx
      { to: "/modalidades", label: "Modalidades" },
      { to: "/entrega", label: "Entrega" },
      { to: "/horario", label: "Horário" },
      { to: "/dados-da-loja", label: "Dados da loja" },
```

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/delivery-page.test.tsx`
Expected: PASS (8 testes). Se `test/layout.test.tsx` listar os itens do rail um a um, acrescente "Entrega" na ordem acima.

- [ ] **Step 8: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src apps/panel/test/delivery-page.test.tsx
git commit -m "feat(panel): ✨ adiciona a tela de entrega"
```

---

### Task 4: As ligações com a tela de Entrega e com Grupos de opções

**Files:**
- Modify: `apps/panel/src/features/settings/ModalitiesPage.tsx`, `ModalitiesPage.module.css`
- Modify: `apps/panel/src/features/products/ProductFormPage.tsx`
- Test: `apps/panel/test/configuration-links.test.tsx`

**Interfaces:**
- Consumes: `DeliveryAlert` com o botão (Task 3); as rotas `/entrega` (Task 3) e `/grupos-de-opcoes` (Task 6 — o link pode existir antes da rota).
- Produces: nada que outra task consuma.

Ruling da spec: o link do formulário de produto para Grupos de opções aparece **sempre**, na nota que já diz "crie e edite em Grupos de opções" — cobre o caso "a loja não tem grupo nenhum" e dispensa uma condição.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/configuration-links.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductFormPage } from "../src/features/products/ProductFormPage.tsx";
import { ModalitiesPage } from "../src/features/settings/ModalitiesPage.tsx";
import { mockApi } from "./api-mock.ts";
import { panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;

const routes = [
  { path: "/modalidades", element: <ModalitiesPage /> },
  { path: "/produtos/novo", element: <ProductFormPage /> },
  { path: "/entrega", element: <LocationProbe /> },
  { path: "/grupos-de-opcoes", element: <LocationProbe /> },
];

describe("ligações da parte 2b", () => {
  it("'Configurar entrega' no aviso de bairro leva a /entrega", async () => {
    signIn();
    mockApi([
      { method: "GET", path: `${BASE}/delivery-neighborhoods`, body: { neighborhoods: [] } },
      ...panelHandlers({ restaurant: { isDelivery: true, deliveryFeeMode: "neighborhood" } }),
    ]);
    renderInPanel(routes, "/modalidades");
    fireEvent.click(await screen.findByRole("link", { name: "Configurar entrega" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/entrega");
  });

  it("a ajuda do interruptor de Entrega aponta para a tela de Entrega", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/modalidades");
    const link = await screen.findByRole("link", { name: "Entrega" });
    expect(link.getAttribute("href")).toBe("/entrega");
  });

  it("o aviso de frete grátis também leva a /entrega", async () => {
    signIn();
    mockApi(
      panelHandlers({ restaurant: { isDelivery: true, deliveryFeeMode: "fixed", deliveryFixedFeeInCents: 0 } }),
    );
    renderInPanel(routes, "/modalidades");
    await screen.findByText("Entrega ligada com frete grátis");
    expect(screen.getByRole("link", { name: "Configurar entrega" }).getAttribute("href")).toBe("/entrega");
  });

  it("o formulário de produto leva a Grupos de opções", async () => {
    signIn();
    mockApi([
      { method: "GET", path: `${BASE}/categories`, body: { data: [], limit: 100, offset: 0, total: 0 } },
      { method: "GET", path: `${BASE}/option-groups`, body: { data: [], limit: 100, offset: 0, total: 0 } },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/produtos/novo");
    const link = await screen.findByRole("link", { name: "Grupos de opções" });
    expect(link.getAttribute("href")).toBe("/grupos-de-opcoes");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/configuration-links.test.tsx`
Expected: FAIL nos três testes de Modalidades e no do produto; o do botão do aviso já passa (ele entrou na Task 3).

- [ ] **Step 3: Os links de Modalidades**

Em `apps/panel/src/features/settings/ModalitiesPage.tsx`:

1. Acrescente os imports `import { Button } from "@mantine/core";` (junte ao import de `Switch`: `import { Button, Switch } from "@mantine/core";`), `import type { ReactNode } from "react";` e `import { Link } from "react-router";`.
2. Troque o tipo `Flag` por `type Flag = { field: FlagField; label: string; help: ReactNode };`
3. Troque a primeira linha de `MODALITIES` por:

```tsx
  {
    field: "isDelivery",
    label: "Entrega",
    help: (
      <>
        Frete e área atendida ficam na tela de <Link to="/entrega">Entrega</Link>
      </>
    ),
  },
```

4. Troque o bloco do aviso de frete grátis por:

```tsx
      {freeDelivery && (
        <Notice tone="warn" title="Entrega ligada com frete grátis">
          <div className={classes.noticeRow}>
            <span>
              A taxa fixa está em R$ 0,00: todo pedido de entrega sai sem frete. Se não é essa a
              intenção, desligue a Entrega até o frete ser configurado.
            </span>
            <Button component={Link} to="/entrega" variant="default">
              Configurar entrega
            </Button>
          </div>
        </Notice>
      )}
```

Em `apps/panel/src/features/settings/ModalitiesPage.module.css`, acrescente:

```css
.noticeRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
```

- [ ] **Step 4: O link do formulário de produto**

Em `apps/panel/src/features/products/ProductFormPage.tsx`, garanta `Link` entre os imports de `react-router` e troque o parágrafo da nota dos grupos por:

```tsx
            <p className={classes.note}>
              A ordem aqui é a ordem que o cliente vê. Os grupos pertencem à loja — crie e edite em{" "}
              <Link to="/grupos-de-opcoes">Grupos de opções</Link>.
            </p>
```

- [ ] **Step 5: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/configuration-links.test.tsx test/modalities-page.test.tsx test/orders-page.test.tsx test/product-form.test.tsx`
Expected: PASS. Um teste que procurava o texto inteiro do aviso num nó só continua achando (o texto está inteiro dentro do `<span>`).

- [ ] **Step 6: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src apps/panel/test/configuration-links.test.tsx
git commit -m "feat(panel): ✨ liga os avisos de entrega e o produto às telas novas"
```

---

### Task 5: A regra de Grupos de opções, em forma pura

**Files:**
- Create: `apps/panel/src/features/optionGroups/optionGroups.ts`
- Test: `apps/panel/test/optionGroups.test.ts`

**Interfaces:**
- Consumes: `OptionGroupBody`, `OptionBody`, `NewOptionBody` (Task 1); `ConfirmCopy` de `src/ui/confirmCopy.ts`; `parseReaisToCents`/`centsToInput`; tipos `Option`, `OptionGroup`, `PriceRule`, `Product`.
- Produces:
  - `RULE_CARD: readonly { rule: PriceRule; name: string; help: string; example: string; when: string }[]`
  - `RULE_NAMES: Record<PriceRule, string>`
  - `rangeLabel(group: Pick<OptionGroup, "minOptions" | "maxOptions">): string`
  - `usageCounts(products: readonly Pick<Product, "optionGroupIds">[]): Map<string, number>`
  - `usageLabel(count: number | undefined, truncated: boolean): string`
  - `removeGroupCopy(name: string, count: number | undefined, truncated: boolean): ConfirmCopy`
  - `unreachable(group: OptionGroup): { required: number; available: number } | null`
  - `unreachableMessage(gap: { required: number; available: number }): string`
  - `setOptionAvailable(groups: readonly OptionGroup[], groupId: string, optionId: string, available: boolean): OptionGroup[]`
  - `type GroupForm = { name: string; minOptions: string; maxOptions: string; priceRule: PriceRule }`, `EMPTY_GROUP_FORM`, `groupToForm(group)`, `validateGroupForm(form): string | null`, `groupFormToBody(form): OptionGroupBody`, `changedGroupPatch(form, group): Partial<OptionGroupBody>`
  - `type OptionForm = { name: string; price: string; maxQuantity: string }`, `EMPTY_OPTION_FORM`, `optionToForm(option)`, `validateOptionForm(form): string | null`, `optionFormToBody(form): NewOptionBody`, `changedOptionPatch(form, option): Partial<OptionBody>`

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/optionGroups.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  changedGroupPatch,
  changedOptionPatch,
  EMPTY_GROUP_FORM,
  EMPTY_OPTION_FORM,
  groupFormToBody,
  groupToForm,
  optionFormToBody,
  optionToForm,
  rangeLabel,
  removeGroupCopy,
  RULE_CARD,
  setOptionAvailable,
  unreachable,
  unreachableMessage,
  usageCounts,
  usageLabel,
  validateGroupForm,
  validateOptionForm,
} from "../src/features/optionGroups/optionGroups.ts";
import { makeOptionGroup } from "./fixtures.ts";

const option = (id: string, available = true, priceInCents = 0) => ({
  id,
  name: id,
  priceInCents,
  maxQuantity: 1,
  available,
  position: 0,
});

describe("rótulos", () => {
  it("intervalo no padrão do protótipo, e 'escolhe n' quando mínimo = máximo", () => {
    expect(rangeLabel({ minOptions: 1, maxOptions: 2 })).toBe("escolhe 1 a 2");
    expect(rangeLabel({ minOptions: 0, maxOptions: 1 })).toBe("escolhe 0 a 1");
    expect(rangeLabel({ minOptions: 2, maxOptions: 2 })).toBe("escolhe 2");
  });

  it("o cartão de regras é literal do protótipo", () => {
    expect(RULE_CARD.map((rule) => rule.example)).toEqual([
      "Bacon R$ 6,00 + Ovo R$ 3,00 = R$ 9,00",
      "Margherita R$ 62 + Calabresa R$ 72 = R$ 72,00",
      "Margherita R$ 62 + Calabresa R$ 72 = R$ 67,00",
    ]);
  });
});

describe("uso em produtos", () => {
  it("conta os vínculos pelos optionGroupIds", () => {
    const counts = usageCounts([
      { optionGroupIds: ["a", "b"] },
      { optionGroupIds: ["a"] },
      { optionGroupIds: [] },
    ]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.get("c")).toBeUndefined();
  });

  it("o rótulo diz 'pelo menos' quando a contagem parou antes do fim", () => {
    expect(usageLabel(undefined, false)).toBe("…");
    expect(usageLabel(0, false)).toBe("sem produtos");
    expect(usageLabel(1, false)).toBe("usado em 1 produto");
    expect(usageLabel(3, false)).toBe("usado em 3 produtos");
    expect(usageLabel(3, true)).toBe("usado em pelo menos 3 produtos");
    expect(usageLabel(0, true)).toBe("uso não contado");
  });

  it("a confirmação de remover diz quantos produtos perdem o grupo", () => {
    expect(removeGroupCopy("Sabores", 3, false)).toEqual({
      title: "Remover o grupo Sabores?",
      body: "O grupo sai dos 3 produtos que o usam. Pedidos já feitos não mudam.",
      cta: "Remover grupo",
      tone: "danger",
    });
    expect(removeGroupCopy("Sabores", 1, false).body).toBe(
      "O grupo sai do produto que o usa. Pedidos já feitos não mudam.",
    );
    expect(removeGroupCopy("Sabores", 0, false).body).toBe(
      "Nenhum produto usa este grupo. Pedidos já feitos não mudam.",
    );
    expect(removeGroupCopy("Sabores", 3, true).body).toBe(
      "O grupo sai de todos os produtos que o usam. Pedidos já feitos não mudam.",
    );
  });
});

describe("grupo que não se completa", () => {
  it("conta só as opções disponíveis", () => {
    const group = makeOptionGroup({ minOptions: 2, options: [option("a"), option("b", false)] });
    expect(unreachable(group)).toEqual({ required: 2, available: 1 });
    expect(unreachable(makeOptionGroup({ minOptions: 1, options: [option("a")] }))).toBeNull();
    expect(unreachable(makeOptionGroup({ minOptions: 0, options: [] }))).toBeNull();
  });

  it("a mensagem acerta singular e plural", () => {
    expect(unreachableMessage({ required: 2, available: 1 })).toBe(
      "O cliente não consegue completar este grupo: ele exige 2 escolhas e só 1 opção está disponível.",
    );
    expect(unreachableMessage({ required: 1, available: 0 })).toBe(
      "O cliente não consegue completar este grupo: ele exige 1 escolha e nenhuma opção está disponível.",
    );
    expect(unreachableMessage({ required: 3, available: 2 })).toBe(
      "O cliente não consegue completar este grupo: ele exige 3 escolhas e só 2 opções estão disponíveis.",
    );
  });
});

describe("setOptionAvailable", () => {
  it("troca só a opção pedida, sem mexer no original", () => {
    const groups = [makeOptionGroup({ id: "g", options: [option("a"), option("b")] })];
    const next = setOptionAvailable(groups, "g", "b", false);
    expect(next[0].options.map((item) => item.available)).toEqual([true, false]);
    expect(groups[0].options[1].available).toBe(true);
  });
});

describe("formulário do grupo", () => {
  it("valida só o que a API recusa", () => {
    const valid = { name: "Borda", minOptions: "0", maxOptions: "1", priceRule: "sum" as const };
    expect(validateGroupForm(valid)).toBeNull();
    expect(validateGroupForm({ ...valid, name: "  " })).toBe("Dê um nome ao grupo, de até 60 caracteres.");
    expect(validateGroupForm({ ...valid, name: "x".repeat(61) })).toBe("Dê um nome ao grupo, de até 60 caracteres.");
    expect(validateGroupForm({ ...valid, minOptions: "-1" })).toBe("O mínimo precisa ser um número inteiro, de 0 para cima.");
    expect(validateGroupForm({ ...valid, maxOptions: "0" })).toBe("O máximo precisa ser um número inteiro, de 1 para cima.");
    expect(validateGroupForm({ ...valid, minOptions: "3", maxOptions: "2" })).toBe(
      "O grupo exige 3 opções mas aceita no máximo 2.",
    );
  });

  it("vira corpo de criação e patch só do que mudou", () => {
    expect(EMPTY_GROUP_FORM).toEqual({ name: "", minOptions: "0", maxOptions: "1", priceRule: "sum" });
    expect(groupFormToBody({ name: " Borda ", minOptions: "0", maxOptions: "1", priceRule: "sum" })).toEqual({
      name: "Borda",
      minOptions: 0,
      maxOptions: 1,
      priceRule: "sum",
    });
    const group = makeOptionGroup({ name: "Sabores", minOptions: 1, maxOptions: 2, priceRule: "highest" });
    expect(changedGroupPatch(groupToForm(group), group)).toEqual({});
    expect(changedGroupPatch({ ...groupToForm(group), priceRule: "average", maxOptions: "3" }, group)).toEqual({
      maxOptions: 3,
      priceRule: "average",
    });
  });
});

describe("formulário da opção", () => {
  it("preço vazio é R$ 0,00 (escolha obrigatória sem custo)", () => {
    expect(EMPTY_OPTION_FORM).toEqual({ name: "", price: "", maxQuantity: "1" });
    expect(optionFormToBody({ name: " Ao ponto ", price: "", maxQuantity: "1" })).toEqual({
      name: "Ao ponto",
      priceInCents: 0,
      maxQuantity: 1,
    });
  });

  it("valida nome, preço e quantidade", () => {
    const valid = { name: "Bacon", price: "6,00", maxQuantity: "2" };
    expect(validateOptionForm(valid)).toBeNull();
    expect(validateOptionForm({ ...valid, name: "" })).toBe("Dê um nome à opção, de até 60 caracteres.");
    expect(validateOptionForm({ ...valid, price: "seis" })).toBe(
      "Informe o preço em reais, como 6,00 — ou deixe em branco para R$ 0,00.",
    );
    expect(validateOptionForm({ ...valid, maxQuantity: "0" })).toBe(
      "A quantidade máxima precisa ser um número inteiro, de 1 para cima.",
    );
  });

  it("patch só do que mudou", () => {
    const opt = { ...option("opt-1", true, 7200), name: "Calabresa" };
    expect(changedOptionPatch(optionToForm(opt), opt)).toEqual({});
    expect(changedOptionPatch({ ...optionToForm(opt), price: "75,00" }, opt)).toEqual({ priceInCents: 7500 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/optionGroups.test.ts`
Expected: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar**

Crie `apps/panel/src/features/optionGroups/optionGroups.ts`:

```ts
import type { NewOptionBody, OptionBody, OptionGroupBody } from "../../api/optionGroups.ts";
import type { Option, OptionGroup, PriceRule, Product } from "../../api/types.ts";
import { centsToInput, parseReaisToCents } from "../../lib/money.ts";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";

/**
 * O cartão "Regra de preço", texto literal do protótipo do handoff. É texto
 * FIXO: o painel não recalcula a regra de `unitPrice()` da API.
 */
export const RULE_CARD: readonly { rule: PriceRule; name: string; help: string; example: string; when: string }[] = [
  {
    rule: "sum",
    name: "Somar",
    help: "Soma o preço de tudo que foi escolhido.",
    example: "Bacon R$ 6,00 + Ovo R$ 3,00 = R$ 9,00",
    when: "Adicionais, borda, bebida extra",
  },
  {
    rule: "highest",
    name: "Mais caro",
    help: "Cobra só a opção mais cara entre as escolhidas.",
    example: "Margherita R$ 62 + Calabresa R$ 72 = R$ 72,00",
    when: "Pizza meio a meio pelo sabor mais caro",
  },
  {
    rule: "average",
    name: "Média",
    help: "Cobra a média das opções escolhidas.",
    example: "Margherita R$ 62 + Calabresa R$ 72 = R$ 67,00",
    when: "A outra convenção de meio a meio",
  },
];

export const RULE_NAMES: Record<PriceRule, string> = { sum: "Somar", highest: "Mais caro", average: "Média" };

/** "escolhe 1 a 2", como no protótipo; "escolhe 2 a 2" leria como erro. */
export function rangeLabel(group: Pick<OptionGroup, "minOptions" | "maxOptions">): string {
  return group.minOptions === group.maxOptions
    ? `escolhe ${group.minOptions}`
    : `escolhe ${group.minOptions} a ${group.maxOptions}`;
}

/**
 * Em quantos produtos cada grupo é usado. A API não traz essa contagem, mas
 * cada produto traz `optionGroupIds` — a conta é do painel, e é PROVISÓRIA:
 * o lugar dela é um campo calculado no SQL (pendência de API).
 */
export function usageCounts(products: readonly Pick<Product, "optionGroupIds">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const product of products) {
    for (const id of product.optionGroupIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function produtos(count: number): string {
  return count === 1 ? "1 produto" : `${count} produtos`;
}

export function usageLabel(count: number | undefined, truncated: boolean): string {
  if (count === undefined) return "…";
  if (truncated) return count === 0 ? "uso não contado" : `usado em pelo menos ${produtos(count)}`;
  if (count === 0) return "sem produtos";
  return `usado em ${produtos(count)}`;
}

/**
 * A API tira o grupo de todo produto que o usa, na mesma transação e sem
 * avisar. Sem o número, a pessoa não sabe o que está desmontando.
 */
export function removeGroupCopy(name: string, count: number | undefined, truncated: boolean): ConfirmCopy {
  let body: string;
  if (count === undefined || truncated) {
    body = "O grupo sai de todos os produtos que o usam. Pedidos já feitos não mudam.";
  } else if (count === 0) {
    body = "Nenhum produto usa este grupo. Pedidos já feitos não mudam.";
  } else if (count === 1) {
    body = "O grupo sai do produto que o usa. Pedidos já feitos não mudam.";
  } else {
    body = `O grupo sai dos ${count} produtos que o usam. Pedidos já feitos não mudam.`;
  }
  return { title: `Remover o grupo ${name}?`, body, cta: "Remover grupo", tone: "danger" };
}

/**
 * O mínimo conta opções DISTINTAS (é o que a criação de pedido confere em
 * `services/orders.ts`), então opção esgotada não ajuda a completá-lo. A API
 * aceita esse estado — a tela informa, não trava.
 */
export function unreachable(group: OptionGroup): { required: number; available: number } | null {
  const available = group.options.filter((item) => item.available).length;
  return group.minOptions > available ? { required: group.minOptions, available } : null;
}

export function unreachableMessage({ required, available }: { required: number; available: number }): string {
  const escolhas = required === 1 ? "1 escolha" : `${required} escolhas`;
  const disponiveis =
    available === 0
      ? "nenhuma opção está disponível"
      : available === 1
        ? "só 1 opção está disponível"
        : `só ${available} opções estão disponíveis`;
  return `O cliente não consegue completar este grupo: ele exige ${escolhas} e ${disponiveis}.`;
}

/** Para a escrita otimista do interruptor "Disponível". */
export function setOptionAvailable(
  groups: readonly OptionGroup[],
  groupId: string,
  optionId: string,
  available: boolean,
): OptionGroup[] {
  return groups.map((group) =>
    group.id !== groupId
      ? group
      : { ...group, options: group.options.map((item) => (item.id === optionId ? { ...item, available } : item)) },
  );
}

const INTEGER = /^\d+$/;
const NAME_MAX = 60;

export type GroupForm = { name: string; minOptions: string; maxOptions: string; priceRule: PriceRule };

export const EMPTY_GROUP_FORM: GroupForm = { name: "", minOptions: "0", maxOptions: "1", priceRule: "sum" };

export function groupToForm(group: OptionGroup): GroupForm {
  return {
    name: group.name,
    minOptions: String(group.minOptions),
    maxOptions: String(group.maxOptions),
    priceRule: group.priceRule,
  };
}

/** Só o que a API recusa — inventar regra que o servidor aceita cria uma proibição que ninguém explica. */
export function validateGroupForm(form: GroupForm): string | null {
  const name = form.name.trim();
  if (name === "" || name.length > NAME_MAX) return "Dê um nome ao grupo, de até 60 caracteres.";
  if (!INTEGER.test(form.minOptions.trim())) return "O mínimo precisa ser um número inteiro, de 0 para cima.";
  const max = form.maxOptions.trim();
  if (!INTEGER.test(max) || Number(max) < 1) return "O máximo precisa ser um número inteiro, de 1 para cima.";
  const minimum = Number(form.minOptions.trim());
  const maximum = Number(max);
  if (minimum > maximum) return `O grupo exige ${minimum} opções mas aceita no máximo ${maximum}.`;
  return null;
}

export function groupFormToBody(form: GroupForm): OptionGroupBody {
  return {
    name: form.name.trim(),
    minOptions: Number(form.minOptions.trim()),
    maxOptions: Number(form.maxOptions.trim()),
    priceRule: form.priceRule,
  };
}

export function changedGroupPatch(form: GroupForm, group: OptionGroup): Partial<OptionGroupBody> {
  const body = groupFormToBody(form);
  const patch: Partial<OptionGroupBody> = {};
  if (body.name !== group.name) patch.name = body.name;
  if (body.minOptions !== group.minOptions) patch.minOptions = body.minOptions;
  if (body.maxOptions !== group.maxOptions) patch.maxOptions = body.maxOptions;
  if (body.priceRule !== group.priceRule) patch.priceRule = body.priceRule;
  return patch;
}

export type OptionForm = { name: string; price: string; maxQuantity: string };

export const EMPTY_OPTION_FORM: OptionForm = { name: "", price: "", maxQuantity: "1" };

export function optionToForm(option: Option): OptionForm {
  return { name: option.name, price: centsToInput(option.priceInCents), maxQuantity: String(option.maxQuantity) };
}

export function validateOptionForm(form: OptionForm): string | null {
  const name = form.name.trim();
  if (name === "" || name.length > NAME_MAX) return "Dê um nome à opção, de até 60 caracteres.";
  if (form.price.trim() !== "" && parseReaisToCents(form.price) === null) {
    return "Informe o preço em reais, como 6,00 — ou deixe em branco para R$ 0,00.";
  }
  const quantity = form.maxQuantity.trim();
  if (!INTEGER.test(quantity) || Number(quantity) < 1) {
    return "A quantidade máxima precisa ser um número inteiro, de 1 para cima.";
  }
  return null;
}

/** Preço vazio é R$ 0,00: a escolha obrigatória sem custo ("ponto da carne"). */
export function optionFormToBody(form: OptionForm): NewOptionBody {
  return {
    name: form.name.trim(),
    priceInCents: form.price.trim() === "" ? 0 : (parseReaisToCents(form.price) ?? 0),
    maxQuantity: Number(form.maxQuantity.trim()),
  };
}

export function changedOptionPatch(form: OptionForm, option: Option): Partial<OptionBody> {
  const body = optionFormToBody(form);
  const patch: Partial<OptionBody> = {};
  if (body.name !== option.name) patch.name = body.name;
  if (body.priceInCents !== option.priceInCents) patch.priceInCents = body.priceInCents;
  if (body.maxQuantity !== option.maxQuantity) patch.maxQuantity = body.maxQuantity;
  return patch;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/optionGroups.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src/features/optionGroups/optionGroups.ts apps/panel/test/optionGroups.test.ts
git commit -m "feat(panel): ✨ adiciona a regra de grupos de opções"
```

---

### Task 6: A tela de Grupos de opções, só leitura

**Files:**
- Create: `apps/panel/src/features/optionGroups/useOptionGroups.ts`
- Create: `apps/panel/src/features/optionGroups/OptionGroupsPage.tsx`
- Create: `apps/panel/src/features/optionGroups/OptionGroupsPage.module.css`
- Create: `apps/panel/src/features/optionGroups/GroupCard.tsx`
- Modify: `apps/panel/src/router.tsx`, `apps/panel/src/layout/Rail.tsx`
- Test: `apps/panel/test/option-groups-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 (API) e Task 5 (regra).
- Produces:
  - `optionGroupsQueryKey(restaurantId): readonly ["option-groups", string]` — a MESMA chave que o `ProductFormPage` já usa para o seletor de grupos.
  - `useOptionGroups(restaurantId)`, `useOptionGroupUsage(restaurantId)` (dado: `{ counts: Map<string, number>; truncated: boolean }`)
  - mutações: `useCreateOptionGroup(restaurantId)`, `useUpdateOptionGroup(restaurantId, groupId)`, `useRemoveOptionGroup(restaurantId, groupId)`, `useCreateOption(restaurantId, groupId)`, `useUpdateOption(restaurantId, groupId, optionId)`, `useRemoveOption(restaurantId, groupId, optionId)`, `useToggleOptionAvailable(restaurantId, groupId, optionId)`
  - `GroupCard({ restaurantId, group, usage, truncated })` — Tasks 7 e 8 o substituem por versões maiores, com a mesma assinatura.
  - Classes do CSS module usadas nas Tasks 7 e 8: `group`, `groupHead`, `groupName`, `pill`, `rulePill`, `usage`, `headActions`, `table`, `tr`, `th`, `rows`, `cell`, `price`, `noOptions`, `error`, `fields`, `formActions`, `dashed`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/option-groups-page.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OptionGroupsPage } from "../src/features/optionGroups/OptionGroupsPage.tsx";
import type { OptionGroup, Product } from "../src/api/types.ts";
import { mockApi } from "./api-mock.ts";
import { makeOptionGroup, makeProduct, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;
const routes = [{ path: "/grupos-de-opcoes", element: <OptionGroupsPage /> }];

const opt = (id: string, name: string, priceInCents: number, available = true) => ({
  id,
  name,
  priceInCents,
  maxQuantity: 1,
  available,
  position: 0,
});

function groupsSetup(groups: OptionGroup[], products: Product[]) {
  signIn();
  const api = mockApi([
    { method: "GET", path: `${BASE}/option-groups`, body: { data: groups, limit: 100, offset: 0, total: groups.length } },
    { method: "GET", path: `${BASE}/products`, body: { data: products, limit: 100, offset: 0, total: products.length } },
    ...panelHandlers(),
  ]);
  renderInPanel(routes, "/grupos-de-opcoes");
  return api;
}

describe("OptionGroupsPage (leitura)", () => {
  it("o cartão de regras traz os três exemplos literais", async () => {
    groupsSetup([], []);
    expect(await screen.findByText("Regra de preço — a escolha que muda o valor final")).toBeTruthy();
    expect(screen.getByText("Bacon R$ 6,00 + Ovo R$ 3,00 = R$ 9,00")).toBeTruthy();
    expect(screen.getByText("Margherita R$ 62 + Calabresa R$ 72 = R$ 72,00")).toBeTruthy();
    expect(screen.getByText("Margherita R$ 62 + Calabresa R$ 72 = R$ 67,00")).toBeTruthy();
  });

  it("cada grupo mostra intervalo, regra, uso e as opções", async () => {
    groupsSetup(
      [
        makeOptionGroup({
          id: "grp-1",
          name: "Sabores",
          minOptions: 1,
          maxOptions: 2,
          priceRule: "highest",
          options: [opt("o1", "Margherita", 6200), opt("o2", "Calabresa", 7200)],
        }),
        makeOptionGroup({ id: "grp-2", name: "Tamanho", minOptions: 1, maxOptions: 1, priceRule: "sum" }),
        makeOptionGroup({ id: "grp-3", name: "Borda", minOptions: 0, maxOptions: 1, priceRule: "sum" }),
      ],
      [
        makeProduct({ id: "p1", optionGroupIds: ["grp-1", "grp-2"] }),
        makeProduct({ id: "p2", optionGroupIds: ["grp-1"] }),
      ],
    );
    const sabores = within(await screen.findByRole("region", { name: "Sabores" }));
    expect(sabores.getByText("escolhe 1 a 2")).toBeTruthy();
    expect(sabores.getByText("Mais caro")).toBeTruthy();
    expect(await sabores.findByText("usado em 2 produtos")).toBeTruthy();
    expect(sabores.getByText("Calabresa")).toBeTruthy();
    expect(sabores.getByText(/72,00/)).toBeTruthy();

    const tamanho = within(screen.getByRole("region", { name: "Tamanho" }));
    expect(tamanho.getByText("escolhe 1")).toBeTruthy();
    expect(await tamanho.findByText("usado em 1 produto")).toBeTruthy();

    expect(await within(screen.getByRole("region", { name: "Borda" })).findByText("sem produtos")).toBeTruthy();
  });

  it("avisa quando o mínimo passa das opções disponíveis", async () => {
    groupsSetup(
      [
        makeOptionGroup({
          name: "Sabores",
          minOptions: 2,
          options: [opt("o1", "Margherita", 6200), opt("o2", "Calabresa", 7200, false)],
        }),
      ],
      [],
    );
    expect(
      await screen.findByText(
        "O cliente não consegue completar este grupo: ele exige 2 escolhas e só 1 opção está disponível.",
      ),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/option-groups-page.test.tsx`
Expected: FAIL — `OptionGroupsPage` não existe.

- [ ] **Step 3: Os hooks**

Crie `apps/panel/src/features/optionGroups/useOptionGroups.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOption,
  createOptionGroup,
  deleteOption,
  deleteOptionGroup,
  listAllOptionGroups,
  type NewOptionBody,
  type OptionBody,
  type OptionGroupBody,
  updateOption,
  updateOptionGroup,
} from "../../api/optionGroups.ts";
import { listAllProducts } from "../../api/products.ts";
import type { OptionGroup } from "../../api/types.ts";
import { setOptionAvailable, usageCounts } from "./optionGroups.ts";

/**
 * A MESMA chave do seletor de grupos do formulário de produto: sem isso, um
 * grupo criado aqui não apareceria lá até o cache vencer.
 */
export function optionGroupsQueryKey(restaurantId: string) {
  return ["option-groups", restaurantId] as const;
}

export function useOptionGroups(restaurantId: string) {
  return useQuery({
    queryKey: optionGroupsQueryKey(restaurantId),
    queryFn: () => listAllOptionGroups(restaurantId),
  });
}

/**
 * Debaixo do prefixo `["products", restaurantId]`: toda invalidação de
 * produto (criar, editar, trocar grupos) refaz a contagem junto.
 */
export function useOptionGroupUsage(restaurantId: string) {
  return useQuery({
    queryKey: ["products", restaurantId, "option-group-usage"],
    queryFn: async () => {
      const result = await listAllProducts(restaurantId);
      return { counts: usageCounts(result.items), truncated: result.truncated };
    },
  });
}

function useInvalidateGroups(restaurantId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: optionGroupsQueryKey(restaurantId) });
}

export function useCreateOptionGroup(restaurantId: string) {
  const invalidate = useInvalidateGroups(restaurantId);
  return useMutation({
    mutationFn: (body: OptionGroupBody) => createOptionGroup(restaurantId, body),
    onSuccess: invalidate,
  });
}

export function useUpdateOptionGroup(restaurantId: string, groupId: string) {
  const invalidate = useInvalidateGroups(restaurantId);
  return useMutation({
    mutationFn: (patch: Partial<OptionGroupBody>) => updateOptionGroup(restaurantId, groupId, patch),
    onSuccess: invalidate,
  });
}

/** Remover o grupo muda os `optionGroupIds` dos produtos: produtos (e a contagem) também invalidam. */
export function useRemoveOptionGroup(restaurantId: string, groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteOptionGroup(restaurantId, groupId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: optionGroupsQueryKey(restaurantId) }),
        queryClient.invalidateQueries({ queryKey: ["products", restaurantId] }),
      ]);
    },
  });
}

export function useCreateOption(restaurantId: string, groupId: string) {
  const invalidate = useInvalidateGroups(restaurantId);
  return useMutation({
    mutationFn: (body: NewOptionBody) => createOption(restaurantId, groupId, body),
    onSuccess: invalidate,
  });
}

export function useUpdateOption(restaurantId: string, groupId: string, optionId: string) {
  const invalidate = useInvalidateGroups(restaurantId);
  return useMutation({
    mutationFn: (patch: Partial<OptionBody>) => updateOption(restaurantId, groupId, optionId, patch),
    onSuccess: invalidate,
  });
}

export function useRemoveOption(restaurantId: string, groupId: string, optionId: string) {
  const invalidate = useInvalidateGroups(restaurantId);
  return useMutation({
    mutationFn: () => deleteOption(restaurantId, groupId, optionId),
    onSuccess: invalidate,
  });
}

/**
 * Interruptor "Disponível": o estado novo aparece na hora e volta atrás se a
 * API recusar — o mesmo comportamento dos interruptores de Modalidades. O
 * `onSettled` relê a lista, então uma volta atrás que atropele outra escrita
 * otimista em voo se corrige na releitura.
 */
export function useToggleOptionAvailable(restaurantId: string, groupId: string, optionId: string) {
  const queryClient = useQueryClient();
  const key = optionGroupsQueryKey(restaurantId);
  return useMutation({
    mutationFn: (available: boolean) => updateOption(restaurantId, groupId, optionId, { available }),
    onMutate: async (available) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<OptionGroup[]>(key);
      if (previous !== undefined) {
        queryClient.setQueryData(key, setOptionAvailable(previous, groupId, optionId, available));
      }
      return { previous };
    },
    onError: (_error, _available, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
```

- [ ] **Step 4: O CSS**

Crie `apps/panel/src/features/optionGroups/OptionGroupsPage.module.css`:

```css
.page {
  display: grid;
  gap: 16px;
  max-width: 980px;
  padding: 18px 20px;
}

.note {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-ink2);
}

.rules {
  display: grid;
  gap: 12px;
  padding: 18px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.rulesTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.ruleGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.rule {
  display: grid;
  gap: 4px;
  align-content: start;
  padding: 12px;
  background: var(--mc-surface2);
  border: 1px solid var(--mc-line);
  border-radius: 8px;
}

.ruleName {
  font-size: 14px;
}

.ruleHelp,
.ruleWhen {
  margin: 0;
  font-size: 12.5px;
  color: var(--mc-ink2);
}

.ruleExample {
  margin: 0;
  padding: 6px 8px;
  font-size: 12.5px;
  background: var(--mc-surface3);
  border-radius: 6px;
}

.toolbar {
  display: flex;
  justify-content: flex-end;
}

.group {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.groupHead {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.groupName {
  margin: 0;
  font-size: 15.5px;
  font-weight: 700;
}

.pill {
  padding: 2px 8px;
  font-size: 12px;
  border: 1px solid var(--mc-line);
  border-radius: 999px;
  color: var(--mc-ink2);
}

.rulePill {
  background: var(--mc-accent-soft);
  border-color: var(--mc-accent-line);
  color: var(--mc-accent-hi);
  font-weight: 600;
}

.usage {
  margin-left: auto;
  font-size: 12.5px;
  color: var(--mc-ink3);
}

.headActions {
  display: flex;
  gap: 4px;
}

.table {
  border: 1px solid var(--mc-line);
  border-radius: 8px;
  overflow: hidden;
}

.tr {
  display: grid;
  grid-template-columns: minmax(0, 2fr) 110px 100px 110px 90px;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--mc-line);
}

.th {
  min-height: 34px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mc-ink3);
  background: var(--mc-surface2);
}

.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

.rows > li:last-child .tr,
.rows > li:last-child.tr {
  border-bottom: 0;
}

.cell {
  min-width: 0;
  font-size: 14px;
}

.price {
  text-align: right;
}

.noOptions {
  margin: 0;
  padding: 12px;
  font-size: 13px;
  color: var(--mc-ink3);
}

.error {
  margin: 0;
  font-size: 12.5px;
  color: var(--mc-danger);
}

.fields {
  display: grid;
  grid-template-columns: minmax(0, 2fr) 90px 90px minmax(0, 1fr);
  gap: 10px;
  align-items: end;
}

.formActions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.dashed {
  height: 34px;
  margin: 8px 12px 10px;
  padding: 0 12px;
  border: 1px dashed var(--mc-line-hi);
  border-radius: 6px;
  background: transparent;
  color: var(--mc-ink2);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.dashed:hover {
  background: var(--mc-surface3);
}

.loading {
  padding: 18px 20px;
  color: var(--mc-ink2);
}
```

- [ ] **Step 5: O cartão do grupo (só leitura)**

Crie `apps/panel/src/features/optionGroups/GroupCard.tsx`:

```tsx
import type { OptionGroup } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import { Notice } from "../../ui/Notice.tsx";
import { RULE_NAMES, rangeLabel, unreachable, unreachableMessage, usageLabel } from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";

export function GroupCard({
  group,
  usage,
  truncated,
}: {
  restaurantId: string;
  group: OptionGroup;
  usage: number | undefined;
  truncated: boolean;
}) {
  const gap = unreachable(group);
  return (
    <section className={classes.group} aria-label={group.name}>
      <header className={classes.groupHead}>
        <h2 className={classes.groupName}>{group.name}</h2>
        <span className={`${classes.pill} n`}>{rangeLabel(group)}</span>
        <span className={`${classes.pill} ${classes.rulePill}`}>{RULE_NAMES[group.priceRule]}</span>
        <span className={`${classes.usage} n`}>{usageLabel(usage, truncated)}</span>
      </header>

      {gap !== null && <Notice tone="warn">{unreachableMessage(gap)}</Notice>}

      <div className={classes.table}>
        <div className={`${classes.tr} ${classes.th}`}>
          <span>Opção</span>
          <span className={classes.price}>Preço</span>
          <span>Qtd. máx.</span>
          <span />
          <span />
        </div>
        {group.options.length === 0 ? (
          <p className={classes.noOptions}>Nenhuma opção cadastrada.</p>
        ) : (
          <ul className={classes.rows}>
            {group.options.map((option) => (
              <li key={option.id} className={classes.tr}>
                <span className={classes.cell}>{option.name}</span>
                <span className={`${classes.cell} ${classes.price} n`}>{formatCents(option.priceInCents)}</span>
                <span className={`${classes.cell} n`}>{option.maxQuantity}</span>
                <span />
                <span />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: A página**

Crie `apps/panel/src/features/optionGroups/OptionGroupsPage.tsx`:

```tsx
import { describeError } from "../../api/client.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { GroupCard } from "./GroupCard.tsx";
import { RULE_CARD } from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";
import { useOptionGroups, useOptionGroupUsage } from "./useOptionGroups.ts";

function RuleCard() {
  return (
    <section className={classes.rules}>
      <h2 className={classes.rulesTitle}>Regra de preço — a escolha que muda o valor final</h2>
      <div className={classes.ruleGrid}>
        {RULE_CARD.map((rule) => (
          <div key={rule.rule} className={classes.rule}>
            <strong className={classes.ruleName}>{rule.name}</strong>
            <p className={classes.ruleHelp}>{rule.help}</p>
            <p className={`${classes.ruleExample} n`}>{rule.example}</p>
            <p className={classes.ruleWhen}>{rule.when}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function OptionGroupsPage() {
  const { restaurantId } = useSessionUser();
  const groups = useOptionGroups(restaurantId);
  const usage = useOptionGroupUsage(restaurantId);

  // Carregando/erro só quando não há dado (a regra da 2a).
  if (groups.data === undefined) {
    return (
      <p className={classes.loading}>
        {groups.isError ? describeError(groups.error) : "Carregando grupos de opções…"}
      </p>
    );
  }

  const counts = usage.data?.counts;
  const truncated = usage.data?.truncated ?? false;

  return (
    <div className={classes.page}>
      <RuleCard />
      {groups.data.length === 0 && <p className={classes.note}>Nenhum grupo cadastrado ainda.</p>}
      {groups.data.map((group) => (
        <GroupCard
          key={group.id}
          restaurantId={restaurantId}
          group={group}
          usage={counts === undefined ? undefined : (counts.get(group.id) ?? 0)}
          truncated={truncated}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Rota e rail**

Em `apps/panel/src/router.tsx`, importe `import { OptionGroupsPage } from "./features/optionGroups/OptionGroupsPage.tsx";` e acrescente, logo depois da rota `/secoes`:

```tsx
              {
                path: "/grupos-de-opcoes",
                handle: { title: "Grupos de opções" },
                element: <OptionGroupsPage />,
              },
```

Em `apps/panel/src/layout/Rail.tsx`, no grupo "Operação", acrescente depois de Seções:

```tsx
      { to: "/secoes", label: "Seções" },
      { to: "/grupos-de-opcoes", label: "Grupos de opções" },
```

- [ ] **Step 8: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/option-groups-page.test.tsx`
Expected: PASS (3 testes). Se `test/layout.test.tsx` listar os itens do rail um a um, acrescente "Grupos de opções" depois de "Seções".

- [ ] **Step 9: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src apps/panel/test/option-groups-page.test.tsx
git commit -m "feat(panel): ✨ adiciona a tela de grupos de opções"
```

---

### Task 7: Criar, editar e remover grupo

**Files:**
- Create: `apps/panel/src/features/optionGroups/GroupFields.tsx`
- Modify: `apps/panel/src/features/optionGroups/GroupCard.tsx` (substituição inteira)
- Modify: `apps/panel/src/features/optionGroups/OptionGroupsPage.tsx` (substituição inteira)
- Test: `apps/panel/test/option-groups-edit.test.tsx`

**Interfaces:**
- Consumes: `useCreateOptionGroup`, `useUpdateOptionGroup`, `useRemoveOptionGroup` (Task 6); `GroupForm`, `EMPTY_GROUP_FORM`, `groupToForm`, `validateGroupForm`, `groupFormToBody`, `changedGroupPatch`, `removeGroupCopy`, `RULE_CARD` (Task 5); `ConfirmDialog`.
- Produces: `GroupFields({ form, onChange })`; `GroupCard` com a mesma assinatura da Task 6.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/option-groups-edit.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OptionGroupsPage } from "../src/features/optionGroups/OptionGroupsPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOptionGroup, makeProduct, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;
const routes = [{ path: "/grupos-de-opcoes", element: <OptionGroupsPage /> }];

function setup(extra: MockHandler[], groups = [makeOptionGroup({ id: "grp-1", name: "Sabores" })], products = [makeProduct()]) {
  signIn();
  const api = mockApi([
    ...extra,
    { method: "GET", path: `${BASE}/option-groups`, body: { data: groups, limit: 100, offset: 0, total: groups.length } },
    { method: "GET", path: `${BASE}/products`, body: { data: products, limit: 100, offset: 0, total: products.length } },
    ...panelHandlers(),
  ]);
  renderInPanel(routes, "/grupos-de-opcoes");
  return api;
}

function type(scope: ReturnType<typeof within> | typeof screen, label: string, value: string) {
  fireEvent.change(scope.getByLabelText(label), { target: { value } });
}

describe("OptionGroupsPage (grupos)", () => {
  it("cria um grupo", async () => {
    const api = setup([
      { method: "POST", path: `${BASE}/option-groups`, status: 201, body: makeOptionGroup({ id: "grp-9", name: "Borda" }) },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Novo grupo" }));
    type(screen, "Nome do grupo", "Borda");
    type(screen, "Mínimo", "0");
    type(screen, "Máximo", "1");
    fireEvent.change(screen.getByLabelText("Regra de preço"), { target: { value: "sum" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar grupo" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
        name: "Borda",
        minOptions: 0,
        maxOptions: 1,
        priceRule: "sum",
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Nome do grupo")).toBeNull());
  });

  it("mínimo maior que o máximo é barrado antes da chamada", async () => {
    const api = setup([]);
    fireEvent.click(await screen.findByRole("button", { name: "Novo grupo" }));
    type(screen, "Nome do grupo", "Sabores extras");
    type(screen, "Mínimo", "3");
    type(screen, "Máximo", "2");
    fireEvent.click(screen.getByRole("button", { name: "Criar grupo" }));
    expect(await screen.findByText("O grupo exige 3 opções mas aceita no máximo 2.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("nome repetido: o 409 da API aparece no próprio cartão", async () => {
    setup([
      {
        method: "PATCH",
        path: `${BASE}/option-groups/grp-1`,
        status: 409,
        body: { statusCode: 409, error: "Conflict", message: 'Já existe um grupo de opções chamado "Borda"' },
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Editar grupo Sabores" }));
    const card = within(screen.getByRole("region", { name: "Sabores" }));
    type(card, "Nome do grupo", "Borda");
    fireEvent.click(card.getByRole("button", { name: "Salvar grupo" }));
    expect(await card.findByText('Já existe um grupo de opções chamado "Borda"')).toBeTruthy();
  });

  it("a remoção diz quantos produtos perdem o grupo", async () => {
    const api = setup(
      [{ method: "DELETE", path: `${BASE}/option-groups/grp-1`, status: 204 }],
      [makeOptionGroup({ id: "grp-1", name: "Sabores" })],
      [
        makeProduct({ id: "p1", optionGroupIds: ["grp-1"] }),
        makeProduct({ id: "p2", optionGroupIds: ["grp-1"] }),
      ],
    );
    await screen.findByText("usado em 2 produtos");
    fireEvent.click(screen.getByRole("button", { name: "Remover grupo Sabores" }));
    expect(await screen.findByText("O grupo sai dos 2 produtos que o usam. Pedidos já feitos não mudam.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remover grupo" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/option-groups-edit.test.tsx`
Expected: FAIL — não há botão "Novo grupo".

- [ ] **Step 3: Os campos do grupo**

Crie `apps/panel/src/features/optionGroups/GroupFields.tsx`:

```tsx
import { NativeSelect, TextInput } from "@mantine/core";
import type { PriceRule } from "../../api/types.ts";
import { type GroupForm, RULE_CARD } from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";

/** Os mesmos campos no grupo novo e na edição do cabeçalho. */
export function GroupFields({ form, onChange }: { form: GroupForm; onChange: (form: GroupForm) => void }) {
  return (
    <div className={classes.fields}>
      <TextInput
        label="Nome do grupo"
        value={form.name}
        onChange={(event) => onChange({ ...form, name: event.currentTarget.value })}
      />
      <TextInput
        label="Mínimo"
        value={form.minOptions}
        onChange={(event) => onChange({ ...form, minOptions: event.currentTarget.value })}
      />
      <TextInput
        label="Máximo"
        value={form.maxOptions}
        onChange={(event) => onChange({ ...form, maxOptions: event.currentTarget.value })}
      />
      <NativeSelect
        label="Regra de preço"
        value={form.priceRule}
        data={RULE_CARD.map((rule) => ({ value: rule.rule, label: rule.name }))}
        onChange={(event) => onChange({ ...form, priceRule: event.currentTarget.value as PriceRule })}
      />
    </div>
  );
}
```

- [ ] **Step 4: O cartão com edição e remoção**

Substitua `apps/panel/src/features/optionGroups/GroupCard.tsx` por:

```tsx
import { Button } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { OptionGroup } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Notice } from "../../ui/Notice.tsx";
import { GroupFields } from "./GroupFields.tsx";
import {
  changedGroupPatch,
  type GroupForm,
  groupToForm,
  RULE_NAMES,
  rangeLabel,
  removeGroupCopy,
  unreachable,
  unreachableMessage,
  usageLabel,
  validateGroupForm,
} from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";
import { useRemoveOptionGroup, useUpdateOptionGroup } from "./useOptionGroups.ts";

export function GroupCard({
  restaurantId,
  group,
  usage,
  truncated,
}: {
  restaurantId: string;
  group: OptionGroup;
  usage: number | undefined;
  truncated: boolean;
}) {
  const [editing, setEditing] = useState<GroupForm | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Cabeçalho e remoção são controles independentes: cada um com a sua mutação.
  const update = useUpdateOptionGroup(restaurantId, group.id);
  const remove = useRemoveOptionGroup(restaurantId, group.id);
  const gap = unreachable(group);

  const save = async () => {
    if (editing === null) return;
    const found = validateGroupForm(editing);
    setProblem(found);
    if (found !== null) return;
    const patch = changedGroupPatch(editing, group);
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    try {
      await update.mutateAsync(patch);
      setEditing(null);
    } catch {
      // A mensagem da API (409 de nome repetido, por exemplo) sai de `update.error`.
    }
  };

  const confirmRemove = async () => {
    try {
      await remove.mutateAsync();
    } catch {
      setConfirming(false);
    }
  };

  return (
    <section className={classes.group} aria-label={group.name}>
      {editing === null ? (
        <header className={classes.groupHead}>
          <h2 className={classes.groupName}>{group.name}</h2>
          <span className={`${classes.pill} n`}>{rangeLabel(group)}</span>
          <span className={`${classes.pill} ${classes.rulePill}`}>{RULE_NAMES[group.priceRule]}</span>
          <span className={`${classes.usage} n`}>{usageLabel(usage, truncated)}</span>
          <div className={classes.headActions}>
            <Button
              variant="subtle"
              aria-label={`Editar grupo ${group.name}`}
              onClick={() => {
                update.reset();
                setProblem(null);
                setEditing(groupToForm(group));
              }}
            >
              Editar
            </Button>
            <Button
              variant="subtle"
              className={buttons.dangerText}
              aria-label={`Remover grupo ${group.name}`}
              onClick={() => {
                remove.reset();
                setConfirming(true);
              }}
            >
              Remover grupo
            </Button>
          </div>
        </header>
      ) : (
        <div>
          <GroupFields form={editing} onChange={setEditing} />
          <div className={classes.formActions}>
            <Button
              variant="default"
              onClick={() => {
                setEditing(null);
                setProblem(null);
              }}
            >
              Cancelar
            </Button>
            <Button loading={update.isPending} onClick={() => void save()}>
              Salvar grupo
            </Button>
          </div>
        </div>
      )}

      {problem !== null && (
        <p role="alert" className={classes.error}>
          {problem}
        </p>
      )}
      {update.isError && (
        <p role="alert" className={classes.error}>
          {describeError(update.error)}
        </p>
      )}
      {remove.isError && (
        <p role="alert" className={classes.error}>
          {describeError(remove.error)}
        </p>
      )}

      {gap !== null && <Notice tone="warn">{unreachableMessage(gap)}</Notice>}

      <div className={classes.table}>
        <div className={`${classes.tr} ${classes.th}`}>
          <span>Opção</span>
          <span className={classes.price}>Preço</span>
          <span>Qtd. máx.</span>
          <span />
          <span />
        </div>
        {group.options.length === 0 ? (
          <p className={classes.noOptions}>Nenhuma opção cadastrada.</p>
        ) : (
          <ul className={classes.rows}>
            {group.options.map((option) => (
              <li key={option.id} className={classes.tr}>
                <span className={classes.cell}>{option.name}</span>
                <span className={`${classes.cell} ${classes.price} n`}>{formatCents(option.priceInCents)}</span>
                <span className={`${classes.cell} n`}>{option.maxQuantity}</span>
                <span />
                <span />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        copy={confirming ? removeGroupCopy(group.name, usage, truncated) : null}
        busy={remove.isPending}
        onConfirm={() => void confirmRemove()}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}
```

- [ ] **Step 5: O grupo novo na página**

Substitua `apps/panel/src/features/optionGroups/OptionGroupsPage.tsx` por:

```tsx
import { Button } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { GroupCard } from "./GroupCard.tsx";
import { GroupFields } from "./GroupFields.tsx";
import { EMPTY_GROUP_FORM, type GroupForm, groupFormToBody, RULE_CARD, validateGroupForm } from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";
import { useCreateOptionGroup, useOptionGroups, useOptionGroupUsage } from "./useOptionGroups.ts";

function RuleCard() {
  return (
    <section className={classes.rules}>
      <h2 className={classes.rulesTitle}>Regra de preço — a escolha que muda o valor final</h2>
      <div className={classes.ruleGrid}>
        {RULE_CARD.map((rule) => (
          <div key={rule.rule} className={classes.rule}>
            <strong className={classes.ruleName}>{rule.name}</strong>
            <p className={classes.ruleHelp}>{rule.help}</p>
            <p className={`${classes.ruleExample} n`}>{rule.example}</p>
            <p className={classes.ruleWhen}>{rule.when}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function NewGroupCard({ restaurantId, onDone }: { restaurantId: string; onDone: () => void }) {
  const [form, setForm] = useState<GroupForm>(EMPTY_GROUP_FORM);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useCreateOptionGroup(restaurantId);

  const submit = async () => {
    const found = validateGroupForm(form);
    setProblem(found);
    if (found !== null) return;
    try {
      await create.mutateAsync(groupFormToBody(form));
      onDone();
    } catch {
      // A mensagem da API sai de `create.error`.
    }
  };

  return (
    <section className={classes.group} aria-label="Novo grupo">
      <GroupFields form={form} onChange={setForm} />
      {problem !== null && (
        <p role="alert" className={classes.error}>
          {problem}
        </p>
      )}
      {create.isError && (
        <p role="alert" className={classes.error}>
          {describeError(create.error)}
        </p>
      )}
      <div className={classes.formActions}>
        <Button variant="default" onClick={onDone}>
          Cancelar
        </Button>
        <Button loading={create.isPending} onClick={() => void submit()}>
          Criar grupo
        </Button>
      </div>
    </section>
  );
}

export function OptionGroupsPage() {
  const { restaurantId } = useSessionUser();
  const groups = useOptionGroups(restaurantId);
  const usage = useOptionGroupUsage(restaurantId);
  const [creating, setCreating] = useState(false);

  // Carregando/erro só quando não há dado (a regra da 2a).
  if (groups.data === undefined) {
    return (
      <p className={classes.loading}>
        {groups.isError ? describeError(groups.error) : "Carregando grupos de opções…"}
      </p>
    );
  }

  const counts = usage.data?.counts;
  const truncated = usage.data?.truncated ?? false;

  return (
    <div className={classes.page}>
      <RuleCard />
      <div className={classes.toolbar}>
        <Button disabled={creating} onClick={() => setCreating(true)}>
          Novo grupo
        </Button>
      </div>
      {creating && <NewGroupCard restaurantId={restaurantId} onDone={() => setCreating(false)} />}
      {groups.data.length === 0 && !creating && <p className={classes.note}>Nenhum grupo cadastrado ainda.</p>}
      {groups.data.map((group) => (
        <GroupCard
          key={group.id}
          restaurantId={restaurantId}
          group={group}
          usage={counts === undefined ? undefined : (counts.get(group.id) ?? 0)}
          truncated={truncated}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/option-groups-edit.test.tsx test/option-groups-page.test.tsx`
Expected: PASS.

- [ ] **Step 7: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src/features/optionGroups apps/panel/test/option-groups-edit.test.tsx
git commit -m "feat(panel): ✨ permite criar, editar e remover grupo de opções"
```

---

### Task 8: Editar, acrescentar, remover e esgotar opção

**Files:**
- Create: `apps/panel/src/features/optionGroups/OptionRow.tsx`
- Modify: `apps/panel/src/features/optionGroups/GroupCard.tsx` (substituição inteira)
- Test: `apps/panel/test/option-rows.test.tsx`

**Interfaces:**
- Consumes: `useCreateOption`, `useUpdateOption`, `useRemoveOption`, `useToggleOptionAvailable` (Task 6); `OptionForm`, `EMPTY_OPTION_FORM`, `optionToForm`, `validateOptionForm`, `optionFormToBody`, `changedOptionPatch` (Task 5).
- Produces: `OptionRow({ restaurantId, groupId, option })`, `NewOptionRow({ restaurantId, groupId, onDone })`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/option-rows.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OptionGroupsPage } from "../src/features/optionGroups/OptionGroupsPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOptionGroup, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;
const OPTIONS = `${BASE}/option-groups/grp-1/options`;
const routes = [{ path: "/grupos-de-opcoes", element: <OptionGroupsPage /> }];

const sabores = makeOptionGroup({
  id: "grp-1",
  name: "Sabores",
  minOptions: 0,
  maxOptions: 2,
  options: [
    { id: "opt-1", name: "Margherita", priceInCents: 6200, maxQuantity: 1, available: true, position: 0 },
    { id: "opt-2", name: "Calabresa", priceInCents: 7200, maxQuantity: 1, available: true, position: 1 },
  ],
});

function setup(extra: MockHandler[]) {
  signIn();
  const api = mockApi([
    ...extra,
    { method: "GET", path: `${BASE}/option-groups`, body: { data: [sabores], limit: 100, offset: 0, total: 1 } },
    { method: "GET", path: `${BASE}/products`, body: { data: [], limit: 100, offset: 0, total: 0 } },
    ...panelHandlers(),
  ]);
  renderInPanel(routes, "/grupos-de-opcoes");
  return api;
}

describe("OptionGroupsPage (opções)", () => {
  it("editar uma linha manda o PATCH só dela, só com o que mudou", async () => {
    const api = setup([{ method: "PATCH", path: `${OPTIONS}/opt-2`, body: { ...sabores.options[1], priceInCents: 7500 } }]);
    fireEvent.click(await screen.findByRole("button", { name: "Editar Calabresa" }));
    fireEvent.change(screen.getByLabelText("Preço da opção"), { target: { value: "75,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar Calabresa" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    const patches = api.calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe(`${OPTIONS}/opt-2`);
    expect(patches[0].body).toEqual({ priceInCents: 7500 });
  });

  it("'Disponível' volta atrás e mostra o erro quando a API recusa", async () => {
    setup([
      { method: "PATCH", path: `${OPTIONS}/opt-2`, status: 500, body: { message: "Algo deu errado no servidor" } },
    ]);
    const toggle = (await screen.findByRole("switch", { name: "Disponível: Calabresa" })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(await screen.findByText("Algo deu errado no servidor")).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByRole("switch", { name: "Disponível: Calabresa" }) as HTMLInputElement).checked).toBe(true),
    );
  });

  it("opção nova com preço vazio vai como R$ 0,00", async () => {
    const api = setup([
      {
        method: "POST",
        path: OPTIONS,
        status: 201,
        body: { id: "opt-3", name: "Ao ponto", priceInCents: 0, maxQuantity: 1, available: true, position: 2 },
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar opção em Sabores" }));
    const card = within(screen.getByRole("region", { name: "Sabores" }));
    fireEvent.change(card.getByLabelText("Nome da opção"), { target: { value: "Ao ponto" } });
    fireEvent.click(card.getByRole("button", { name: "Adicionar" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
        name: "Ao ponto",
        priceInCents: 0,
        maxQuantity: 1,
      }),
    );
  });

  it("remove a opção pela linha em edição", async () => {
    const api = setup([{ method: "DELETE", path: `${OPTIONS}/opt-1`, status: 204 }]);
    fireEvent.click(await screen.findByRole("button", { name: "Editar Margherita" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover Margherita" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "DELETE")?.path).toBe(`${OPTIONS}/opt-1`),
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/option-rows.test.tsx`
Expected: FAIL — não há botão "Editar Calabresa".

- [ ] **Step 3: As linhas**

Crie `apps/panel/src/features/optionGroups/OptionRow.tsx`:

```tsx
import { Button, Switch, TextInput } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { Option } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import buttons from "../../ui/buttons.module.css";
import {
  changedOptionPatch,
  EMPTY_OPTION_FORM,
  type OptionForm,
  optionFormToBody,
  optionToForm,
  validateOptionForm,
} from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";
import { useCreateOption, useRemoveOption, useToggleOptionAvailable, useUpdateOption } from "./useOptionGroups.ts";

function OptionFields({ form, onChange }: { form: OptionForm; onChange: (form: OptionForm) => void }) {
  return (
    <>
      <TextInput
        aria-label="Nome da opção"
        placeholder="Opção"
        value={form.name}
        onChange={(event) => onChange({ ...form, name: event.currentTarget.value })}
      />
      <TextInput
        aria-label="Preço da opção"
        placeholder="0,00"
        value={form.price}
        onChange={(event) => onChange({ ...form, price: event.currentTarget.value })}
      />
      <TextInput
        aria-label="Qtd. máx. da opção"
        value={form.maxQuantity}
        onChange={(event) => onChange({ ...form, maxQuantity: event.currentTarget.value })}
      />
    </>
  );
}

function Errors({ messages }: { messages: (string | null)[] }) {
  return (
    <>
      {messages
        .filter((message): message is string => message !== null)
        .map((message) => (
          <p key={message} role="alert" className={classes.error}>
            {message}
          </p>
        ))}
    </>
  );
}

/**
 * Três controles independentes na mesma linha — salvar, remover e o
 * interruptor —, cada um com a SUA mutação (ver `CLAUDE.md`: uma instância
 * dividida perde os callbacks da chamada anterior).
 */
export function OptionRow({ restaurantId, groupId, option }: { restaurantId: string; groupId: string; option: Option }) {
  const [editing, setEditing] = useState<OptionForm | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const update = useUpdateOption(restaurantId, groupId, option.id);
  const remove = useRemoveOption(restaurantId, groupId, option.id);
  const toggle = useToggleOptionAvailable(restaurantId, groupId, option.id);

  const save = async () => {
    if (editing === null) return;
    const found = validateOptionForm(editing);
    setProblem(found);
    if (found !== null) return;
    const patch = changedOptionPatch(editing, option);
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    try {
      await update.mutateAsync(patch);
      setEditing(null);
    } catch {
      // A mensagem sai de `update.error`.
    }
  };

  const errors = [
    problem,
    update.isError ? describeError(update.error) : null,
    remove.isError ? describeError(remove.error) : null,
    toggle.isError ? describeError(toggle.error) : null,
  ];

  if (editing !== null) {
    return (
      <li>
        <div className={classes.tr}>
          <OptionFields form={editing} onChange={setEditing} />
          <span />
          <span />
        </div>
        <div className={classes.formActions}>
          <Button
            variant="subtle"
            className={buttons.dangerText}
            aria-label={`Remover ${option.name}`}
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remover
          </Button>
          <Button
            variant="default"
            onClick={() => {
              setEditing(null);
              setProblem(null);
            }}
          >
            Cancelar
          </Button>
          <Button aria-label={`Salvar ${option.name}`} loading={update.isPending} onClick={() => void save()}>
            Salvar
          </Button>
        </div>
        <Errors messages={errors} />
      </li>
    );
  }

  return (
    <li>
      <div className={classes.tr}>
        <span className={classes.cell}>{option.name}</span>
        <span className={`${classes.cell} ${classes.price} n`}>{formatCents(option.priceInCents)}</span>
        <span className={`${classes.cell} n`}>{option.maxQuantity}</span>
        <Switch
          aria-label={`Disponível: ${option.name}`}
          checked={option.available}
          onChange={(event) => toggle.mutate(event.currentTarget.checked)}
        />
        <Button
          variant="subtle"
          aria-label={`Editar ${option.name}`}
          onClick={() => {
            update.reset();
            remove.reset();
            setProblem(null);
            setEditing(optionToForm(option));
          }}
        >
          Editar
        </Button>
      </div>
      <Errors messages={errors} />
    </li>
  );
}

export function NewOptionRow({
  restaurantId,
  groupId,
  onDone,
}: {
  restaurantId: string;
  groupId: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState<OptionForm>(EMPTY_OPTION_FORM);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useCreateOption(restaurantId, groupId);

  const submit = async () => {
    const found = validateOptionForm(form);
    setProblem(found);
    if (found !== null) return;
    try {
      await create.mutateAsync(optionFormToBody(form));
      onDone();
    } catch {
      // A mensagem sai de `create.error`.
    }
  };

  return (
    <li>
      <div className={classes.tr}>
        <OptionFields form={form} onChange={setForm} />
        <span />
        <span />
      </div>
      <div className={classes.formActions}>
        <Button variant="default" onClick={onDone}>
          Cancelar
        </Button>
        <Button loading={create.isPending} onClick={() => void submit()}>
          Adicionar
        </Button>
      </div>
      <Errors messages={[problem, create.isError ? describeError(create.error) : null]} />
    </li>
  );
}
```

- [ ] **Step 4: O cartão com as linhas**

Substitua `apps/panel/src/features/optionGroups/GroupCard.tsx` por:

```tsx
import { Button } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { OptionGroup } from "../../api/types.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Notice } from "../../ui/Notice.tsx";
import { GroupFields } from "./GroupFields.tsx";
import {
  changedGroupPatch,
  type GroupForm,
  groupToForm,
  RULE_NAMES,
  rangeLabel,
  removeGroupCopy,
  unreachable,
  unreachableMessage,
  usageLabel,
  validateGroupForm,
} from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";
import { NewOptionRow, OptionRow } from "./OptionRow.tsx";
import { useRemoveOptionGroup, useUpdateOptionGroup } from "./useOptionGroups.ts";

export function GroupCard({
  restaurantId,
  group,
  usage,
  truncated,
}: {
  restaurantId: string;
  group: OptionGroup;
  usage: number | undefined;
  truncated: boolean;
}) {
  const [editing, setEditing] = useState<GroupForm | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);
  // Cabeçalho e remoção são controles independentes: cada um com a sua mutação.
  const update = useUpdateOptionGroup(restaurantId, group.id);
  const remove = useRemoveOptionGroup(restaurantId, group.id);
  const gap = unreachable(group);

  const save = async () => {
    if (editing === null) return;
    const found = validateGroupForm(editing);
    setProblem(found);
    if (found !== null) return;
    const patch = changedGroupPatch(editing, group);
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    try {
      await update.mutateAsync(patch);
      setEditing(null);
    } catch {
      // A mensagem da API (409 de nome repetido, por exemplo) sai de `update.error`.
    }
  };

  const confirmRemove = async () => {
    try {
      await remove.mutateAsync();
    } catch {
      setConfirming(false);
    }
  };

  return (
    <section className={classes.group} aria-label={group.name}>
      {editing === null ? (
        <header className={classes.groupHead}>
          <h2 className={classes.groupName}>{group.name}</h2>
          <span className={`${classes.pill} n`}>{rangeLabel(group)}</span>
          <span className={`${classes.pill} ${classes.rulePill}`}>{RULE_NAMES[group.priceRule]}</span>
          <span className={`${classes.usage} n`}>{usageLabel(usage, truncated)}</span>
          <div className={classes.headActions}>
            <Button
              variant="subtle"
              aria-label={`Editar grupo ${group.name}`}
              onClick={() => {
                update.reset();
                setProblem(null);
                setEditing(groupToForm(group));
              }}
            >
              Editar
            </Button>
            <Button
              variant="subtle"
              className={buttons.dangerText}
              aria-label={`Remover grupo ${group.name}`}
              onClick={() => {
                remove.reset();
                setConfirming(true);
              }}
            >
              Remover grupo
            </Button>
          </div>
        </header>
      ) : (
        <div>
          <GroupFields form={editing} onChange={setEditing} />
          <div className={classes.formActions}>
            <Button
              variant="default"
              onClick={() => {
                setEditing(null);
                setProblem(null);
              }}
            >
              Cancelar
            </Button>
            <Button loading={update.isPending} onClick={() => void save()}>
              Salvar grupo
            </Button>
          </div>
        </div>
      )}

      {problem !== null && (
        <p role="alert" className={classes.error}>
          {problem}
        </p>
      )}
      {update.isError && (
        <p role="alert" className={classes.error}>
          {describeError(update.error)}
        </p>
      )}
      {remove.isError && (
        <p role="alert" className={classes.error}>
          {describeError(remove.error)}
        </p>
      )}

      {gap !== null && <Notice tone="warn">{unreachableMessage(gap)}</Notice>}

      <div className={classes.table}>
        <div className={`${classes.tr} ${classes.th}`}>
          <span>Opção</span>
          <span className={classes.price}>Preço</span>
          <span>Qtd. máx.</span>
          <span>Disponível</span>
          <span />
        </div>
        {group.options.length === 0 && !adding && <p className={classes.noOptions}>Nenhuma opção cadastrada.</p>}
        <ul className={classes.rows}>
          {group.options.map((option) => (
            <OptionRow key={option.id} restaurantId={restaurantId} groupId={group.id} option={option} />
          ))}
          {adding && <NewOptionRow restaurantId={restaurantId} groupId={group.id} onDone={() => setAdding(false)} />}
        </ul>
        {!adding && (
          <button
            type="button"
            className={classes.dashed}
            aria-label={`Adicionar opção em ${group.name}`}
            onClick={() => setAdding(true)}
          >
            + Adicionar opção
          </button>
        )}
      </div>

      <ConfirmDialog
        copy={confirming ? removeGroupCopy(group.name, usage, truncated) : null}
        busy={remove.isPending}
        onConfirm={() => void confirmRemove()}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/option-rows.test.tsx test/option-groups-edit.test.tsx test/option-groups-page.test.tsx`
Expected: PASS. O teste de leitura da Task 6 continua passando: "Calabresa" e o preço seguem na linha.

- [ ] **Step 6: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src/features/optionGroups apps/panel/test/option-rows.test.tsx
git commit -m "feat(panel): ✨ permite editar, esgotar e remover opção"
```

---

### Task 9: Documentação e verificação final

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-21-painel-entrega-opcoes-parte-2b-design.md`

- [ ] **Step 1: `CLAUDE.md`**

Na seção `### Painel da loja (\`apps/panel\`)`, acrescente ao fim da lista, antes de `### Monorepo`:

```markdown
- **Entrega salva os bairros ANTES do restaurante** (`features/settings/DeliveryPage.tsx`): trocar para "por bairro" antes de a lista existir faria a loja recusar entrega por um instante. A sujeira é medida contra o cache, então um `PATCH` que falha depois de um `PUT` que deu certo deixa a barra suja só no que faltou.
- ⚠️ **"Entrega grátis acima de" vazio vai como `null`, nunca 0**: zero seria "grátis acima de R$ 0", sempre grátis. É o `nullable: true` do `PATCH` da API (F12).
- **"usado em N produtos" é contado no painel** (`features/optionGroups/optionGroups.ts`), percorrendo os `optionGroupIds` de todos os produtos — provisório, até a API ter o campo calculado no SQL. A query mora sob `["products", restaurantId]`, para toda invalidação de produto refazer a contagem.
```

Na seção "O que é", troque `(\`apps/panel\` — acesso, pedidos, cardápio, e a configuração de modalidades, horário e dados da loja)` por `(\`apps/panel\` — acesso, pedidos, cardápio com grupos de opções, e a configuração de modalidades, entrega, horário e dados da loja)`.

- [ ] **Step 2: A spec**

Em `docs/superpowers/specs/2026-09-21-painel-entrega-opcoes-parte-2b-design.md`:

1. Troque `**Estado:** aprovado, não implementado (branch \`feat/painel-entrega-opcoes\`)` por `**Estado:** implementado (branch \`feat/painel-entrega-opcoes\`)`.
2. Na seção "Ligações com o que já existe", troque a frase `Como Modalidades e Entrega reusam o mesmo componente, o botão aparece nas três telas.` por `Na própria tela de Entrega o botão não aparece (\`withAction={false}\`): apontaria para a tela em que a pessoa já está.`
3. Na mesma seção, troque o item do formulário de produto por: `O formulário de produto transforma "Grupos de opções", na nota que já existia, em link para \`/grupos-de-opcoes\` — sempre, o que cobre o caso da loja sem grupo nenhum sem uma condição a mais.`
4. Na tabela "Onde a implementação diverge do handoff", acrescente duas linhas:

```markdown
| Placeholder "Sem entrega grátis" no campo "Entrega grátis acima de" | O handoff não diz o que o campo vazio significa; sem a dica, ninguém descobre que em branco desliga a promoção |
| Rótulo "sem produtos" / "usado em pelo menos N produtos" | O protótipo só tem "usado em N produtos"; zero e contagem interrompida (mais de 2.000 produtos) precisam de texto próprio |
```

- [ ] **Step 3: Verificação completa**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm lint
pnpm build
pnpm --filter @menuclick/panel test
```

Expected: lint limpo, build dos apps, e a suíte do painel passando (225 antes deste plano, mais os desta parte). A API não muda nesta parte.

- [ ] **Step 4: Conferência manual (o que sobra para o humano)**

Com `pnpm dev` de pé, liste no relatório o que não dá para conferir sem navegador:

1. **Entrega** — trocar para "por bairro", cadastrar dois bairros, salvar e ver o aviso do kanban sumir; esvaziar "grátis acima de" e ver o anúncio do cardápio público sumir; derrubar a API no meio do salvar e ver a barra continuar suja.
2. **Grupos de opções** — criar "Borda", acrescentar duas opções, marcar uma como indisponível; subir o mínimo acima das disponíveis e ver o aviso; remover um grupo usado em produtos e conferir a contagem no diálogo.
3. **Ligações** — "Configurar entrega" no kanban e em Modalidades; o link do formulário de produto.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-21-painel-entrega-opcoes-parte-2b-design.md
git commit -m "docs(panel): 📝 documenta entrega e grupos de opções"
```
