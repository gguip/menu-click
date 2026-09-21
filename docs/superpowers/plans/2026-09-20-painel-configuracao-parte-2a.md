# Painel da loja, parte 2a — configuração direta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A loja passa a configurar pelo painel o que decide se o pedido chega: quais modalidades e formas de pagamento aceita, que horas abre, e os próprios dados de identificação.

**Architecture:** Três telas novas dentro da casca que já existe, num grupo "Configuração" no rail. Modalidades e Dados da loja escrevem por `PATCH /restaurants/:id` e leem a query que a casca já mantém; o horário é outro recurso, com `PUT` que substitui a grade inteira. A regra da grade mora num módulo puro (`openingHours.ts`), e a barra de salvar sai de dentro do formulário de produto para `src/ui/`, onde as três telas a usam.

**Tech Stack:** React 19, Mantine 9, React Router 8, TanStack Query 5, TypeScript 7, Vitest 4 + Testing Library + jsdom. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-20-painel-configuracao-parte-2a-design.md` — a autoridade. A parte 1 (`…/2026-09-19-painel-da-loja-parte-1-design.md`) segue valendo para tudo que já existe.

## Global Constraints

- **Branch `feat/painel-configuracao`**, a partir da `main` com a parte 1 mergeada. Não mexa em `apps/api`. Não faça push.
- **Shell:** `node`/`pnpm` podem ser funções do nvm que recursam — comece cada comando que os use com `unset -f node npm npx pnpm nvm 2>/dev/null;`.
- **Sem dependência nova.** Tudo o que este plano precisa já está instalado.
- **Copy em pt-BR, literal do handoff** (`docs/design/painel-da-loja/README.md`, telas 11, 13 e 15). Os desvios permitidos são só os que a spec lista (vale-refeição, aviso em vez de trava, slug desabilitado, lista fechada de fusos, confirmação digitando o nome).
- **Cor só por `var(--mc-*)`.** Sem sombra, sem gradiente, sem transição, sem animação.
- **Todo número na tela leva a classe `n`** (tabular-nums).
- **Toda chamada à API passa por `apiRequest`** (`src/api/client.ts`). Nunca `fetch` direto.
- **Sem efeito colateral dentro de um `queryFn`** do TanStack Query.
- **Mantine 9, lições da parte 1:** `label` + `description` entram juntos no nome acessível — fixe o nome com `aria-label` igual ao rótulo visível quando um teste precisar; `Modal`/`Drawer` renderizam no lugar sob `env="test"`; `getByText` da Testing Library casa só com o texto direto de um elemento.
- **Nunca desligue regra de lint**; nunca edite a copy esperada de um teste para ele passar (a exceção é a Task 9, que corrige uma copy errada — e só ali).
- **Commits:** `<tipo>(<escopo>): <emoji> <mensagem>`, pt-BR, presente do indicativo, minúscula, sem ponto final. Sem trailer de coautoria.
- **Verificação de cada task:** `pnpm --filter @menuclick/panel test`, `pnpm --filter @menuclick/panel build` e `pnpm lint`, todos limpos. A suíte do painel está em **176 testes** no começo deste plano.

---

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `src/ui/SaveBar.tsx`, `SaveBar.module.css` | a barra fixa de salvar, compartilhada (sai do formulário de produto) |
| `src/api/restaurant.ts` | ganha `RestaurantPatch` e `deleteRestaurant` |
| `src/features/restaurant/useRestaurant.ts` | ganha `useUpdateRestaurant` e `useToggleRestaurantFlag` (otimista) |
| `src/api/openingHours.ts` | `GET`/`PUT` da grade |
| `src/features/settings/openingHours.ts` | a regra pura da grade (dias, faixas, validação, tradução) |
| `src/features/settings/useOpeningHours.ts` | query e mutação da grade |
| `src/features/settings/ModalitiesPage.tsx` + `.module.css` | Modalidades e pagamento |
| `src/features/settings/OpeningHoursPage.tsx` + `.module.css` | Horário de funcionamento |
| `src/features/settings/StoreDataPage.tsx` + `.module.css` | Dados da loja |
| `src/features/settings/storeForm.ts` | o formulário de Dados da loja em forma pura |
| `src/features/settings/timezones.ts` | a lista fechada de fusos |
| `src/features/settings/DangerZone.tsx` | remover o restaurante (só `owner`) |
| `src/router.tsx`, `src/layout/Rail.tsx` | as três rotas e o grupo "Configuração" |
| `test/*` | um arquivo por tela, mais `openingHours.test.ts` e `storeForm.test.ts` |

---

### Task 1: `SaveBar` compartilhada

**Files:**
- Create: `apps/panel/src/ui/SaveBar.tsx`, `apps/panel/src/ui/SaveBar.module.css`
- Modify: `apps/panel/src/features/products/ProductFormPage.tsx`, `apps/panel/src/features/products/ProductFormPage.module.css`
- Test: `apps/panel/test/save-bar.test.tsx`

**Interfaces:**
- Produces: `SaveBar({ dirty, busy?, saveLabel, onSave, cancel })` onde `cancel` é `{ to: string }` (vira um link) **ou** `{ onClick: () => void }` (vira um botão).

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/save-bar.test.tsx`:

```tsx
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SaveBar } from "../src/ui/SaveBar.tsx";

function renderBar(ui: React.ReactElement) {
  return render(<MantineProvider env="test">{ui}</MantineProvider>);
}

describe("SaveBar", () => {
  it("só avisa de alteração quando há alteração", () => {
    const { rerender } = renderBar(
      <SaveBar dirty={false} saveLabel="Salvar" onSave={() => {}} cancel={{ onClick: () => {} }} />,
    );
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    rerender(
      <MantineProvider env="test">
        <SaveBar dirty saveLabel="Salvar" onSave={() => {}} cancel={{ onClick: () => {} }} />
      </MantineProvider>,
    );
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
  });

  it("chama onSave e onClick do cancelar", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    renderBar(<SaveBar dirty saveLabel="Salvar horário" onSave={onSave} cancel={{ onClick: onCancel }} />);
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- save-bar`
Expected: FAIL — `src/ui/SaveBar.tsx` não existe.

- [ ] **Step 3: Criar a `SaveBar`**

`apps/panel/src/ui/SaveBar.module.css` (os dois blocos saem de `ProductFormPage.module.css`, sem mudar valor nenhum):

```css
.saveBar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px;
  background: var(--mc-surface);
  border-top: 1px solid var(--mc-line);
}

.dirty {
  margin-right: auto;
  font-size: 13px;
  color: var(--mc-ink3);
}
```

`apps/panel/src/ui/SaveBar.tsx`:

```tsx
import { Button } from "@mantine/core";
import { Link } from "react-router";
import classes from "./SaveBar.module.css";

/**
 * Barra fixa de salvar. Em telas que são uma página só (Horário, Dados da
 * loja) cancelar DESCARTA as alterações; no formulário de produto ele volta
 * para a listagem — daí o cancelamento ser link ou botão.
 */
export function SaveBar({
  dirty,
  busy = false,
  saveLabel,
  onSave,
  cancel,
}: {
  dirty: boolean;
  busy?: boolean;
  saveLabel: string;
  onSave: () => void;
  cancel: { to: string } | { onClick: () => void };
}) {
  return (
    <div className={classes.saveBar}>
      {dirty && <span className={classes.dirty}>Alterações não salvas</span>}
      {"to" in cancel ? (
        <Button component={Link} to={cancel.to} variant="default">
          Cancelar
        </Button>
      ) : (
        <Button variant="default" onClick={cancel.onClick}>
          Cancelar
        </Button>
      )}
      <Button loading={busy} onClick={onSave}>
        {saveLabel}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Fazer o formulário de produto usar a barra**

Em `apps/panel/src/features/products/ProductFormPage.tsx`, importe:

```tsx
import { SaveBar } from "../../ui/SaveBar.tsx";
```

e troque o bloco `<div className={classes.saveBar}> … </div>` por:

```tsx
      <SaveBar
        dirty={isDirty(form, initial)}
        busy={save.isPending}
        saveLabel="Salvar produto"
        onSave={submit}
        cancel={{ to: "/produtos" }}
      />
```

Em `apps/panel/src/features/products/ProductFormPage.module.css`, apague os blocos `.saveBar` e `.dirty` (eles agora moram em `SaveBar.module.css`).

- [ ] **Step 5: Rodar tudo**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS. **Os testes do formulário de produto são o que prende esta extração** — se algum falhar, a barra mudou de comportamento.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/ui apps/panel/src/features/products apps/panel/test/save-bar.test.tsx
git commit -m "refactor(panel): ♻️ extrai a barra de salvar para ui"
```

---

### Task 2: `PATCH` do restaurante para qualquer campo

**Files:**
- Modify: `apps/panel/src/api/restaurant.ts`, `apps/panel/src/features/restaurant/useRestaurant.ts`
- Test: `apps/panel/test/restaurant-api.test.ts`

**Interfaces:**
- Produces:
  - `type RestaurantPatch` — subconjunto editável nesta parte (identificação, endereço, modalidades, pagamento, fuso, `acceptingOrders`).
  - `useUpdateRestaurant(id)` — mutação que grava a resposta no cache (`restaurantQueryKey(id)`).
  - `useToggleRestaurantFlag(id)` — mutação **otimista**: aplica no cache antes da resposta e volta atrás no erro.
- Consumes: `restaurantQueryKey`, `getRestaurant` (já existem).

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/restaurant-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { updateRestaurant } from "../src/api/restaurant.ts";
import { mockApi } from "./api-mock.ts";
import { makeRestaurant, RESTAURANT_ID } from "./fixtures.ts";

describe("updateRestaurant", () => {
  it("manda só os campos recebidos", async () => {
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant() },
    ]);
    await updateRestaurant(RESTAURANT_ID, { acceptsMealVoucher: true, timezone: "America/Bahia" });
    expect(api.calls[0].body).toEqual({ acceptsMealVoucher: true, timezone: "America/Bahia" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- restaurant-api`
Expected: FAIL — `updateRestaurant` só aceita `{ acceptingOrders: boolean }`, então o type-check do teste quebra.

- [ ] **Step 3: Alargar a API**

Em `apps/panel/src/api/restaurant.ts`, troque o arquivo por:

```ts
import { apiRequest } from "./client.ts";
import type { Address, Restaurant } from "./types.ts";

/**
 * O que o painel edita HOJE no restaurante. Os campos de entrega
 * (`deliveryFeeMode`, `deliveryFixedFeeInCents`, `freeDeliveryAboveInCents`,
 * `deliveryFeeToArrange`, `minimumOrderInCents`) entram na parte 2b, com a
 * tela que os explica. O `slug` não está aqui porque a API não o aceita: é a
 * URL dentro do QR code impresso.
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
}>;

export function getRestaurant(id: string): Promise<Restaurant> {
  return apiRequest<Restaurant>(`/restaurants/${id}`);
}

export function updateRestaurant(id: string, patch: RestaurantPatch): Promise<Restaurant> {
  return apiRequest<Restaurant>(`/restaurants/${id}`, { method: "PATCH", body: patch });
}
```

- [ ] **Step 4: Os dois hooks**

Acrescente ao fim de `apps/panel/src/features/restaurant/useRestaurant.ts` (e troque o import para trazer `RestaurantPatch`):

```ts
import type { RestaurantPatch } from "../../api/restaurant.ts";
import type { Restaurant } from "../../api/types.ts";
```

```ts
/** Salvar um formulário inteiro: a resposta da API vira o novo cache. */
export function useUpdateRestaurant(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: RestaurantPatch) => updateRestaurant(id, patch),
    onSuccess: (restaurant) => queryClient.setQueryData(restaurantQueryKey(id), restaurant),
  });
}

/**
 * Interruptor: o estado novo aparece na hora e VOLTA ATRÁS se a API recusar.
 * Sem isso, o controle fica parado esperando a resposta e a pessoa clica de
 * novo achando que não pegou.
 */
export function useToggleRestaurantFlag(id: string) {
  const queryClient = useQueryClient();
  const key = restaurantQueryKey(id);
  return useMutation({
    mutationFn: (patch: RestaurantPatch) => updateRestaurant(id, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Restaurant>(key);
      if (previous !== undefined) queryClient.setQueryData(key, { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (restaurant) => queryClient.setQueryData(key, restaurant),
  });
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS (o `PauseSwitch` continua usando `useSetAcceptingOrders`, que não mudou).

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/api/restaurant.ts apps/panel/src/features/restaurant/useRestaurant.ts apps/panel/test/restaurant-api.test.ts
git commit -m "feat(panel): ✨ permite editar qualquer campo do restaurante"
```

---

### Task 3: Modalidades e pagamento

**Files:**
- Create: `apps/panel/src/features/settings/ModalitiesPage.tsx`, `apps/panel/src/features/settings/ModalitiesPage.module.css`
- Modify: `apps/panel/src/router.tsx`, `apps/panel/src/layout/Rail.tsx`
- Test: `apps/panel/test/modalities-page.test.tsx`

**Interfaces:**
- Consumes: `useSessionUser`, `useRestaurant`, `useToggleRestaurantFlag` (Task 2), `useDeliveryAlert` (parte 1, em `features/orders/useOrders.ts`), `Notice`.
- Produces: `ModalitiesPage`; o grupo "Configuração" no rail.

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/modalities-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModalitiesPage } from "../src/features/settings/ModalitiesPage.tsx";
import { mockApi } from "./api-mock.ts";
import { makeRestaurant, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const routes = [{ path: "/modalidades", element: <ModalitiesPage /> }];

function toggle(name: string) {
  return screen.getByRole("switch", { name });
}

describe("ModalitiesPage", () => {
  it("liga o vale-refeição e manda só esse campo", async () => {
    signIn();
    const api = mockApi([
      {
        method: "PATCH",
        path: `/restaurants/${RESTAURANT_ID}`,
        body: makeRestaurant({ acceptsMealVoucher: true }),
      },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/modalidades");
    fireEvent.click(await screen.findByRole("switch", { name: "Vale-refeição" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ acceptsMealVoucher: true }),
    );
    expect((toggle("Vale-refeição") as HTMLInputElement).checked).toBe(true);
  });

  it("falha da API volta o interruptor e mostra o erro", async () => {
    signIn();
    mockApi([
      {
        method: "PATCH",
        path: `/restaurants/${RESTAURANT_ID}`,
        status: 500,
        body: { message: "Algo deu errado no servidor" },
      },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/modalidades");
    const pix = await screen.findByRole("switch", { name: "Pix" });
    expect((pix as HTMLInputElement).checked).toBe(true);
    fireEvent.click(pix);
    expect(await screen.findByText("Algo deu errado no servidor")).toBeTruthy();
    await waitFor(() => expect((toggle("Pix") as HTMLInputElement).checked).toBe(true));
  });

  it("sem nenhuma modalidade ligada, avisa", async () => {
    signIn();
    mockApi(
      panelHandlers({ restaurant: { isDelivery: false, isTakeaway: false, isQrcode: false } }),
    );
    renderInPanel(routes, "/modalidades");
    expect(
      await screen.findByText(
        "Sem nenhuma modalidade ligada a loja não recebe pedido nenhum, mesmo dentro do horário. Ao menos uma precisa ficar ativa.",
      ),
    ).toBeTruthy();
  });

  it("entrega ligada com modo bairro e nenhum bairro avisa que o pedido será recusado", async () => {
    signIn();
    mockApi([
      {
        method: "GET",
        path: `/restaurants/${RESTAURANT_ID}/delivery-neighborhoods`,
        body: { neighborhoods: [] },
      },
      ...panelHandlers({ restaurant: { isDelivery: true, deliveryFeeMode: "neighborhood" } }),
    ]);
    renderInPanel(routes, "/modalidades");
    expect(await screen.findByText("Entrega ligada, mas o frete não está configurado")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- modalities-page`
Expected: FAIL — `ModalitiesPage.tsx` não existe.

- [ ] **Step 3: Estilos**

`apps/panel/src/features/settings/ModalitiesPage.module.css`:

```css
.page {
  display: grid;
  gap: 16px;
  max-width: 720px;
  padding: 18px 20px;
}

.card {
  display: grid;
  gap: 16px;
  padding: 18px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.cardTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.row {
  display: grid;
  gap: 4px;
}

.error {
  margin: 0;
  font-size: 12.5px;
  color: var(--mc-danger);
}
```

- [ ] **Step 4: A tela**

`apps/panel/src/features/settings/ModalitiesPage.tsx`:

```tsx
import { Switch } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { RestaurantPatch } from "../../api/restaurant.ts";
import type { Restaurant } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { Notice } from "../../ui/Notice.tsx";
import { useDeliveryAlert } from "../orders/useOrders.ts";
import { useRestaurant, useToggleRestaurantFlag } from "../restaurant/useRestaurant.ts";
import classes from "./ModalitiesPage.module.css";

type FlagField = keyof Pick<
  Restaurant,
  | "isDelivery"
  | "isTakeaway"
  | "isQrcode"
  | "acceptsPix"
  | "acceptsCardOnDelivery"
  | "acceptsCash"
  | "acceptsMealVoucher"
>;

type Flag = { field: FlagField; label: string; help: string };

const MODALITIES: readonly Flag[] = [
  { field: "isDelivery", label: "Entrega", help: "Frete e área atendida ficam na tela de Entrega" },
  { field: "isTakeaway", label: "Retirada no balcão", help: "O cliente busca no endereço da loja" },
  { field: "isQrcode", label: "Salão", help: "Pedido pela mesa, com QR code" },
];

const PAYMENTS: readonly Flag[] = [
  { field: "acceptsPix", label: "Pix", help: "Pago antes da confirmação" },
  { field: "acceptsCardOnDelivery", label: "Cartão", help: "Na entrega ou no caixa" },
  { field: "acceptsCash", label: "Dinheiro", help: "Habilita o campo de troco no pedido" },
  // Não está no handoff (que desenhou três formas), mas a API tem a flag e sem
  // o interruptor a loja não teria como ligá-la em lugar nenhum.
  {
    field: "acceptsMealVoucher",
    label: "Vale-refeição",
    help: "Exige credenciamento com a bandeira — ligue só se a loja já aceita",
  },
];

export function ModalitiesPage() {
  const { restaurantId } = useSessionUser();
  const restaurant = useRestaurant(restaurantId);
  const toggle = useToggleRestaurantFlag(restaurantId);
  const [failed, setFailed] = useState<FlagField | null>(null);
  const deliveryAlert = useDeliveryAlert(restaurantId, restaurant.data);

  const data = restaurant.data;
  if (data === undefined) return null;

  const change = (field: FlagField, checked: boolean) => {
    setFailed(null);
    const patch = { [field]: checked } as RestaurantPatch;
    toggle.mutate(patch, { onError: () => setFailed(field) });
  };

  const noModality = !data.isDelivery && !data.isTakeaway && !data.isQrcode;

  const renderFlag = (flag: Flag) => (
    <div key={flag.field} className={classes.row}>
      <Switch
        label={flag.label}
        description={flag.help}
        aria-label={flag.label}
        checked={data[flag.field]}
        onChange={(event) => change(flag.field, event.currentTarget.checked)}
      />
      {failed === flag.field && toggle.error !== null && (
        <p role="alert" className={classes.error}>
          {describeError(toggle.error)}
        </p>
      )}
    </div>
  );

  return (
    <div className={classes.page}>
      <section className={classes.card}>
        <h2 className={classes.cardTitle}>Modalidades</h2>
        {MODALITIES.map(renderFlag)}
      </section>

      {noModality && (
        <Notice tone="warn">
          Sem nenhuma modalidade ligada a loja não recebe pedido nenhum, mesmo dentro do horário. Ao
          menos uma precisa ficar ativa.
        </Notice>
      )}

      {data.isDelivery && deliveryAlert && (
        <Notice tone="warn" title="Entrega ligada, mas o frete não está configurado">
          O modo é por bairro e nenhum bairro está cadastrado: a loja recusa todo pedido de entrega até
          a tela de Entrega ser preenchida.
        </Notice>
      )}

      <section className={classes.card}>
        <h2 className={classes.cardTitle}>Pagamento</h2>
        {PAYMENTS.map(renderFlag)}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Rota e rail**

Em `apps/panel/src/router.tsx`, importe e acrescente a rota dentro do `PanelLayout`, depois de `/secoes`:

```tsx
import { ModalitiesPage } from "./features/settings/ModalitiesPage.tsx";
```

```tsx
              {
                path: "/modalidades",
                handle: { title: "Modalidades e pagamento" },
                element: <ModalitiesPage />,
              },
```

Em `apps/panel/src/layout/Rail.tsx`, acrescente o segundo grupo ao `NAV_GROUPS` (Horário e Dados da loja entram nas tasks 5 e 6):

```tsx
  {
    title: "Configuração",
    items: [{ to: "/modalidades", label: "Modalidades" }],
  },
```

- [ ] **Step 6: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src apps/panel/test/modalities-page.test.tsx
git commit -m "feat(panel): ✨ adiciona modalidades e formas de pagamento"
```

---

### Task 4: A grade de horário em forma pura

**Files:**
- Create: `apps/panel/src/features/settings/openingHours.ts`
- Modify: `apps/panel/src/api/types.ts`
- Test: `apps/panel/test/openingHours.test.ts`

**Interfaces:**
- Produces:
  - `type OpeningHour = { id: string; weekday: number; opensAt: string; closesAt: string }` (em `api/types.ts`)
  - `type Range = { opensAt: string; closesAt: string }`, `type Day = { weekday: number; label: string; ranges: Range[] }`
  - `WEEK` (segunda→domingo, com o `weekday` da API), `fromApi(hours): Day[]`, `toApi(days): { weekday; opensAt; closesAt }[]`, `addRange(days, weekday)`, `removeRange(days, weekday, index)`, `setRangeTime(days, weekday, index, field, value)`, `crossesMidnight(range)`, `daySummary(day)`, `validate(days): string | null`

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/openingHours.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addRange,
  crossesMidnight,
  daySummary,
  fromApi,
  removeRange,
  setRangeTime,
  toApi,
  validate,
  WEEK,
} from "../src/features/settings/openingHours.ts";

const API = [
  { id: "1", weekday: 1, opensAt: "11:30", closesAt: "15:00" },
  { id: "2", weekday: 1, opensAt: "18:00", closesAt: "23:30" },
  { id: "3", weekday: 6, opensAt: "18:00", closesAt: "02:00" },
];

describe("grade de horário", () => {
  it("mostra a semana da segunda ao domingo, com a numeração da API", () => {
    expect(WEEK.map((day) => [day.weekday, day.label])).toEqual([
      [1, "Segunda"],
      [2, "Terça"],
      [3, "Quarta"],
      [4, "Quinta"],
      [5, "Sexta"],
      [6, "Sábado"],
      [0, "Domingo"],
    ]);
  });

  it("agrupa as faixas por dia e devolve todos os sete", () => {
    const days = fromApi(API);
    expect(days).toHaveLength(7);
    expect(days[0].ranges).toEqual([
      { opensAt: "11:30", closesAt: "15:00" },
      { opensAt: "18:00", closesAt: "23:30" },
    ]);
    expect(days[6].ranges).toEqual([]);
  });

  it("volta para a API sem os dias fechados", () => {
    expect(toApi(fromApi(API))).toEqual([
      { weekday: 1, opensAt: "11:30", closesAt: "15:00" },
      { weekday: 1, opensAt: "18:00", closesAt: "23:30" },
      { weekday: 6, opensAt: "18:00", closesAt: "02:00" },
    ]);
  });

  it("acrescenta, muda e remove faixa sem mutar", () => {
    const days = fromApi([]);
    const withOne = addRange(days, 3);
    expect(withOne[2].ranges).toEqual([{ opensAt: "", closesAt: "" }]);
    expect(days[2].ranges).toEqual([]);
    const filled = setRangeTime(setRangeTime(withOne, 3, 0, "opensAt", "18:00"), 3, 0, "closesAt", "23:00");
    expect(filled[2].ranges).toEqual([{ opensAt: "18:00", closesAt: "23:00" }]);
    expect(removeRange(filled, 3, 0)[2].ranges).toEqual([]);
  });

  it("reconhece a faixa que vira a madrugada", () => {
    expect(crossesMidnight({ opensAt: "18:00", closesAt: "02:00" })).toBe(true);
    expect(crossesMidnight({ opensAt: "11:30", closesAt: "15:00" })).toBe(false);
    expect(crossesMidnight({ opensAt: "18:00", closesAt: "" })).toBe(false);
  });

  it("resume o dia", () => {
    const days = fromApi(API);
    expect(daySummary(days[0])).toBe("2 faixas");
    expect(daySummary(days[5])).toBe("Aberto");
    expect(daySummary(days[6])).toBe("Fechado");
  });

  it("valida só o que a API recusa, nomeando o dia", () => {
    expect(validate(fromApi(API))).toBeNull();
    // sobreposição NÃO é erro para a API: a tela não inventa a regra
    const overlapping = addRange(fromApi(API), 1);
    const filled = setRangeTime(
      setRangeTime(overlapping, 1, 2, "opensAt", "12:00"),
      1,
      2,
      "closesAt",
      "14:00",
    );
    expect(validate(filled)).toBeNull();

    const incomplete = addRange(fromApi([]), 2);
    expect(validate(incomplete)).toBe("Preencha as duas horas da faixa de terça.");

    const equal = setRangeTime(
      setRangeTime(addRange(fromApi([]), 5), 5, 0, "opensAt", "19:00"),
      5,
      0,
      "closesAt",
      "19:00",
    );
    expect(validate(equal)).toBe("A faixa de sexta começa e termina no mesmo horário.");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- openingHours`
Expected: FAIL — o módulo não existe.

- [ ] **Step 3: O tipo da API**

Acrescente a `apps/panel/src/api/types.ts`, junto dos outros tipos:

```ts
/** Uma faixa de funcionamento. `opensAt`/`closesAt` são hora de parede, "HH:MM". */
export type OpeningHour = { id: string; weekday: number; opensAt: string; closesAt: string };
```

- [ ] **Step 4: O módulo puro**

`apps/panel/src/features/settings/openingHours.ts`:

```ts
import type { OpeningHour } from "../../api/types.ts";

export type Range = { opensAt: string; closesAt: string };
export type Day = { weekday: number; label: string; ranges: Range[] };

/**
 * A API numera `0 = domingo` (é o `dow` do Postgres) e a tela mostra a semana
 * começando na segunda, como o handoff. A conversão mora AQUI, num lugar só.
 */
export const WEEK: readonly { weekday: number; label: string }[] = [
  { weekday: 1, label: "Segunda" },
  { weekday: 2, label: "Terça" },
  { weekday: 3, label: "Quarta" },
  { weekday: 4, label: "Quinta" },
  { weekday: 5, label: "Sexta" },
  { weekday: 6, label: "Sábado" },
  { weekday: 0, label: "Domingo" },
];

export function fromApi(hours: readonly OpeningHour[]): Day[] {
  return WEEK.map((day) => ({
    weekday: day.weekday,
    label: day.label,
    ranges: hours
      .filter((hour) => hour.weekday === day.weekday)
      .map((hour) => ({ opensAt: hour.opensAt, closesAt: hour.closesAt })),
  }));
}

/** Dia sem faixa some do corpo: é assim que ele fica fechado. */
export function toApi(days: readonly Day[]): { weekday: number; opensAt: string; closesAt: string }[] {
  return days.flatMap((day) =>
    day.ranges.map((range) => ({
      weekday: day.weekday,
      opensAt: range.opensAt,
      closesAt: range.closesAt,
    })),
  );
}

function mapDay(days: readonly Day[], weekday: number, change: (ranges: Range[]) => Range[]): Day[] {
  return days.map((day) => (day.weekday === weekday ? { ...day, ranges: change([...day.ranges]) } : day));
}

export function addRange(days: readonly Day[], weekday: number): Day[] {
  return mapDay(days, weekday, (ranges) => [...ranges, { opensAt: "", closesAt: "" }]);
}

export function removeRange(days: readonly Day[], weekday: number, index: number): Day[] {
  return mapDay(days, weekday, (ranges) => ranges.filter((_range, position) => position !== index));
}

export function setRangeTime(
  days: readonly Day[],
  weekday: number,
  index: number,
  field: "opensAt" | "closesAt",
  value: string,
): Day[] {
  return mapDay(days, weekday, (ranges) =>
    ranges.map((range, position) => (position === index ? { ...range, [field]: value } : range)),
  );
}

/** `18:00–02:00` é a pizzaria que atende até as duas: normal, não erro. */
export function crossesMidnight(range: Range): boolean {
  if (range.opensAt === "" || range.closesAt === "") return false;
  return range.closesAt < range.opensAt;
}

export function daySummary(day: Day): string {
  if (day.ranges.length === 0) return "Fechado";
  return day.ranges.length === 1 ? "Aberto" : `${day.ranges.length} faixas`;
}

/**
 * Só o que a API recusa. O banco tem UM check (`opens_at <> closes_at`);
 * sobreposição entre faixas do mesmo dia ela aceita, então a tela não a
 * proíbe — regra fantasma é pior que regra nenhuma.
 */
export function validate(days: readonly Day[]): string | null {
  for (const day of days) {
    const name = day.label.toLocaleLowerCase("pt-BR");
    for (const range of day.ranges) {
      if (range.opensAt === "" || range.closesAt === "") {
        return `Preencha as duas horas da faixa de ${name}.`;
      }
      if (range.opensAt === range.closesAt) {
        return `A faixa de ${name} começa e termina no mesmo horário.`;
      }
    }
  }
  return null;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/features/settings/openingHours.ts apps/panel/src/api/types.ts apps/panel/test/openingHours.test.ts
git commit -m "feat(panel): ✨ adiciona a regra da grade de horário"
```

---

### Task 5: Tela de Horário de funcionamento

**Files:**
- Create: `apps/panel/src/api/openingHours.ts`, `apps/panel/src/features/settings/useOpeningHours.ts`, `apps/panel/src/features/settings/OpeningHoursPage.tsx`, `apps/panel/src/features/settings/OpeningHoursPage.module.css`
- Modify: `apps/panel/src/router.tsx`, `apps/panel/src/layout/Rail.tsx`
- Test: `apps/panel/test/opening-hours-page.test.tsx`

**Interfaces:**
- Consumes: `openingHours.ts` (Task 4), `SaveBar` (Task 1), `PauseSwitch` (parte 1), `useRestaurant`, `useSessionUser`, `describeError`.
- Produces:
  - `getOpeningHours(restaurantId): Promise<OpeningHour[]>`, `putOpeningHours(restaurantId, hours): Promise<OpeningHour[]>`
  - `openingHoursQueryKey(id)`, `useOpeningHours(id)`, `useSaveOpeningHours(id)`
  - `OpeningHoursPage`

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/opening-hours-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpeningHoursPage } from "../src/features/settings/OpeningHoursPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const HOURS = `/restaurants/${RESTAURANT_ID}/opening-hours`;
const routes = [{ path: "/horario", element: <OpeningHoursPage /> }];

function gradeHandler(
  hours: { id: string; weekday: number; opensAt: string; closesAt: string }[],
): MockHandler {
  return { method: "GET", path: HOURS, body: { openingHours: hours } };
}

const SEGUNDA_E_SABADO = [
  { id: "1", weekday: 1, opensAt: "11:30", closesAt: "15:00" },
  { id: "2", weekday: 1, opensAt: "18:00", closesAt: "23:30" },
  { id: "3", weekday: 6, opensAt: "18:00", closesAt: "02:00" },
];

function setup(extra: MockHandler[] = [], hours = SEGUNDA_E_SABADO) {
  signIn();
  const api = mockApi([...extra, gradeHandler(hours), ...panelHandlers()]);
  renderInPanel(routes, "/horario");
  return api;
}

describe("OpeningHoursPage", () => {
  it("resume cada dia, e dia sem faixa é dia fechado", async () => {
    setup();
    const segunda = await screen.findByRole("listitem", { name: "Segunda" });
    expect(segunda.textContent).toContain("2 faixas");
    expect(screen.getByRole("listitem", { name: "Domingo" }).textContent).toContain("Fechado");
  });

  it("a faixa que vira a madrugada é marcada, não recusada", async () => {
    setup();
    const sabado = await screen.findByRole("listitem", { name: "Sábado" });
    expect(sabado.textContent).toContain("vira a madrugada");
  });

  it("acrescentar faixa manda a grade inteira", async () => {
    const api = setup([{ method: "PUT", path: HOURS, body: { openingHours: SEGUNDA_E_SABADO } }]);
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar faixa em quarta" }));
    fireEvent.change(screen.getByLabelText("Quarta: abre (faixa 1)"), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText("Quarta: fecha (faixa 1)"), { target: { value: "23:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "PUT")).toBe(true));
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({
      openingHours: [
        { weekday: 1, opensAt: "11:30", closesAt: "15:00" },
        { weekday: 1, opensAt: "18:00", closesAt: "23:30" },
        { weekday: 3, opensAt: "18:00", closesAt: "23:00" },
        { weekday: 6, opensAt: "18:00", closesAt: "02:00" },
      ],
    });
  });

  it("dia esvaziado sai do corpo", async () => {
    const api = setup([{ method: "PUT", path: HOURS, body: { openingHours: [] } }]);
    fireEvent.click(await screen.findByRole("button", { name: "Remover faixa 1 de sábado" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "PUT")).toBe(true));
    const body = api.calls.find((call) => call.method === "PUT")?.body as {
      openingHours: { weekday: number }[];
    };
    expect(body.openingHours.some((hour) => hour.weekday === 6)).toBe(false);
  });

  it("faixa que começa e termina no mesmo horário nem chega à API", async () => {
    const api = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar faixa em terça" }));
    fireEvent.change(screen.getByLabelText("Terça: abre (faixa 1)"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Terça: fecha (faixa 1)"), { target: { value: "19:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    expect(screen.getByText("A faixa de terça começa e termina no mesmo horário.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("a pausa no rodapé é o mesmo interruptor do topo", async () => {
    setup();
    expect(await screen.findByRole("switch", { name: "Aceitando pedidos" })).toBeTruthy();
    expect(
      screen.getByText(
        "É o botão de cozinha afogada, e não mexe no horário cadastrado. Ele está sempre na barra do topo — daqui é só o mesmo interruptor.",
      ),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- opening-hours-page`
Expected: FAIL — `OpeningHoursPage.tsx` não existe.

- [ ] **Step 3: API e hooks**

`apps/panel/src/api/openingHours.ts`:

```ts
import { apiRequest } from "./client.ts";
import type { OpeningHour } from "./types.ts";

type Payload = { openingHours: OpeningHour[] };

export function getOpeningHours(restaurantId: string): Promise<OpeningHour[]> {
  return apiRequest<Payload>(`/restaurants/${restaurantId}/opening-hours`).then(
    (payload) => payload.openingHours,
  );
}

/** O `PUT` SUBSTITUI a grade inteira: o que não vier some. */
export function putOpeningHours(
  restaurantId: string,
  openingHours: { weekday: number; opensAt: string; closesAt: string }[],
): Promise<OpeningHour[]> {
  return apiRequest<Payload>(`/restaurants/${restaurantId}/opening-hours`, {
    method: "PUT",
    body: { openingHours },
  }).then((payload) => payload.openingHours);
}
```

`apps/panel/src/features/settings/useOpeningHours.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getOpeningHours, putOpeningHours } from "../../api/openingHours.ts";

export function openingHoursQueryKey(restaurantId: string) {
  return ["opening-hours", restaurantId] as const;
}

export function useOpeningHours(restaurantId: string) {
  return useQuery({
    queryKey: openingHoursQueryKey(restaurantId),
    queryFn: () => getOpeningHours(restaurantId),
  });
}

export function useSaveOpeningHours(restaurantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hours: { weekday: number; opensAt: string; closesAt: string }[]) =>
      putOpeningHours(restaurantId, hours),
    onSuccess: (hours) => queryClient.setQueryData(openingHoursQueryKey(restaurantId), hours),
  });
}
```

- [ ] **Step 4: Estilos**

`apps/panel/src/features/settings/OpeningHoursPage.module.css`:

```css
.page {
  display: grid;
  gap: 14px;
  max-width: 880px;
  padding: 18px 20px 0;
}

.note {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-ink2);
  max-width: 78ch;
}

.card {
  overflow: hidden;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.day {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mc-line);
}

.dayName {
  flex: 0 0 104px;
  display: grid;
  gap: 2px;
}

.name {
  font-size: 14.5px;
  font-weight: 600;
}

.state {
  font-size: 12.5px;
  color: var(--mc-ink3);
}

.open {
  color: var(--mc-accent-hi);
}

.ranges {
  flex: 1 1 auto;
  display: grid;
  gap: 8px;
  justify-items: start;
}

.range {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.time {
  width: 82px;
}

.until {
  font-size: 13px;
  color: var(--mc-ink2);
}

.overnight {
  padding: 2px 8px;
  border: 1px solid var(--mc-warn-line);
  border-radius: 999px;
  background: var(--mc-warn-soft);
  color: var(--mc-warn);
  font-size: 12px;
  font-weight: 600;
}

.dashed {
  height: 34px;
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

.pause {
  display: grid;
  gap: 10px;
  justify-items: start;
  padding: 16px 18px;
  background: var(--mc-warn-soft);
  border: 1px solid var(--mc-warn-line);
  border-radius: 10px;
}

.pauseTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--mc-warn);
}

.pauseBody {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-ink2);
  max-width: 78ch;
}

.error {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-danger);
}

.loading {
  padding: 18px 20px;
  color: var(--mc-ink2);
}
```

- [ ] **Step 5: A tela**

`apps/panel/src/features/settings/OpeningHoursPage.tsx`:

```tsx
import { Button, TextInput } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { SaveBar } from "../../ui/SaveBar.tsx";
import { PauseSwitch } from "../../layout/PauseSwitch.tsx";
import { useRestaurant } from "../restaurant/useRestaurant.ts";
import {
  addRange,
  crossesMidnight,
  type Day,
  daySummary,
  fromApi,
  removeRange,
  setRangeTime,
  toApi,
  validate,
} from "./openingHours.ts";
import classes from "./OpeningHoursPage.module.css";
import { useOpeningHours, useSaveOpeningHours } from "./useOpeningHours.ts";

function OpeningHoursEditor({ restaurantId, initial }: { restaurantId: string; initial: Day[] }) {
  const [days, setDays] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useSaveOpeningHours(restaurantId);
  const restaurant = useRestaurant(restaurantId);

  const dirty = JSON.stringify(days) !== JSON.stringify(baseline);

  const submit = () => {
    const found = validate(days);
    setProblem(found);
    if (found !== null) return;
    save.mutate(toApi(days), {
      onSuccess: (hours) => {
        const next = fromApi(hours);
        setDays(next);
        setBaseline(next);
      },
    });
  };

  return (
    <>
      <div className={classes.page}>
        <p className={classes.note}>
          Um dia pode ter mais de uma faixa — é assim que se declara o fechamento entre o almoço e o
          jantar. Dia sem faixa nenhuma é dia fechado.
        </p>

        <section className={classes.card}>
          <ul className={classes.list}>
            {days.map((day) => {
              const name = day.label.toLocaleLowerCase("pt-BR");
              return (
                <li key={day.weekday} className={classes.day} aria-label={day.label}>
                  <div className={classes.dayName}>
                    <span className={classes.name}>{day.label}</span>
                    <span
                      className={`${classes.state} ${day.ranges.length > 0 ? classes.open : ""}`}
                    >
                      {daySummary(day)}
                    </span>
                  </div>
                  <div className={classes.ranges}>
                    {day.ranges.map((range, index) => (
                      <div key={index} className={classes.range}>
                        <TextInput
                          type="time"
                          className={classes.time}
                          aria-label={`${day.label}: abre (faixa ${index + 1})`}
                          value={range.opensAt}
                          onChange={(event) =>
                            setDays(
                              setRangeTime(days, day.weekday, index, "opensAt", event.currentTarget.value),
                            )
                          }
                        />
                        <span className={classes.until}>até</span>
                        <TextInput
                          type="time"
                          className={classes.time}
                          aria-label={`${day.label}: fecha (faixa ${index + 1})`}
                          value={range.closesAt}
                          onChange={(event) =>
                            setDays(
                              setRangeTime(days, day.weekday, index, "closesAt", event.currentTarget.value),
                            )
                          }
                        />
                        {crossesMidnight(range) && (
                          <span className={classes.overnight}>vira a madrugada</span>
                        )}
                        <Button
                          variant="subtle"
                          aria-label={`Remover faixa ${index + 1} de ${name}`}
                          onClick={() => setDays(removeRange(days, day.weekday, index))}
                        >
                          Remover faixa
                        </Button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className={classes.dashed}
                      aria-label={`Adicionar faixa em ${name}`}
                      onClick={() => setDays(addRange(days, day.weekday))}
                    >
                      + Adicionar faixa
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <p className={classes.note}>
          Faixa que termina antes de começar é normal, não erro: 18:00 até 02:00 é a pizzaria que
          atende até as duas da manhã.
        </p>

        {problem !== null && (
          <p role="alert" className={classes.error}>
            {problem}
          </p>
        )}
        {save.isError && (
          <p role="alert" className={classes.error}>
            {describeError(save.error)}
          </p>
        )}

        <section className={classes.pause}>
          <h2 className={classes.pauseTitle}>Parar de aceitar pedidos agora</h2>
          <p className={classes.pauseBody}>
            É o botão de cozinha afogada, e não mexe no horário cadastrado. Ele está sempre na barra do
            topo — daqui é só o mesmo interruptor.
          </p>
          <PauseSwitch restaurantId={restaurantId} restaurant={restaurant.data} />
        </section>
      </div>
      <SaveBar
        dirty={dirty}
        busy={save.isPending}
        saveLabel="Salvar horário"
        onSave={submit}
        cancel={{
          onClick: () => {
            setDays(baseline);
            setProblem(null);
          },
        }}
      />
    </>
  );
}

export function OpeningHoursPage() {
  const { restaurantId } = useSessionUser();
  const hours = useOpeningHours(restaurantId);

  if (hours.isPending) return <p className={classes.loading}>Carregando horário…</p>;
  if (hours.isError) return <p className={classes.loading}>{describeError(hours.error)}</p>;
  // O editor nasce com os dados em mãos: estado de formulário vindo de props,
  // sem setState em efeito.
  return <OpeningHoursEditor restaurantId={restaurantId} initial={fromApi(hours.data)} />;
}
```

- [ ] **Step 6: Rota e rail**

Em `apps/panel/src/router.tsx`:

```tsx
import { OpeningHoursPage } from "./features/settings/OpeningHoursPage.tsx";
```

```tsx
              {
                path: "/horario",
                handle: { title: "Horário de funcionamento" },
                element: <OpeningHoursPage />,
              },
```

Em `apps/panel/src/layout/Rail.tsx`, o grupo "Configuração" passa a ser:

```tsx
  {
    title: "Configuração",
    items: [
      { to: "/modalidades", label: "Modalidades" },
      { to: "/horario", label: "Horário" },
    ],
  },
```

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/panel/src apps/panel/test/opening-hours-page.test.tsx
git commit -m "feat(panel): ✨ adiciona a grade de horário de funcionamento"
```

---

### Task 6: Dados da loja

**Files:**
- Create: `apps/panel/src/features/settings/timezones.ts`, `apps/panel/src/features/settings/storeForm.ts`, `apps/panel/src/features/settings/StoreDataPage.tsx`, `apps/panel/src/features/settings/StoreDataPage.module.css`
- Modify: `apps/panel/src/router.tsx`, `apps/panel/src/layout/Rail.tsx`
- Test: `apps/panel/test/storeForm.test.ts`, `apps/panel/test/store-data-page.test.tsx`

**Interfaces:**
- Consumes: `useRestaurant`, `useUpdateRestaurant` (Task 2), `SaveBar` (Task 1), `RestaurantPatch`.
- Produces:
  - `TIMEZONES: readonly { value: string; label: string }[]`
  - `type StoreForm`, `fromRestaurant(restaurant): StoreForm`, `validateStoreForm(form): string | null`, `changedPatch(form, initial): RestaurantPatch`
  - `StoreDataPage`

- [ ] **Step 1: Escrever os testes que falham**

`apps/panel/test/storeForm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  changedPatch,
  fromRestaurant,
  validateStoreForm,
} from "../src/features/settings/storeForm.ts";
import { makeRestaurant } from "./fixtures.ts";

const restaurant = makeRestaurant();
const initial = fromRestaurant(restaurant);

describe("formulário de dados da loja", () => {
  it("carrega o restaurante no formulário", () => {
    expect(initial).toEqual({
      name: "Trattoria Bella",
      cuisineType: "Italiana",
      timezone: "America/Sao_Paulo",
      logoUrl: "",
      street: "Rua Aspicuelta",
      number: "120",
      neighborhood: "Vila Madalena",
      city: "São Paulo",
      state: "SP",
      zipCode: "05433-010",
    });
  });

  it("nada mudou, nada vai", () => {
    expect(changedPatch(initial, initial)).toEqual({});
  });

  it("manda só o campo alterado", () => {
    expect(changedPatch({ ...initial, name: "Trattoria Bela" }, initial)).toEqual({
      name: "Trattoria Bela",
    });
  });

  it("uma mudança no endereço manda o endereço inteiro", () => {
    expect(changedPatch({ ...initial, number: "121" }, initial)).toEqual({
      address: {
        street: "Rua Aspicuelta",
        number: "121",
        neighborhood: "Vila Madalena",
        city: "São Paulo",
        state: "SP",
        zipCode: "05433-010",
      },
    });
  });

  it("a UF sai em maiúsculas", () => {
    expect(changedPatch({ ...initial, state: "rj" }, initial)).toMatchObject({
      address: { state: "RJ" },
    });
  });

  it("recusa o que a API recusaria", () => {
    expect(validateStoreForm(initial)).toBeNull();
    expect(validateStoreForm({ ...initial, name: "  " })).toBe("Informe o nome da loja.");
    expect(validateStoreForm({ ...initial, city: "" })).toBe("Preencha o endereço completo da loja.");
    expect(validateStoreForm({ ...initial, logoUrl: "logo.png" })).toBe(
      "Cole um endereço completo de imagem, começando com https://.",
    );
    expect(validateStoreForm({ ...initial, logoUrl: "https://cdn.exemplo/logo.png" })).toBeNull();
  });
});
```

`apps/panel/test/store-data-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreDataPage } from "../src/features/settings/StoreDataPage.tsx";
import { mockApi } from "./api-mock.ts";
import { makeRestaurant, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const routes = [{ path: "/dados-da-loja", element: <StoreDataPage /> }];

describe("StoreDataPage", () => {
  it("mostra o slug, desabilitado, com o porquê", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    const slug = (await screen.findByLabelText("Endereço público")) as HTMLInputElement;
    expect(slug.disabled).toBe(true);
    expect(slug.value).toContain("trattoria-bella");
    expect(
      screen.getByText("É a URL dentro do QR code impresso — por isso não muda por aqui."),
    ).toBeTruthy();
  });

  it("salva só o que mudou", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ name: "Trattoria Bela" }) },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.change(await screen.findByLabelText("Nome da loja"), {
      target: { value: "Trattoria Bela" },
    });
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({
        name: "Trattoria Bela",
      }),
    );
  });

  it("o fuso é uma lista fechada, com o aviso do que ele decide", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    const timezone = await screen.findByLabelText("Fuso horário");
    expect(timezone.tagName).toBe("SELECT");
    expect(screen.getByText("É ele que decide onde o dia começa: “pedidos de hoje” e o faturamento do topo mudam junto.")).toBeTruthy();
  });

  it("campo obrigatório vazio nem chega à API", async () => {
    signIn();
    const api = mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.change(await screen.findByLabelText("Nome da loja"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));
    expect(screen.getByText("Informe o nome da loja.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "PATCH")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- storeForm store-data-page`
Expected: FAIL — os módulos não existem.

- [ ] **Step 3: Fusos e formulário puro**

`apps/panel/src/features/settings/timezones.ts`:

```ts
/**
 * Lista fechada: o Postgres aceita nomes IANA e apelidos, mas texto livre aqui
 * só serviria para digitar um nome que ele recusa. São os fusos do Brasil.
 */
export const TIMEZONES: readonly { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (America/Sao_Paulo)" },
  { value: "America/Bahia", label: "Bahia (America/Bahia)" },
  { value: "America/Fortaleza", label: "Ceará (America/Fortaleza)" },
  { value: "America/Recife", label: "Pernambuco (America/Recife)" },
  { value: "America/Belem", label: "Pará (America/Belem)" },
  { value: "America/Manaus", label: "Amazonas (America/Manaus)" },
  { value: "America/Cuiaba", label: "Mato Grosso (America/Cuiaba)" },
  { value: "America/Porto_Velho", label: "Rondônia (America/Porto_Velho)" },
  { value: "America/Rio_Branco", label: "Acre (America/Rio_Branco)" },
  { value: "America/Noronha", label: "Fernando de Noronha (America/Noronha)" },
];
```

`apps/panel/src/features/settings/storeForm.ts`:

```ts
import type { RestaurantPatch } from "../../api/restaurant.ts";
import type { Restaurant } from "../../api/types.ts";

export type StoreForm = {
  name: string;
  cuisineType: string;
  timezone: string;
  logoUrl: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

export function fromRestaurant(restaurant: Restaurant): StoreForm {
  return {
    name: restaurant.name,
    cuisineType: restaurant.cuisineType,
    timezone: restaurant.timezone,
    logoUrl: restaurant.logoUrl ?? "",
    street: restaurant.address.street,
    number: restaurant.address.number,
    neighborhood: restaurant.address.neighborhood,
    city: restaurant.address.city,
    state: restaurant.address.state,
    zipCode: restaurant.address.zipCode,
  };
}

const ADDRESS_FIELDS = ["street", "number", "neighborhood", "city", "state", "zipCode"] as const;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateStoreForm(form: StoreForm): string | null {
  if (form.name.trim() === "") return "Informe o nome da loja.";
  if (form.cuisineType.trim() === "") return "Informe o tipo de cozinha.";
  if (ADDRESS_FIELDS.some((field) => form[field].trim() === "")) {
    return "Preencha o endereço completo da loja.";
  }
  const logoUrl = form.logoUrl.trim();
  if (logoUrl !== "" && !isHttpUrl(logoUrl)) {
    return "Cole um endereço completo de imagem, começando com https://.";
  }
  return null;
}

/**
 * Só o que mudou. O endereço vai INTEIRO quando qualquer campo dele muda: a
 * API o recebe como objeto, e mandar meio endereço apagaria o resto.
 */
export function changedPatch(form: StoreForm, initial: StoreForm): RestaurantPatch {
  const patch: RestaurantPatch = {};
  if (form.name.trim() !== initial.name) patch.name = form.name.trim();
  if (form.cuisineType.trim() !== initial.cuisineType) patch.cuisineType = form.cuisineType.trim();
  if (form.timezone !== initial.timezone) patch.timezone = form.timezone;
  const logoUrl = form.logoUrl.trim();
  // A API não aceita `photoUrl`/`logoUrl` vazia (é `format: uri`), então o
  // campo esvaziado não vira uma limpeza — só deixa de ser enviado.
  if (logoUrl !== "" && logoUrl !== initial.logoUrl) patch.logoUrl = logoUrl;
  if (ADDRESS_FIELDS.some((field) => form[field].trim() !== initial[field])) {
    patch.address = {
      street: form.street.trim(),
      number: form.number.trim(),
      neighborhood: form.neighborhood.trim(),
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
      zipCode: form.zipCode.trim(),
    };
  }
  return patch;
}
```

- [ ] **Step 4: Estilos**

`apps/panel/src/features/settings/StoreDataPage.module.css`:

```css
.page {
  display: grid;
  gap: 16px;
  padding: 18px 20px 0;
}

.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
  align-items: start;
}

.card {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.cardTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.address {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 0.7fr) minmax(0, 1fr);
  gap: 12px;
}

.error {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-danger);
}

.loading {
  padding: 18px 20px;
  color: var(--mc-ink2);
}
```

- [ ] **Step 5: A tela**

`apps/panel/src/features/settings/StoreDataPage.tsx`:

```tsx
import { NativeSelect, TextInput } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { Restaurant } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { SaveBar } from "../../ui/SaveBar.tsx";
import { useRestaurant, useUpdateRestaurant } from "../restaurant/useRestaurant.ts";
import classes from "./StoreDataPage.module.css";
import { changedPatch, fromRestaurant, type StoreForm, validateStoreForm } from "./storeForm.ts";
import { TIMEZONES } from "./timezones.ts";

function StoreDataEditor({ restaurant }: { restaurant: Restaurant }) {
  const initial = fromRestaurant(restaurant);
  const [form, setForm] = useState<StoreForm>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const update = useUpdateRestaurant(restaurant.id);

  const field = (name: keyof StoreForm) => ({
    value: form[name],
    onChange: (event: { currentTarget: { value: string } }) =>
      setForm((current) => ({ ...current, [name]: event.currentTarget.value })),
  });

  const patch = changedPatch(form, initial);
  const dirty = Object.keys(patch).length > 0;

  const submit = () => {
    const found = validateStoreForm(form);
    setProblem(found);
    if (found !== null || !dirty) return;
    update.mutate(patch);
  };

  return (
    <>
      <div className={classes.page}>
        <div className={classes.columns}>
          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Identificação</h2>
            <TextInput label="Nome da loja" {...field("name")} />
            <div className={classes.pair}>
              <TextInput label="Tipo de cozinha" {...field("cuisineType")} />
              <NativeSelect
                label="Fuso horário"
                description="É ele que decide onde o dia começa: “pedidos de hoje” e o faturamento do topo mudam junto."
                data={TIMEZONES.map((zone) => ({ value: zone.value, label: zone.label }))}
                {...field("timezone")}
              />
            </div>
            <TextInput
              label="URL do logo"
              placeholder="https://"
              description="Ainda não há upload de imagem: cole o endereço de uma imagem já publicada."
              {...field("logoUrl")}
            />
            <TextInput
              label="Endereço público"
              disabled
              value={`/${restaurant.slug}`}
              description="É a URL dentro do QR code impresso — por isso não muda por aqui."
            />
          </section>

          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Endereço</h2>
            <TextInput label="Rua" {...field("street")} />
            <div className={classes.pair}>
              <TextInput label="Número" {...field("number")} />
              <TextInput label="Bairro" {...field("neighborhood")} />
            </div>
            <div className={classes.address}>
              <TextInput label="Cidade" {...field("city")} />
              <TextInput label="UF" maxLength={2} {...field("state")} />
              <TextInput label="CEP" {...field("zipCode")} />
            </div>
          </section>
        </div>

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
      </div>
      <SaveBar
        dirty={dirty}
        busy={update.isPending}
        saveLabel="Salvar dados"
        onSave={submit}
        cancel={{
          onClick: () => {
            setForm(initial);
            setProblem(null);
          },
        }}
      />
    </>
  );
}

export function StoreDataPage() {
  const { restaurantId } = useSessionUser();
  const restaurant = useRestaurant(restaurantId);

  if (restaurant.isPending) return <p className={classes.loading}>Carregando dados da loja…</p>;
  if (restaurant.isError) return <p className={classes.loading}>{describeError(restaurant.error)}</p>;
  // `key`: trocar de restaurante remonta o editor com os dados novos, sem
  // setState em efeito.
  return <StoreDataEditor key={restaurant.data.id} restaurant={restaurant.data} />;
}
```

- [ ] **Step 6: Rota e rail**

Em `apps/panel/src/router.tsx`:

```tsx
import { StoreDataPage } from "./features/settings/StoreDataPage.tsx";
```

```tsx
              { path: "/dados-da-loja", handle: { title: "Dados da loja" }, element: <StoreDataPage /> },
```

Em `apps/panel/src/layout/Rail.tsx`, o grupo "Configuração" fecha com as três telas:

```tsx
  {
    title: "Configuração",
    items: [
      { to: "/modalidades", label: "Modalidades" },
      { to: "/horario", label: "Horário" },
      { to: "/dados-da-loja", label: "Dados da loja" },
    ],
  },
```

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/panel/src apps/panel/test/storeForm.test.ts apps/panel/test/store-data-page.test.tsx
git commit -m "feat(panel): ✨ adiciona os dados da loja"
```

---

### Task 7: A zona destrutiva

**Files:**
- Create: `apps/panel/src/features/settings/DangerZone.tsx`, `apps/panel/src/features/settings/DangerZone.module.css`
- Modify: `apps/panel/src/api/restaurant.ts`, `apps/panel/src/features/settings/StoreDataPage.tsx`, `apps/panel/src/features/access/LoginPage.tsx`
- Test: `apps/panel/test/danger-zone.test.tsx`

**Interfaces:**
- Consumes: `useSessionUser`, `clearSession`, `buttons.module.css`, `describeError`.
- Produces: `deleteRestaurant(id): Promise<void>`; `DangerZone({ restaurant })` — renderizado só para `owner`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/danger-zone.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readSession } from "../src/api/session.ts";
import { StoreDataPage } from "../src/features/settings/StoreDataPage.tsx";
import { mockApi } from "./api-mock.ts";
import { panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const routes = [
  { path: "/dados-da-loja", element: <StoreDataPage /> },
  { path: "*", element: <LocationProbe /> },
];

describe("zona destrutiva", () => {
  it("não existe para quem é equipe", async () => {
    signIn();
    mockApi(panelHandlers({ me: { role: "staff" } }));
    renderInPanel(routes, "/dados-da-loja");
    await screen.findByLabelText("Nome da loja");
    expect(screen.queryByRole("button", { name: "Remover restaurante" })).toBeNull();
  });

  it("o dono precisa digitar o nome da loja para o botão liberar", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.click(await screen.findByRole("button", { name: "Remover restaurante" }));
    const dialog = await screen.findByRole("dialog", { name: "Remover a Trattoria Bella?" });
    const confirm = screen.getByRole("button", { name: "Remover para sempre" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Digite o nome da loja para confirmar"), {
      target: { value: "Trattoria" },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Digite o nome da loja para confirmar"), {
      target: { value: "Trattoria Bella" },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    expect(dialog.textContent).toContain("cardápio");
  });

  it("removeu: a sessão acaba e a pessoa volta ao login", async () => {
    signIn();
    const api = mockApi([
      { method: "DELETE", path: `/restaurants/${RESTAURANT_ID}`, status: 204 },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.click(await screen.findByRole("button", { name: "Remover restaurante" }));
    fireEvent.change(screen.getByLabelText("Digite o nome da loja para confirmar"), {
      target: { value: "Trattoria Bella" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remover para sempre" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/login?motivo=loja-removida");
    expect(readSession()).toBeNull();
    expect(api.calls.some((call) => call.method === "DELETE")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- danger-zone`
Expected: FAIL — não há botão "Remover restaurante".

- [ ] **Step 3: A rota de remoção**

Acrescente ao fim de `apps/panel/src/api/restaurant.ts`:

```ts
/** Soft delete no servidor: cardápio, mesas e grade saem junto. Não tem volta pelo painel. */
export function deleteRestaurant(id: string): Promise<void> {
  return apiRequest<void>(`/restaurants/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 4: Estilos**

`apps/panel/src/features/settings/DangerZone.module.css`:

```css
.zone {
  display: grid;
  gap: 10px;
  justify-items: start;
  padding: 16px 18px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-danger-line);
  border-radius: 10px;
}

.title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--mc-danger);
}

.body {
  margin: 0;
  max-width: 78ch;
  font-size: 13.5px;
  color: var(--mc-ink2);
}

.dialog {
  display: grid;
  gap: 12px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.error {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-danger);
}
```

- [ ] **Step 5: O componente**

`apps/panel/src/features/settings/DangerZone.tsx`:

```tsx
import { Button, Modal, TextInput } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { describeError } from "../../api/client.ts";
import { deleteRestaurant } from "../../api/restaurant.ts";
import { clearSession } from "../../api/session.ts";
import type { Restaurant } from "../../api/types.ts";
import buttons from "../../ui/buttons.module.css";
import classes from "./DangerZone.module.css";

/**
 * Só o `owner` chega aqui (a API responde 403 para `staff`, e botão morto é
 * pior que botão nenhum). A confirmação pede o NOME da loja digitado: é a
 * única ação do painel sem volta.
 */
export function DangerZone({ restaurant }: { restaurant: Restaurant }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => deleteRestaurant(restaurant.id),
    onSuccess: () => {
      // A remoção marca o restaurante e as filhas, mas NÃO toca no usuário nem
      // na sessão: ficar no painel deixaria a pessoa numa casca pedindo um
      // restaurante que já não existe.
      clearSession();
      queryClient.clear();
      navigate("/login?motivo=loja-removida", { replace: true });
    },
  });

  const confirmed = typed.trim() === restaurant.name;

  return (
    <section className={classes.zone}>
      <h2 className={classes.title}>Remover o restaurante</h2>
      <p className={classes.body}>
        Apaga cardápio, mesas, usuários e o histórico de pedidos. Não há como desfazer, e o cardápio
        público sai do ar na hora.
      </p>
      <Button
        className={buttons.danger}
        onClick={() => {
          setTyped("");
          remove.reset();
          setOpen(true);
        }}
      >
        Remover restaurante
      </Button>

      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={`Remover a ${restaurant.name}?`}
        centered
        size={460}
        radius="md"
      >
        <div className={classes.dialog}>
          <p className={classes.body}>
            Apaga cardápio, mesas, usuários e o histórico de pedidos. Não há como desfazer, e o
            cardápio público sai do ar na hora.
          </p>
          <TextInput
            label="Digite o nome da loja para confirmar"
            aria-label="Digite o nome da loja para confirmar"
            value={typed}
            onChange={(event) => setTyped(event.currentTarget.value)}
          />
          {remove.isError && (
            <p role="alert" className={classes.error}>
              {describeError(remove.error)}
            </p>
          )}
          <div className={classes.actions}>
            <Button variant="default" h={40} onClick={() => setOpen(false)} disabled={remove.isPending}>
              Voltar
            </Button>
            <Button
              h={40}
              className={buttons.danger}
              disabled={!confirmed}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remover para sempre
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
```

- [ ] **Step 6: Ligar na tela e avisar no login**

Em `apps/panel/src/features/settings/StoreDataPage.tsx`, importe e renderize depois das duas colunas, dentro de `StoreDataEditor` — mas só para o dono, o que exige o papel:

```tsx
import { useSessionUser } from "../../auth/useMe.ts";
import { DangerZone } from "./DangerZone.tsx";
```

Dentro de `StoreDataEditor`, logo no começo:

```tsx
  const { role } = useSessionUser();
```

e depois do `</div>` que fecha `classes.columns`, ainda dentro de `classes.page`:

```tsx
        {role === "owner" && <DangerZone restaurant={restaurant} />}
```

Em `apps/panel/src/features/access/LoginPage.tsx`, acrescente a entrada ao mapa `NOTICES`:

```tsx
  "loja-removida": {
    tone: "warn",
    title: "Restaurante removido",
    body: "A loja e o cardápio público saíram do ar. Se isso foi engano, fale com o suporte.",
  },
```

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/panel/src apps/panel/test/danger-zone.test.tsx
git commit -m "feat(panel): ✨ permite ao dono remover o restaurante"
```

---

### Task 8: Documentação e verificação final

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-09-20-painel-configuracao-parte-2a-design.md`

- [ ] **Step 1: `CLAUDE.md`**

Na seção `### Painel da loja (`apps/panel`)`, acrescente ao fim da lista de regras:

```markdown
- **A grade de horário é `PUT` de lista inteira** (`/opening-hours`): por isso a tela tem barra de salvar e nada sai enquanto a pessoa digita — meia hora (`18:`) viraria uma grade quebrada, e o `PUT` substitui tudo. Dia sem faixa some do corpo: é assim que ele fica fechado. A regra (dias, faixas, tradução da numeração `0 = domingo`, validação) mora em `features/settings/openingHours.ts`, sem React.
- **Interruptor salva sozinho, com volta atrás** (`useToggleRestaurantFlag`): o estado novo aparece na hora e o cache volta ao anterior se o `PATCH` falhar. Formulário (Dados da loja, produto, horário) usa a `SaveBar` de `src/ui/`.
- ⚠️ **Remover o restaurante encerra a sessão** e leva ao `/login?motivo=loja-removida`: a API marca o restaurante e as filhas, mas **não** toca no usuário nem na sessão — continuar no painel deixaria a pessoa numa casca pedindo um restaurante que já não existe. A confirmação pede o nome da loja digitado.
- **A tela de Modalidades tem o quarto interruptor de pagamento** (vale-refeição) que o handoff não desenhou: a API tem a flag, e sem ele a loja não a ligaria em lugar nenhum. E **nenhuma modalidade ligada é estado permitido**, com aviso âmbar — travar o último interruptor brigaria com quem está suspendendo as vendas.
```

- [ ] **Step 2: Estado da spec**

Em `docs/superpowers/specs/2026-09-20-painel-configuracao-parte-2a-design.md`, troque `**Estado:** aprovado, não implementado (branch `feat/painel-configuracao`)` por `**Estado:** implementado (branch `feat/painel-configuracao`)`.

- [ ] **Step 3: Verificação completa**

Run:

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm lint
pnpm build
pnpm --filter @menuclick/panel test
```

Expected: lint limpo, build dos dois apps, e a suíte do painel passando (176 testes antes deste plano, mais os desta parte).

Com o Postgres de pé, rode também `pnpm --filter @menuclick/api test` e reporte o resultado — a API não muda aqui, então ela deve seguir em 605.

- [ ] **Step 4: Conferência manual (o que sobra para o humano)**

Com `pnpm dev` de pé e a loja do seed verificada, liste no relatório o que não dá para conferir sem navegador:

1. **Modalidades** — desligar as três e ver o aviso âmbar; ligar Entrega com modo bairro e nenhum bairro e ver o segundo aviso; derrubar a API e ver um interruptor voltar sozinho.
2. **Horário** — dia com duas faixas, faixa `18:00–02:00` com o chip, dia esvaziado ficando "Fechado", e o interruptor de pausa no rodapé refletindo o do topo.
3. **Dados da loja** — o slug desabilitado, trocar o fuso e ver o faturamento do topo mudar de recorte, e a zona destrutiva aparecendo só para o dono.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-20-painel-configuracao-parte-2a-design.md
git commit -m "docs(panel): 📝 documenta as telas de configuração"
```
