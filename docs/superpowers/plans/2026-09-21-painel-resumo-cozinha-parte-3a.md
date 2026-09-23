# Painel da loja, parte 3a — Resumo do dia e Modo cozinha — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao painel o Resumo do dia (números do período e pedidos por status) e o Modo cozinha (tela cheia para o tablet da bancada, sem dinheiro).

**Architecture:** Cada tela tem um módulo puro de regra (sem React, com os testes) e reusa o que a parte 1 já tem: a query de resumo do header, a query de pendentes do aviso de pedido novo e o fluxo de ações do pedido (`OrderActionProvider`), que ganha um modo "cozinha" sem dinheiro. O Resumo mora dentro da casca; a cozinha, fora dela.

**Tech Stack:** Vite 8, React 19, Mantine 9, React Router 8, TanStack Query 5, TypeScript 7; testes em Vitest 4 + Testing Library 16 + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-21-painel-resumo-cozinha-parte-3a-design.md`

## Global Constraints

- Branch `feat/painel-resumo-cozinha`, a partir de `feat/painel-entrega-opcoes`. A API (`apps/api`) **não muda**.
- **Nenhuma dependência nova.**
- **Cor só por `var(--mc-*)`**; hex só em `src/theme/tokens.ts`. Sem sombra, sem transição, sem animação. `.n` para números tabulares. (Largura de barra por `style={{ width }}` é permitida: não é cor.)
- **Copy do protótipo é literal** (`docs/design/painel-da-loja/Painel da Loja.dc.html`); texto novo só onde a spec o registra.
- **Toda chamada passa por `apiRequest`** (`src/api/client.ts`).
- **Carregando/erro só quando `data === undefined`**.
- **Uma instância de mutação por controle independente**, com a escrita/invalidação no cache no `onSuccess`/`onSettled` do hook. Nunca callback por chamada (`mutate(x, { onSuccess })`).
- **A cozinha nunca mostra dinheiro**: preço, total, frete, forma de pagamento, telefone — nem o nome do cliente.
- Imports locais com extensão (`.ts`/`.tsx`); `import type` para tipos; sem `enum`.
- Textos para o usuário em pt-BR; identificadores em inglês.
- Comandos com o prefixo `unset -f node npm npx pnpm nvm 2>/dev/null;`.
- Commits no padrão de `.claude/rules/commits.md`.
- Verificação de cada task: `pnpm --filter @menuclick/panel test`, `pnpm lint`, `pnpm build`. A suíte do painel parte de **290** testes. `test/orders-page.test.tsx` › "teto de 1000 pedidos" é instável conhecido; se só ele falhar, rode de novo.

## Duas correções da spec, decididas ao escrever o plano

1. **"Entraram agora" são os `pending` DE HOJE**, não "de qualquer data": a query de pendentes do aviso de pedido novo é escopada a hoje de propósito (FIX 5 da parte 1, `listPendingOrders` em `src/api/orders.ts`), igual à coluna "Novos" do kanban. A cozinha lê a mesma query. "Fazendo" (`confirmed`/`preparing`) não tem recorte de data: um prato em preparo às 23:50 não pode sumir da bancada à meia-noite.
2. **"Pedidos por status" tem as cinco linhas do protótipo**, não uma por status: Novos (`pending`), Em preparo (`confirmed` + `preparing`), Prontos / em rota (`ready_for_pickup` + `out_for_delivery`), Concluídos (`completed`), Cancelados (`cancelled`). A barra é a **fatia do total que chegou** no período (protótipo: `n / total`), não a proporção do maior.

A Task 6 leva as duas para a spec.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/features/summary/summary.ts` (criar) | regra pura do Resumo |
| `src/features/summary/SummaryPage.tsx` + `.module.css` (criar) | tela do Resumo |
| `src/features/orders/useSummary.ts` (modificar) | `usePeriodSummary`; `useTodaySummary` passa a ser o caso "today" |
| `src/features/kitchen/kitchen.ts` (criar) | regra pura da cozinha |
| `src/api/orders.ts` (modificar) | `listOrdersByStatus` |
| `src/features/orders/useNewOrderAlert.ts` (modificar) | devolve também `pendingOrders` |
| `src/features/orders/orderActionFlow.tsx` (modificar) | `mode="kitchen"`: confirmação sem dinheiro e sem "Recusar" |
| `src/features/kitchen/useKitchen.ts` (criar) | listas de "Fazendo" e itens do pedido (uma vez) |
| `src/features/kitchen/KitchenPage.tsx` + `.module.css` (criar) | tela da cozinha |
| `src/features/orders/FilterBar.tsx` (modificar) | botão "Modo cozinha" |
| `src/router.tsx`, `src/layout/Rail.tsx` (modificar) | rotas e item do rail |

---

### Task 1: A regra do Resumo, em forma pura

**Files:**
- Create: `apps/panel/src/features/summary/summary.ts`
- Test: `apps/panel/test/summary.test.ts`

**Interfaces:**
- Consumes: `OrdersSummary`, `OrderStatus`, `Period` (`src/api/types.ts`); `formatCents` (`src/lib/money.ts`); `formatSecondsAgo` (`src/lib/time.ts`).
- Produces:
  - `type StatusTone = "new" | "preparing" | "ready" | "done" | "cancelled"`
  - `type StatusRow = { label: string; count: number; share: number; tone: StatusTone }`
  - `arrivedCount(counts: Partial<Record<OrderStatus, number>>): number`
  - `statusRows(counts: Partial<Record<OrderStatus, number>>): StatusRow[]`
  - `bigNumbers(summary: OrdersSummary): { label: string; value: string; sub: string }[]`
  - `syncLabel(period: Period, updatedAtMs: number, nowMs: number): string`
  - `parsePeriod(value: string | null): Period`
  - `READING_NOTES: readonly { head: string; body: string }[]`

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  arrivedCount,
  bigNumbers,
  parsePeriod,
  READING_NOTES,
  statusRows,
  syncLabel,
} from "../src/features/summary/summary.ts";
import { makeSummary } from "./fixtures.ts";

const counts = {
  pending: 2,
  confirmed: 1,
  preparing: 1,
  ready_for_pickup: 0,
  out_for_delivery: 1,
  completed: 4,
  cancelled: 1,
};

describe("contagens", () => {
  it("'chegaram' é a soma de todos os status", () => {
    expect(arrivedCount(counts)).toBe(10);
  });

  it("cinco linhas agrupadas como no protótipo, com a fatia do total", () => {
    expect(statusRows(counts)).toEqual([
      { label: "Novos", count: 2, share: 0.2, tone: "new" },
      { label: "Em preparo", count: 2, share: 0.2, tone: "preparing" },
      { label: "Prontos / em rota", count: 1, share: 0.1, tone: "ready" },
      { label: "Concluídos", count: 4, share: 0.4, tone: "done" },
      { label: "Cancelados", count: 1, share: 0.1, tone: "cancelled" },
    ]);
  });

  it("período vazio: barras zeradas, sem divisão por zero", () => {
    expect(statusRows({}).every((row) => row.count === 0 && row.share === 0)).toBe(true);
  });
});

describe("os três números", () => {
  it("texto literal do protótipo, no plural", () => {
    const numbers = bigNumbers(
      makeSummary({ counts, revenueInCents: 45000, revenueOrderCount: 6, averageTicketInCents: 7500 }),
    );
    expect(numbers.map((number) => [number.label, number.sub])).toEqual([
      ["Faturamento", "de 6 pedidos aceitos — inclui o frete cobrado"],
      ["Pedidos aceitos", "10 chegaram no período"],
      ["Ticket médio", "faturamento ÷ pedidos aceitos"],
    ]);
    expect(numbers[0].value).toMatch(/450,00/);
    expect(numbers[1].value).toBe("6");
    expect(numbers[2].value).toMatch(/75,00/);
  });

  it("singular com um pedido só", () => {
    const numbers = bigNumbers(
      makeSummary({ counts: { ...makeSummary().counts, completed: 1 }, revenueOrderCount: 1 }),
    );
    expect(numbers[0].sub).toBe("de 1 pedido aceito — inclui o frete cobrado");
    expect(numbers[1].sub).toBe("1 chegou no período");
  });
});

describe("etiqueta de atualização", () => {
  it("'Fechamento parcial' só nos períodos que incluem hoje", () => {
    const now = 1_000_000;
    expect(syncLabel("today", now - 6000, now)).toBe("Fechamento parcial · atualizado há 6 s");
    expect(syncLabel("last7days", now - 6000, now)).toBe("Fechamento parcial · atualizado há 6 s");
    expect(syncLabel("thisMonth", now - 6000, now)).toBe("Fechamento parcial · atualizado há 6 s");
    expect(syncLabel("yesterday", now - 6000, now)).toBe("atualizado há 6 s");
  });
});

describe("parsePeriod", () => {
  it("aceita os quatro e cai em hoje no resto", () => {
    expect(parsePeriod("yesterday")).toBe("yesterday");
    expect(parsePeriod("thisMonth")).toBe("thisMonth");
    expect(parsePeriod(null)).toBe("today");
    expect(parsePeriod("amanha")).toBe("today");
  });
});

describe("notas", () => {
  it("as três notas literais do protótipo", () => {
    expect(READING_NOTES.map((note) => note.head)).toEqual([
      "Faturamento conta de aceito em diante.",
      "O frete entra no faturamento.",
      "O ticket médio mistura comida e frete.",
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/summary.test.ts`
Expected: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar**

Crie `apps/panel/src/features/summary/summary.ts`:

```ts
import type { OrdersSummary, OrderStatus, Period } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import { formatSecondsAgo } from "../../lib/time.ts";

export type StatusTone = "new" | "preparing" | "ready" | "done" | "cancelled";

export type StatusRow = { label: string; count: number; share: number; tone: StatusTone };

/**
 * As cinco linhas do protótipo, agrupadas como as colunas do kanban (mais
 * Cancelados à parte). A barra é a fatia do total que CHEGOU no período.
 */
const ROWS: readonly { label: string; statuses: readonly OrderStatus[]; tone: StatusTone }[] = [
  { label: "Novos", statuses: ["pending"], tone: "new" },
  { label: "Em preparo", statuses: ["confirmed", "preparing"], tone: "preparing" },
  { label: "Prontos / em rota", statuses: ["ready_for_pickup", "out_for_delivery"], tone: "ready" },
  { label: "Concluídos", statuses: ["completed"], tone: "done" },
  { label: "Cancelados", statuses: ["cancelled"], tone: "cancelled" },
];

export function arrivedCount(counts: Partial<Record<OrderStatus, number>>): number {
  return Object.values(counts).reduce<number>((total, count) => total + (count ?? 0), 0);
}

export function statusRows(counts: Partial<Record<OrderStatus, number>>): StatusRow[] {
  const total = arrivedCount(counts);
  return ROWS.map((row) => {
    const count = row.statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
    return { label: row.label, count, share: total === 0 ? 0 : count / total, tone: row.tone };
  });
}

/** Texto literal do protótipo; o singular é o único acréscimo. */
export function bigNumbers(summary: OrdersSummary): { label: string; value: string; sub: string }[] {
  const accepted = summary.revenueOrderCount;
  const arrived = arrivedCount(summary.counts);
  return [
    {
      label: "Faturamento",
      value: formatCents(summary.revenueInCents),
      sub: `de ${accepted} ${accepted === 1 ? "pedido aceito" : "pedidos aceitos"} — inclui o frete cobrado`,
    },
    {
      label: "Pedidos aceitos",
      value: String(accepted),
      sub: arrived === 1 ? "1 chegou no período" : `${arrived} chegaram no período`,
    },
    { label: "Ticket médio", value: formatCents(summary.averageTicketInCents), sub: "faturamento ÷ pedidos aceitos" },
  ];
}

/** "Parcial" só enquanto o período ainda está correndo: Ontem já fechou. */
export function syncLabel(period: Period, updatedAtMs: number, nowMs: number): string {
  const updated = `atualizado ${formatSecondsAgo(updatedAtMs, nowMs)}`;
  return period === "yesterday" ? updated : `Fechamento parcial · ${updated}`;
}

const PERIOD_VALUES: readonly Period[] = ["today", "yesterday", "last7days", "thisMonth"];

export function parsePeriod(value: string | null): Period {
  return PERIOD_VALUES.find((period) => period === value) ?? "today";
}

/** "Como ler estes números" — texto literal do protótipo. */
export const READING_NOTES: readonly { head: string; body: string }[] = [
  {
    head: "Faturamento conta de aceito em diante.",
    body: "Pedido novo ainda não é venda e cancelado deixou de ser. São as vendas do período, não tudo que chegou.",
  },
  {
    head: "O frete entra no faturamento.",
    body: "R$ 30 de comida + R$ 15 de entrega aparecem como R$ 45. Está certo para faturamento bruto.",
  },
  {
    head: "O ticket médio mistura comida e frete.",
    body: "Por isso ele não serve para decidir preço de cardápio — para isso, olhe o preço dos produtos.",
  },
];
```

- [ ] **Step 4: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src/features/summary/summary.ts apps/panel/test/summary.test.ts
git commit -m "feat(panel): ✨ adiciona a regra do resumo do dia"
```

---

### Task 2: A tela do Resumo do dia

**Files:**
- Modify: `apps/panel/src/features/orders/useSummary.ts`
- Create: `apps/panel/src/features/summary/SummaryPage.tsx`
- Create: `apps/panel/src/features/summary/SummaryPage.module.css`
- Modify: `apps/panel/src/router.tsx`, `apps/panel/src/layout/Rail.tsx`
- Test: `apps/panel/test/summary-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 inteira; `PERIODS` (`src/features/orders/orderFilters.ts`); `getOrdersSummary`; `useNow`.
- Produces:
  - `summaryQueryKey(restaurantId: string, period: Period): readonly ["orders", "summary", string, Period]`
  - `usePeriodSummary(restaurantId: string, period: Period)`; `useTodaySummary(restaurantId)` passa a ser `usePeriodSummary(restaurantId, "today")` — **a mesma chave de antes** (`["orders", "summary", restaurantId, "today"]`).
  - `SummaryPage` na rota `/resumo` (título "Resumo do dia").

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/summary-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTodaySummary } from "../src/features/orders/useSummary.ts";
import { SummaryPage } from "../src/features/summary/SummaryPage.tsx";
import { mockApi } from "./api-mock.ts";
import { makeSummary, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const SUMMARY = `/restaurants/${RESTAURANT_ID}/orders/summary`;

/** Faz o papel do header: a MESMA query de "hoje". */
function HeaderProbe() {
  const summary = useTodaySummary(RESTAURANT_ID);
  return <p data-testid="header">{summary.data?.revenueOrderCount ?? "—"}</p>;
}

const routes = [
  {
    path: "/resumo",
    element: (
      <>
        <HeaderProbe />
        <SummaryPage />
        <LocationProbe />
      </>
    ),
  },
];

const counts = {
  pending: 2,
  confirmed: 1,
  preparing: 1,
  ready_for_pickup: 0,
  out_for_delivery: 1,
  completed: 4,
  cancelled: 1,
};

describe("SummaryPage", () => {
  it("com Hoje, o Resumo e o header dividem UMA chamada", async () => {
    signIn();
    const api = mockApi(
      panelHandlers({ summary: { counts, revenueInCents: 45000, revenueOrderCount: 6, averageTicketInCents: 7500 } }),
    );
    renderInPanel(routes, "/resumo");
    expect(await screen.findByText("de 6 pedidos aceitos — inclui o frete cobrado")).toBeTruthy();
    expect(screen.getByTestId("header").textContent).toBe("6");
    const todayCalls = api.calls.filter((call) => call.path === SUMMARY && call.query.period === "today");
    expect(todayCalls).toHaveLength(1);
  });

  it("os três números, as cinco linhas e as três notas", async () => {
    signIn();
    mockApi(
      panelHandlers({ summary: { counts, revenueInCents: 45000, revenueOrderCount: 6, averageTicketInCents: 7500 } }),
    );
    renderInPanel(routes, "/resumo");
    expect(await screen.findByText("10 chegaram no período")).toBeTruthy();
    expect(screen.getByText("faturamento ÷ pedidos aceitos")).toBeTruthy();
    for (const label of ["Novos", "Em preparo", "Prontos / em rota", "Concluídos", "Cancelados"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("Pedidos por status")).toBeTruthy();
    expect(screen.getByText("Como ler estes números")).toBeTruthy();
    expect(screen.getByText("Faturamento conta de aceito em diante.")).toBeTruthy();
    expect(screen.getByText("O ticket médio mistura comida e frete.")).toBeTruthy();
  });

  it("Ontem busca period=yesterday e vai para a URL", async () => {
    signIn();
    const api = mockApi([
      {
        method: "GET",
        path: SUMMARY,
        query: { period: "yesterday" },
        body: makeSummary({ revenueOrderCount: 3 }),
      },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/resumo");
    fireEvent.click(await screen.findByRole("button", { name: "Ontem" }));
    expect(await screen.findByText("de 3 pedidos aceitos — inclui o frete cobrado")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/resumo?period=yesterday");
    expect(api.calls.some((call) => call.path === SUMMARY && call.query.period === "yesterday")).toBe(true);
  });

  it("Ontem não diz 'Fechamento parcial'", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/resumo?period=yesterday");
    expect(await screen.findByText(/^atualizado há/)).toBeTruthy();
    expect(screen.queryByText(/Fechamento parcial/)).toBeNull();
  });

  it("um refetch que falha não troca os números pela mensagem", async () => {
    signIn();
    const api = mockApi(panelHandlers({ summary: { counts, revenueOrderCount: 6 } }));
    const { queryClient } = renderInPanel(routes, "/resumo");
    await screen.findByText("10 chegaram no período");
    api.add({
      method: "GET",
      path: SUMMARY,
      status: 503,
      body: { statusCode: 503, error: "Service Unavailable", message: "Fora do ar" },
      once: true,
    });
    await queryClient.refetchQueries({ queryKey: ["orders", "summary"] });
    await waitFor(() => expect(screen.getByText("10 chegaram no período")).toBeTruthy());
    expect(screen.queryByText("Fora do ar")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/summary-page.test.tsx`
Expected: FAIL — `SummaryPage` não existe.

- [ ] **Step 3: Os hooks do resumo**

Substitua `apps/panel/src/features/orders/useSummary.ts` por:

```ts
import { useQuery } from "@tanstack/react-query";
import { getOrdersSummary } from "../../api/orders.ts";
import type { Period } from "../../api/types.ts";
import { ORDERS_POLL_MS } from "./polling.ts";

/** Sob o prefixo `"orders"`: qualquer ação num pedido atualiza o resumo junto. */
export function summaryQueryKey(restaurantId: string, period: Period) {
  return ["orders", "summary", restaurantId, period] as const;
}

export function usePeriodSummary(restaurantId: string, period: Period) {
  return useQuery({
    queryKey: summaryQueryKey(restaurantId, period),
    queryFn: () => getOrdersSummary(restaurantId, { period }),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

/**
 * Os números do header ("Aceitos hoje · Faturamento · Ticket médio"). O
 * Resumo do dia, com o período Hoje, usa ESTA query: duas fontes fariam os
 * números divergirem, e o operador deixaria de confiar nos dois (handoff).
 */
export function useTodaySummary(restaurantId: string) {
  return usePeriodSummary(restaurantId, "today");
}
```

- [ ] **Step 4: O CSS**

Crie `apps/panel/src/features/summary/SummaryPage.module.css`:

```css
.page {
  display: grid;
  gap: 16px;
  max-width: 1080px;
  padding: 16px 20px 24px;
}

.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.segmented {
  display: inline-flex;
  height: 36px;
  overflow: hidden;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 6px;
}

.segment {
  padding: 0 12px;
  border: 0;
  border-left: 1px solid var(--mc-line);
  background: transparent;
  color: var(--mc-ink2);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.segment:first-child {
  border-left: 0;
}

.segment:hover {
  background: var(--mc-surface3);
}

.segment[aria-pressed="true"] {
  background: var(--mc-accent-soft);
  color: var(--mc-accent-hi);
}

.sync {
  font-size: 12.5px;
  color: var(--mc-ink3);
}

.numbers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
}

.number {
  display: grid;
  gap: 4px;
  padding: 16px 18px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.eyebrow {
  font-size: 12px;
  font-weight: 600;
  color: var(--mc-ink3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.value {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.1;
}

.sub {
  font-size: 13px;
  color: var(--mc-ink2);
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

.rows {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) 64px minmax(0, 3fr);
  align-items: center;
  gap: 12px;
}

.label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex: 0 0 8px;
}

.count {
  font-size: 16px;
  font-weight: 700;
  text-align: right;
}

.track {
  height: 8px;
  background: var(--mc-surface3);
  border-radius: 999px;
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: 999px;
}

.tone_new {
  background: var(--mc-warn-strong);
}

.tone_preparing {
  background: var(--mc-ink3);
}

.tone_ready,
.tone_done {
  background: var(--mc-accent);
}

.tone_cancelled {
  background: var(--mc-danger);
}

.notes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}

.note {
  margin: 0;
  padding: 12px 14px;
  font-size: 13px;
  color: var(--mc-ink2);
  background: var(--mc-surface2);
  border-radius: 8px;
}

.noteHead {
  color: var(--mc-ink);
}

.loading {
  color: var(--mc-ink2);
}
```

- [ ] **Step 5: A tela**

Crie `apps/panel/src/features/summary/SummaryPage.tsx`:

```tsx
import { useSearchParams } from "react-router";
import { describeError } from "../../api/client.ts";
import type { Period } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { useNow } from "../../lib/useNow.ts";
import { PERIODS } from "../orders/orderFilters.ts";
import { usePeriodSummary } from "../orders/useSummary.ts";
import { bigNumbers, parsePeriod, READING_NOTES, statusRows, syncLabel } from "./summary.ts";
import classes from "./SummaryPage.module.css";

export function SummaryPage() {
  const { restaurantId } = useSessionUser();
  const [params, setParams] = useSearchParams();
  const period = parsePeriod(params.get("period"));
  // Com Hoje, é a MESMA query do header (`useTodaySummary`): uma chamada só,
  // e os dois lugares nunca divergem.
  const summary = usePeriodSummary(restaurantId, period);
  const now = useNow();

  const choose = (next: Period) => {
    setParams(next === "today" ? {} : { period: next });
  };

  return (
    <div className={classes.page}>
      <div className={classes.bar}>
        <div className={classes.segmented} role="group" aria-label="Período">
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={classes.segment}
              aria-pressed={period === option.value}
              onClick={() => choose(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {summary.dataUpdatedAt > 0 && (
          <span className={`${classes.sync} n`}>{syncLabel(period, summary.dataUpdatedAt, now)}</span>
        )}
      </div>

      {summary.data === undefined ? (
        // Carregando/erro só quando não há dado: um refetch que falha mantém
        // os números antigos na tela.
        <p className={classes.loading}>
          {summary.isError ? describeError(summary.error) : "Carregando resumo…"}
        </p>
      ) : (
        <>
          <div className={classes.numbers}>
            {bigNumbers(summary.data).map((number) => (
              <section key={number.label} className={classes.number} aria-label={number.label}>
                <span className={classes.eyebrow}>{number.label}</span>
                <strong className={`${classes.value} n`}>{number.value}</strong>
                <span className={classes.sub}>{number.sub}</span>
              </section>
            ))}
          </div>

          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Pedidos por status</h2>
            <ul className={classes.rows}>
              {statusRows(summary.data.counts).map((row) => (
                <li key={row.label} className={classes.row}>
                  <span className={classes.label}>
                    <span className={`${classes.dot} ${classes[`tone_${row.tone}`]}`} aria-hidden="true" />
                    {row.label}
                  </span>
                  <span className={`${classes.count} n`}>{row.count}</span>
                  <span className={classes.track} aria-hidden="true">
                    <span
                      className={`${classes.fill} ${classes[`tone_${row.tone}`]}`}
                      style={{ width: `${Math.round(row.share * 100)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Como ler estes números</h2>
            <div className={classes.notes}>
              {READING_NOTES.map((note) => (
                <p key={note.head} className={classes.note}>
                  <strong className={classes.noteHead}>{note.head}</strong> {note.body}
                </p>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Rota e rail**

Em `apps/panel/src/router.tsx`, importe `import { SummaryPage } from "./features/summary/SummaryPage.tsx";` e acrescente, logo depois da rota `/pedidos`:

```tsx
              { path: "/resumo", handle: { title: "Resumo do dia" }, element: <SummaryPage /> },
```

Em `apps/panel/src/layout/Rail.tsx`, no grupo "Operação", acrescente depois de Pedidos:

```tsx
      { to: "/pedidos", label: "Pedidos" },
      { to: "/resumo", label: "Resumo do dia" },
```

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/summary-page.test.tsx test/layout.test.tsx`
Expected: PASS. O header (`test/layout.test.tsx`) continua lendo os mesmos números.

- [ ] **Step 8: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src apps/panel/test/summary-page.test.tsx
git commit -m "feat(panel): ✨ adiciona o resumo do dia"
```

---

### Task 3: A regra da cozinha, em forma pura

**Files:**
- Create: `apps/panel/src/features/kitchen/kitchen.ts`
- Test: `apps/panel/test/kitchen.test.ts`

**Interfaces:**
- Consumes: `Order`, `OrderStatus`, `OrderTransition` (`src/api/types.ts`); `orderCode` (`src/lib/orderCode.ts`); `ConfirmCopy` (`src/ui/confirmCopy.ts`).
- Produces:
  - `type KitchenColumnId = "new" | "doing"`
  - `KITCHEN_COLUMNS: readonly { id: KitchenColumnId; title: string; empty: string }[]`
  - `kitchenColumn(status: OrderStatus): KitchenColumnId | null`
  - `kitchenAction(order: Pick<Order, "type" | "status">): { transition: OrderTransition; label: string } | null`
  - `kitchenAcceptCopy(order: Pick<Order, "id">): ConfirmCopy`
  - `byArrival<T extends Pick<Order, "createdAt" | "id">>(orders: readonly T[]): T[]`

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/kitchen.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  byArrival,
  KITCHEN_COLUMNS,
  kitchenAcceptCopy,
  kitchenAction,
  kitchenColumn,
} from "../src/features/kitchen/kitchen.ts";

describe("colunas", () => {
  it("texto literal do protótipo", () => {
    expect(KITCHEN_COLUMNS).toEqual([
      { id: "new", title: "Entraram agora", empty: "Nada novo." },
      { id: "doing", title: "Fazendo", empty: "Bancada limpa." },
    ]);
  });

  it("pendente entra agora; aceito e em preparo são o que se faz; o resto sai da cozinha", () => {
    expect(kitchenColumn("pending")).toBe("new");
    expect(kitchenColumn("confirmed")).toBe("doing");
    expect(kitchenColumn("preparing")).toBe("doing");
    expect(kitchenColumn("out_for_delivery")).toBeNull();
    expect(kitchenColumn("ready_for_pickup")).toBeNull();
    expect(kitchenColumn("completed")).toBeNull();
    expect(kitchenColumn("cancelled")).toBeNull();
  });
});

describe("o botão", () => {
  it("as cinco combinações da spec", () => {
    expect(kitchenAction({ status: "pending", type: "delivery" })).toEqual({
      transition: "accept",
      label: "Aceitar e começar",
    });
    expect(kitchenAction({ status: "confirmed", type: "takeaway" })).toEqual({
      transition: "start-preparing",
      label: "Começar preparo",
    });
    expect(kitchenAction({ status: "preparing", type: "delivery" })).toEqual({
      transition: "dispatch",
      label: "Pronto — despachar",
    });
    expect(kitchenAction({ status: "preparing", type: "takeaway" })).toEqual({
      transition: "ready",
      label: "Pronto para retirada",
    });
    expect(kitchenAction({ status: "preparing", type: "dine_in" })).toEqual({
      transition: "complete",
      label: "Pronto — servir",
    });
    expect(kitchenAction({ status: "completed", type: "dine_in" })).toBeNull();
  });
});

describe("a confirmação de aceite", () => {
  it("não fala de dinheiro nem de cliente", () => {
    const copy = kitchenAcceptCopy({ id: "a3f9c2d1-0000-4000-8000-000000000001" });
    expect(copy.title).toBe("Aceitar o pedido #A3F9?");
    expect(copy.body).toBe("Aceitar manda o pedido para a cozinha e baixa o estoque dos itens.");
    expect(copy.warn).toBe("Não existe desconfirmar. Depois de aceito, só cabe cancelar.");
    expect(copy.cta).toBe("Aceitar pedido");
    expect(JSON.stringify(copy)).not.toMatch(/R\$/);
  });
});

describe("byArrival", () => {
  it("o mais antigo primeiro, sem mexer no original", () => {
    const orders = [
      { id: "b", createdAt: "2026-09-21T12:10:00.000Z" },
      { id: "a", createdAt: "2026-09-21T12:00:00.000Z" },
    ];
    expect(byArrival(orders).map((order) => order.id)).toEqual(["a", "b"]);
    expect(orders[0].id).toBe("b");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/kitchen.test.ts`
Expected: FAIL — o módulo não existe.

- [ ] **Step 3: Implementar**

Crie `apps/panel/src/features/kitchen/kitchen.ts`:

```ts
import type { Order, OrderStatus, OrderTransition } from "../../api/types.ts";
import { orderCode } from "../../lib/orderCode.ts";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";

export type KitchenColumnId = "new" | "doing";

/** Texto literal do protótipo do handoff. */
export const KITCHEN_COLUMNS: readonly { id: KitchenColumnId; title: string; empty: string }[] = [
  { id: "new", title: "Entraram agora", empty: "Nada novo." },
  { id: "doing", title: "Fazendo", empty: "Bancada limpa." },
];

/** Pedido pronto (despachado, aguardando retirada) já saiu da bancada. */
export function kitchenColumn(status: OrderStatus): KitchenColumnId | null {
  if (status === "pending") return "new";
  if (status === "confirmed" || status === "preparing") return "doing";
  return null;
}

/**
 * Um botão por estado, texto literal do protótipo. `confirmed` só aparece
 * quando o segundo passo do aceite falhou: "Começar preparo" é a rede.
 */
export function kitchenAction(
  order: Pick<Order, "type" | "status">,
): { transition: OrderTransition; label: string } | null {
  switch (order.status) {
    case "pending":
      return { transition: "accept", label: "Aceitar e começar" };
    case "confirmed":
      return { transition: "start-preparing", label: "Começar preparo" };
    case "preparing":
      if (order.type === "delivery") return { transition: "dispatch", label: "Pronto — despachar" };
      if (order.type === "takeaway") return { transition: "ready", label: "Pronto para retirada" };
      return { transition: "complete", label: "Pronto — servir" };
    default:
      return null;
  }
}

/**
 * A confirmação de aceite do painel diz o nome e o total; a da cozinha, não —
 * a cozinha não decide dinheiro (handoff). O resto do texto é o mesmo.
 */
export function kitchenAcceptCopy(order: Pick<Order, "id">): ConfirmCopy {
  return {
    title: `Aceitar o pedido ${orderCode(order.id)}?`,
    body: "Aceitar manda o pedido para a cozinha e baixa o estoque dos itens.",
    warn: "Não existe desconfirmar. Depois de aceito, só cabe cancelar.",
    cta: "Aceitar pedido",
    tone: "accent",
  };
}

/** A bancada trabalha na ordem de chegada: o mais antigo primeiro. */
export function byArrival<T extends Pick<Order, "createdAt" | "id">>(orders: readonly T[]): T[] {
  return [...orders].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/kitchen.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src/features/kitchen/kitchen.ts apps/panel/test/kitchen.test.ts
git commit -m "feat(panel): ✨ adiciona a regra do modo cozinha"
```

---

### Task 4: O que a cozinha precisa das peças da parte 1

**Files:**
- Modify: `apps/panel/src/api/orders.ts`
- Modify: `apps/panel/src/features/orders/useNewOrderAlert.ts`
- Modify: `apps/panel/src/features/orders/orderActionFlow.tsx`
- Test: `apps/panel/test/kitchen-infra.test.tsx`

**Interfaces:**
- Consumes: `kitchenAcceptCopy` (Task 3).
- Produces:
  - `listOrdersByStatus(restaurantId: string, status: OrderStatus): Promise<Order[]>` — sem recorte de data, do mais antigo para o mais novo.
  - `useNewOrderAlert(restaurantId)` devolve também `pendingOrders: Order[] | undefined` (a lista da MESMA query que ele já vigia).
  - `OrderActionProvider` aceita `mode?: "panel" | "kitchen"` (padrão `"panel"`). Em `"kitchen"`: a confirmação de aceite é `kitchenAcceptCopy` e o diálogo de estoque insuficiente só tem "Fechar" (sem "Repor estoque" nem "Recusar pedido": cancelar não existe na cozinha).

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/kitchen-infra.test.tsx`:

```tsx
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { listOrdersByStatus } from "../src/api/orders.ts";
import type { Order } from "../src/api/types.ts";
import { OrderActionProvider, useOrderAction } from "../src/features/orders/orderActionFlow.tsx";
import { mockApi } from "./api-mock.ts";
import { makeOrder, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;
const ID = "a3f9c2d1-0000-4000-8000-000000000001";

function AcceptButton({ order }: { order: Order }) {
  const { request } = useOrderAction();
  return (
    <button type="button" onClick={() => request(order, "accept")}>
      aceitar
    </button>
  );
}

describe("listOrdersByStatus", () => {
  it("filtra só pelo status, sem período, do mais antigo para o mais novo", async () => {
    const api = mockApi([
      { method: "GET", path: LIST, body: { data: [makeOrder({ status: "preparing" })], limit: 100, offset: 0, total: 1 } },
    ]);
    const orders = await listOrdersByStatus(RESTAURANT_ID, "preparing");
    expect(orders).toHaveLength(1);
    expect(api.calls[0].query).toEqual({ status: "preparing", sort: "createdAt", order: "asc", limit: "100", offset: "0" });
  });
});

describe("OrderActionProvider em modo cozinha", () => {
  it("a confirmação de aceite não mostra nome nem total", async () => {
    signIn();
    mockApi(panelHandlers());
    const order = makeOrder({ id: ID, status: "pending", totalInCents: 10100 });
    renderInPanel(
      [
        {
          path: "/cozinha",
          element: (
            <OrderActionProvider restaurantId={RESTAURANT_ID} disabled={false} mode="kitchen">
              <AcceptButton order={order} />
            </OrderActionProvider>
          ),
        },
      ],
      "/cozinha",
    );
    fireEvent.click(await screen.findByRole("button", { name: "aceitar" }));
    const dialog = await screen.findByRole("dialog", { name: "Aceitar o pedido #A3F9?" });
    expect(within(dialog).getByText("Aceitar manda o pedido para a cozinha e baixa o estoque dos itens.")).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/R\$/);
    expect(dialog.textContent).not.toContain("Marcela");
  });

  it("no painel, a confirmação continua com nome e total", async () => {
    signIn();
    mockApi(panelHandlers());
    const order = makeOrder({ id: ID, status: "pending", totalInCents: 10100 });
    renderInPanel(
      [
        {
          path: "/pedidos",
          element: (
            <OrderActionProvider restaurantId={RESTAURANT_ID} disabled={false}>
              <AcceptButton order={order} />
            </OrderActionProvider>
          ),
        },
      ],
      "/pedidos",
    );
    fireEvent.click(await screen.findByRole("button", { name: "aceitar" }));
    const dialog = await screen.findByRole("dialog", { name: "Aceitar o pedido #A3F9?" });
    expect(dialog.textContent).toMatch(/R\$/);
  });

  it("estoque insuficiente na cozinha só oferece Fechar", async () => {
    signIn();
    mockApi([
      {
        method: "POST",
        path: `${LIST}/${ID}/confirm`,
        status: 409,
        body: { statusCode: 409, error: "Conflict", message: "Estoque insuficiente para Pizza Grande" },
      },
      ...panelHandlers(),
    ]);
    const order = makeOrder({ id: ID, status: "pending" });
    renderInPanel(
      [
        {
          path: "/cozinha",
          element: (
            <OrderActionProvider restaurantId={RESTAURANT_ID} disabled={false} mode="kitchen">
              <AcceptButton order={order} />
            </OrderActionProvider>
          ),
        },
      ],
      "/cozinha",
    );
    fireEvent.click(await screen.findByRole("button", { name: "aceitar" }));
    const confirm = await screen.findByRole("dialog", { name: "Aceitar o pedido #A3F9?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Aceitar pedido" }));
    const failure = await screen.findByRole("dialog", { name: "Estoque acabou ao aceitar" });
    expect(within(failure).getByRole("button", { name: "Fechar" })).toBeTruthy();
    expect(within(failure).queryByRole("button", { name: "Recusar pedido" })).toBeNull();
    expect(within(failure).queryByRole("button", { name: "Repor estoque" })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/kitchen-infra.test.tsx`
Expected: FAIL — `listOrdersByStatus` não existe e o provider não conhece `mode`.

- [ ] **Step 3: `listOrdersByStatus`**

Em `apps/panel/src/api/orders.ts`, acrescente `OrderStatus` ao import de tipos e, ao fim do arquivo:

```ts
/**
 * Todos os pedidos de UM status, sem recorte de data, do mais antigo para o
 * mais novo. É o "Fazendo" da cozinha: um prato em preparo às 23:50 não pode
 * sumir da bancada à meia-noite, como sumiria com `period: "today"`.
 */
export function listOrdersByStatus(restaurantId: string, status: OrderStatus): Promise<Order[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<Order>>(`/restaurants/${restaurantId}/orders`, {
      query: { status, sort: "createdAt", order: "asc", limit: 100, offset },
    }),
  ).then((result) => result.items);
}
```

- [ ] **Step 4: `pendingOrders` no aviso de pedido novo**

Em `apps/panel/src/features/orders/useNewOrderAlert.ts`, troque o `return` final por:

```ts
  // `pendingOrders` é a MESMA lista que o aviso vigia: a cozinha a mostra em
  // "Entraram agora" sem uma requisição a mais.
  return { pendingCount, soundBlocked, enableSound, pendingOrders: pending.data };
```

- [ ] **Step 5: O modo cozinha do `OrderActionProvider`**

Em `apps/panel/src/features/orders/orderActionFlow.tsx`:

1. Acrescente o import `import { kitchenAcceptCopy } from "../kitchen/kitchen.ts";`.
2. Na assinatura do `OrderActionProvider`, acrescente a prop:

```tsx
export function OrderActionProvider({
  restaurantId,
  disabled,
  mode = "panel",
  children,
}: {
  restaurantId: string;
  disabled: boolean;
  /**
   * `"kitchen"`: a confirmação de aceite não mostra nome nem total, e o
   * diálogo de estoque insuficiente só fecha — cancelar e repor estoque não
   * são ações da bancada.
   */
  mode?: "panel" | "kitchen";
  children: ReactNode;
}) {
```

3. Troque o cálculo de `copy` por:

```tsx
  const copy: ConfirmCopy | null =
    confirming === null
      ? null
      : confirming.transition === "accept"
        ? mode === "kitchen"
          ? kitchenAcceptCopy(confirming.order)
          : acceptCopy(confirming.order)
        : cancelCopy(confirming.order);
```

4. No `Modal` de falha, troque a condição dos botões `{failure.stock ? (` por `{failure.stock && mode === "panel" ? (` — o texto da falha continua o mesmo nos dois modos.

- [ ] **Step 6: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/kitchen-infra.test.tsx test/order-actions.test.tsx test/new-order-alert.test.tsx`
Expected: PASS. Os testes da parte 1 continuam passando sem edição.

- [ ] **Step 7: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src apps/panel/test/kitchen-infra.test.tsx
git commit -m "feat(panel): ✨ prepara as ações e os pendentes para a cozinha"
```

---

### Task 5: A tela do Modo cozinha

**Files:**
- Create: `apps/panel/src/features/kitchen/useKitchen.ts`
- Create: `apps/panel/src/features/kitchen/KitchenPage.tsx`
- Create: `apps/panel/src/features/kitchen/KitchenPage.module.css`
- Modify: `apps/panel/src/features/orders/FilterBar.tsx`
- Modify: `apps/panel/src/router.tsx`
- Test: `apps/panel/test/kitchen-page.test.tsx`

**Interfaces:**
- Consumes: Task 3 (`KITCHEN_COLUMNS`, `kitchenColumn`, `kitchenAction`, `byArrival`); Task 4 (`listOrdersByStatus`, `pendingOrders`, `mode="kitchen"`); `getOrder`; `useOrderAction`; `orderCode`, `typeLabel`, `groupOptions`, `formatElapsed`, `useNow`, `useOnline`.
- Produces: `KitchenPage` na rota `/cozinha`, **fora** do `PanelLayout`; o botão "Modo cozinha" na barra de filtros de Pedidos.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/kitchen-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Order } from "../src/api/types.ts";
import { KitchenPage } from "../src/features/kitchen/KitchenPage.tsx";
import { OrdersPage } from "../src/features/orders/OrdersPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOrder, makeOrderDetail, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;
const NEW_ID = "a3f9c2d1-0000-4000-8000-000000000001";
const DOING_ID = "b7e10000-0000-4000-8000-000000000002";

function page(orders: Order[]) {
  return { data: orders, limit: 100, offset: 0, total: orders.length };
}

function kitchenHandlers(
  pending: Order[],
  confirmed: Order[],
  preparing: Order[],
): MockHandler[] {
  const details = [...pending, ...confirmed, ...preparing].map(
    (order): MockHandler => ({
      method: "GET",
      path: `${LIST}/${order.id}`,
      body: makeOrderDetail({ id: order.id, type: order.type, status: order.status }),
    }),
  );
  return [
    ...details,
    { method: "GET", path: LIST, query: { status: "confirmed" }, body: page(confirmed) },
    { method: "GET", path: LIST, query: { status: "preparing" }, body: page(preparing) },
    ...panelHandlers({ pending }),
  ];
}

const routes = [
  { path: "/cozinha", element: <KitchenPage /> },
  { path: "/pedidos", element: <LocationProbe /> },
];

describe("KitchenPage", () => {
  it("pendente em 'Entraram agora', em preparo em 'Fazendo'", async () => {
    signIn();
    mockApi(
      kitchenHandlers(
        [makeOrder({ id: NEW_ID, status: "pending" })],
        [],
        [makeOrder({ id: DOING_ID, status: "preparing", type: "delivery" })],
      ),
    );
    renderInPanel(routes, "/cozinha");
    const novos = await screen.findByRole("region", { name: "Entraram agora" });
    const fazendo = screen.getByRole("region", { name: "Fazendo" });
    expect(await within(novos).findByText("#A3F9")).toBeTruthy();
    expect(await within(fazendo).findByText("#B7E1")).toBeTruthy();
  });

  it("nenhum dinheiro na tela", async () => {
    signIn();
    mockApi(
      kitchenHandlers(
        [makeOrder({ id: NEW_ID, status: "pending" })],
        [],
        [makeOrder({ id: DOING_ID, status: "preparing" })],
      ),
    );
    renderInPanel(routes, "/cozinha");
    // os itens chegam do detalhe: espere-os, e aí nada em reais pode ter vindo junto
    expect((await screen.findAllByText("Pizza Grande")).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/R\$/);
    expect(document.body.textContent).not.toContain("Marcela");
  });

  it("'Aceitar e começar' confirma e manda confirm + start-preparing", async () => {
    signIn();
    const api = mockApi([
      { method: "POST", path: `${LIST}/${NEW_ID}/confirm`, body: makeOrderDetail({ id: NEW_ID, status: "confirmed" }) },
      {
        method: "POST",
        path: `${LIST}/${NEW_ID}/start-preparing`,
        body: makeOrderDetail({ id: NEW_ID, status: "preparing" }),
      },
      ...kitchenHandlers([makeOrder({ id: NEW_ID, status: "pending" })], [], []),
    ]);
    renderInPanel(routes, "/cozinha");
    fireEvent.click(await screen.findByRole("button", { name: "Aceitar e começar" }));
    const dialog = await screen.findByRole("dialog", { name: "Aceitar o pedido #A3F9?" });
    expect(dialog.textContent).not.toMatch(/R\$/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Aceitar pedido" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === `${LIST}/${NEW_ID}/start-preparing`)).toBe(true),
    );
    const confirmIndex = api.calls.findIndex((call) => call.path === `${LIST}/${NEW_ID}/confirm`);
    const startIndex = api.calls.findIndex((call) => call.path === `${LIST}/${NEW_ID}/start-preparing`);
    expect(confirmIndex).toBeLessThan(startIndex);
  });

  it("'Pronto — despachar' manda dispatch num pedido de entrega", async () => {
    signIn();
    const api = mockApi([
      {
        method: "POST",
        path: `${LIST}/${DOING_ID}/dispatch`,
        body: makeOrderDetail({ id: DOING_ID, status: "out_for_delivery" }),
      },
      ...kitchenHandlers([], [], [makeOrder({ id: DOING_ID, status: "preparing", type: "delivery" })]),
    ]);
    renderInPanel(routes, "/cozinha");
    fireEvent.click(await screen.findByRole("button", { name: "Pronto — despachar" }));
    await waitFor(() => expect(api.calls.some((call) => call.path === `${LIST}/${DOING_ID}/dispatch`)).toBe(true));
  });

  it("o detalhe de cada pedido é buscado uma vez só, mesmo com as listas atualizando", async () => {
    signIn();
    const api = mockApi(
      kitchenHandlers([], [], [makeOrder({ id: DOING_ID, status: "preparing" })]),
    );
    const { queryClient } = renderInPanel(routes, "/cozinha");
    expect((await screen.findAllByText("Pizza Grande")).length).toBeGreaterThan(0);
    await queryClient.invalidateQueries({ queryKey: ["orders"] });
    await waitFor(() =>
      expect(api.calls.filter((call) => call.query.status === "preparing").length).toBeGreaterThan(1),
    );
    expect(api.calls.filter((call) => call.path === `${LIST}/${DOING_ID}`)).toHaveLength(1);
  });

  it("colunas vazias dizem o texto do protótipo", async () => {
    signIn();
    mockApi(kitchenHandlers([], [], []));
    renderInPanel(routes, "/cozinha");
    expect(await screen.findByText("Nada novo.")).toBeTruthy();
    expect(await screen.findByText("Bancada limpa.")).toBeTruthy();
  });

  it("'Sair do modo cozinha' volta a /pedidos", async () => {
    signIn();
    mockApi(kitchenHandlers([], [], []));
    renderInPanel(routes, "/cozinha");
    fireEvent.click(await screen.findByRole("link", { name: "Sair do modo cozinha" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/pedidos");
  });

  it("o botão 'Modo cozinha' em Pedidos leva a /cozinha", async () => {
    signIn();
    mockApi([
      { method: "GET", path: `/restaurants/${RESTAURANT_ID}/tables`, body: page([]) },
      ...panelHandlers(),
      { method: "GET", path: LIST, body: page([]) },
    ]);
    renderInPanel(
      [
        { path: "/pedidos", element: <OrdersPage /> },
        { path: "/cozinha", element: <LocationProbe /> },
      ],
      "/pedidos",
    );
    fireEvent.click(await screen.findByRole("link", { name: "Modo cozinha" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/cozinha");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/kitchen-page.test.tsx`
Expected: FAIL — `KitchenPage` não existe.

- [ ] **Step 3: Os hooks da cozinha**

Crie `apps/panel/src/features/kitchen/useKitchen.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getOrder, listOrdersByStatus } from "../../api/orders.ts";
import type { OrderStatus } from "../../api/types.ts";
import { ORDERS_POLL_MS } from "../orders/polling.ts";
import { byArrival } from "./kitchen.ts";

/** Sob o prefixo `"orders"`: toda ação num pedido invalida estas listas junto. */
function useOrdersByStatus(restaurantId: string, status: OrderStatus) {
  return useQuery({
    queryKey: ["orders", "by-status", restaurantId, status],
    queryFn: () => listOrdersByStatus(restaurantId, status),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

/**
 * "Fazendo" = aceitos + em preparo. Duas listas a 10 s (12 req/min); os
 * pendentes vêm da query do aviso de pedido novo, sem custo a mais.
 */
export function useDoingOrders(restaurantId: string) {
  const confirmed = useOrdersByStatus(restaurantId, "confirmed");
  const preparing = useOrdersByStatus(restaurantId, "preparing");
  const loaded = confirmed.data !== undefined && preparing.data !== undefined;
  return {
    orders: loaded ? byArrival([...(confirmed.data ?? []), ...(preparing.data ?? [])]) : undefined,
    error: confirmed.error ?? preparing.error,
  };
}

/**
 * Os itens de UM pedido, buscados uma vez só. A listagem da API não traz
 * itens, mas eles são congelados na criação (`order_items` guarda cópia) e
 * nunca mudam. A chave fica FORA do prefixo `"orders"` de propósito: toda
 * ação invalida `["orders"]`, e o detalhe seria refeito para cada cartão da
 * bancada a cada clique — o estado do pedido vem das listas.
 */
export function useOrderItems(restaurantId: string, orderId: string) {
  return useQuery({
    queryKey: ["order-items", restaurantId, orderId],
    queryFn: async () => (await getOrder(restaurantId, orderId)).items,
    staleTime: Infinity,
  });
}
```

- [ ] **Step 4: O CSS**

Crie `apps/panel/src/features/kitchen/KitchenPage.module.css`:

```css
.page {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 100vh;
  background: var(--mc-bg);
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  background: var(--mc-surface);
  border-bottom: 1px solid var(--mc-line);
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.note {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--mc-ink2);
}

.topActions {
  display: flex;
  gap: 8px;
}

.columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(330px, 1fr));
  gap: 16px;
  padding: 16px 20px;
  overflow-x: auto;
  align-items: start;
}

.column {
  display: grid;
  gap: 12px;
  align-content: start;
}

.columnHead {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
}

.dot_new {
  background: var(--mc-warn-strong);
}

.dot_doing {
  background: var(--mc-ink3);
}

.empty {
  margin: 0;
  padding: 24px 12px;
  text-align: center;
  font-size: 15px;
  color: var(--mc-ink3);
  border: 1px dashed var(--mc-line-hi);
  border-radius: 10px;
}

.card {
  display: grid;
  gap: 12px;
  padding: 16px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-left: 4px solid var(--mc-ink3);
  border-radius: 10px;
}

.card_new {
  border-left-color: var(--mc-warn-strong);
}

.cardHead {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.code {
  font-size: 22px;
  font-weight: 700;
}

.type {
  flex: 1 1 auto;
  font-size: 15px;
  font-weight: 600;
  color: var(--mc-ink2);
}

.time {
  font-size: 17px;
  font-weight: 700;
}

.items {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  column-gap: 12px;
  font-size: 21px;
  line-height: 1.25;
}

.qty {
  font-weight: 700;
}

.option {
  grid-column: 2;
  padding-left: 0;
  font-size: 17px;
  color: var(--mc-ink2);
}

.itemsNote {
  margin: 0;
  font-size: 15px;
  color: var(--mc-ink3);
}

.error {
  margin: 0;
  font-size: 14px;
  color: var(--mc-danger);
}
```

(As opções ficam na segunda coluna da grade do item — 46 px da quantidade + 12 px de espaço = os 58 px de recuo do handoff.)

- [ ] **Step 5: A tela**

Crie `apps/panel/src/features/kitchen/KitchenPage.tsx`:

```tsx
import { Button } from "@mantine/core";
import { Link } from "react-router";
import { describeError } from "../../api/client.ts";
import type { Order } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { orderCode } from "../../lib/orderCode.ts";
import { formatElapsed } from "../../lib/time.ts";
import { useNow } from "../../lib/useNow.ts";
import { useOnline } from "../../lib/useOnline.ts";
import { OrderActionProvider, useOrderAction } from "../orders/orderActionFlow.tsx";
import { groupOptions, typeLabel } from "../orders/presentation.ts";
import { useNewOrderAlert } from "../orders/useNewOrderAlert.ts";
import { byArrival, KITCHEN_COLUMNS, type KitchenColumnId, kitchenAction } from "./kitchen.ts";
import classes from "./KitchenPage.module.css";
import { useDoingOrders, useOrderItems } from "./useKitchen.ts";

/**
 * Nada de dinheiro aqui: preço, total, frete, forma de pagamento, telefone e
 * nome do cliente ficam de fora (handoff). A cozinha não decide dinheiro, e
 * cada dado a mais é uma linha para varrer com o olho no pico.
 */
function KitchenCard({
  restaurantId,
  order,
  column,
  now,
}: {
  restaurantId: string;
  order: Order;
  column: KitchenColumnId;
  now: number;
}) {
  const items = useOrderItems(restaurantId, order.id);
  const action = kitchenAction(order);
  const { request, busyOrderId, disabled } = useOrderAction();
  const code = orderCode(order.id);
  const where = order.type === "dine_in" && order.table !== null ? ` · ${order.table.label}` : "";

  return (
    <article
      className={`${classes.card} ${column === "new" ? classes.card_new : ""}`}
      aria-label={`Pedido ${code}`}
    >
      <header className={classes.cardHead}>
        <span className={`${classes.code} n`}>{code}</span>
        <span className={classes.type}>
          {typeLabel(order.type)}
          {where}
        </span>
        <span className={`${classes.time} n`}>{formatElapsed(order.createdAt, now)}</span>
      </header>

      {items.data === undefined ? (
        <p className={classes.itemsNote}>
          {items.isError ? "Não foi possível carregar os itens." : "Carregando itens…"}
        </p>
      ) : (
        <ul className={classes.items}>
          {items.data.map((item) => (
            <li key={item.id} className={classes.item}>
              <span className={`${classes.qty} n`}>{item.quantity}×</span>
              <span>{item.name}</span>
              {groupOptions(item.options).map((group) => (
                <span key={group.groupName} className={classes.option}>
                  {group.groupName}: {group.text}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}

      {action !== null && (
        <Button
          h={54}
          fullWidth
          loading={busyOrderId === order.id}
          disabled={disabled || (busyOrderId !== null && busyOrderId !== order.id)}
          onClick={() => request(order, action.transition)}
        >
          {action.label}
        </Button>
      )}
    </article>
  );
}

function KitchenColumn({
  restaurantId,
  id,
  title,
  empty,
  orders,
  error,
  now,
}: {
  restaurantId: string;
  id: KitchenColumnId;
  title: string;
  empty: string;
  orders: Order[] | undefined;
  error: unknown;
  now: number;
}) {
  return (
    <section className={classes.column} aria-label={title}>
      <h2 className={classes.columnHead}>
        <span className={`${classes.dot} ${classes[`dot_${id}`]}`} aria-hidden="true" />
        {title}
        {orders !== undefined && <span className="n">{orders.length}</span>}
      </h2>
      {orders === undefined ? (
        <p className={error ? classes.error : classes.itemsNote}>
          {error ? describeError(error) : "Carregando pedidos…"}
        </p>
      ) : orders.length === 0 ? (
        <p className={classes.empty}>{empty}</p>
      ) : (
        orders.map((order) => (
          <KitchenCard key={order.id} restaurantId={restaurantId} order={order} column={id} now={now} />
        ))
      )}
    </section>
  );
}

export function KitchenPage() {
  const { restaurantId } = useSessionUser();
  // A cozinha está fora da casca, então monta o aviso de pedido novo por
  // conta própria — bipe e título da aba continuam valendo aqui. A lista
  // que ele vigia é a mesma de "Entraram agora": nenhuma requisição a mais.
  const alert = useNewOrderAlert(restaurantId);
  const doing = useDoingOrders(restaurantId);
  const online = useOnline();
  const now = useNow();

  const byColumn: Record<KitchenColumnId, { orders: Order[] | undefined; error: unknown }> = {
    new: { orders: alert.pendingOrders === undefined ? undefined : byArrival(alert.pendingOrders), error: null },
    doing: { orders: doing.orders, error: doing.error },
  };

  return (
    <OrderActionProvider restaurantId={restaurantId} disabled={!online} mode="kitchen">
      <div className={classes.page}>
        <header className={classes.top}>
          <div>
            <h1 className={classes.title}>Modo cozinha</h1>
            <p className={classes.note}>
              Tela para o tablet da bancada: só o que a cozinha precisa fazer. Sem preço, sem forma de
              pagamento, sem telefone — tipografia grande para leitura a um metro.
            </p>
          </div>
          <div className={classes.topActions}>
            {alert.soundBlocked && (
              <Button variant="default" onClick={alert.enableSound}>
                Som desligado · Ativar som
              </Button>
            )}
            <Button component={Link} to="/pedidos" variant="default">
              Sair do modo cozinha
            </Button>
          </div>
        </header>
        <div className={classes.columns}>
          {KITCHEN_COLUMNS.map((column) => (
            <KitchenColumn
              key={column.id}
              restaurantId={restaurantId}
              id={column.id}
              title={column.title}
              empty={column.empty}
              orders={byColumn[column.id].orders}
              error={byColumn[column.id].error}
              now={now}
            />
          ))}
        </div>
      </div>
    </OrderActionProvider>
  );
}
```

- [ ] **Step 6: Rota e botão de entrada**

Em `apps/panel/src/router.tsx`, importe `import { KitchenPage } from "./features/kitchen/KitchenPage.tsx";` e, dentro dos `children` de `RequireVerified`, acrescente **ao lado** do objeto do `PanelLayout` (fora da casca):

```tsx
          { path: "/cozinha", element: <KitchenPage />, errorElement: <RouteError /> },
```

Em `apps/panel/src/features/orders/FilterBar.tsx`, acrescente `import { Link } from "react-router";` e, dentro de `<div className={classes.right}>`, antes do `<span>` do `syncLabel`:

```tsx
          <Button component={Link} to="/cozinha" variant="default">
            Modo cozinha
          </Button>
```

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/kitchen-page.test.tsx test/orders-page.test.tsx test/order-actions.test.tsx`
Expected: PASS.

- [ ] **Step 8: Verificação completa e commit**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel test && pnpm lint && pnpm build
git add apps/panel/src apps/panel/test/kitchen-page.test.tsx
git commit -m "feat(panel): ✨ adiciona o modo cozinha"
```

---

### Task 6: Documentação e verificação final

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-21-painel-resumo-cozinha-parte-3a-design.md`

- [ ] **Step 1: `CLAUDE.md`**

Na seção `### Painel da loja (\`apps/panel\`)`, acrescente ao fim da lista, antes de `### Monorepo`:

```markdown
- **O Resumo do dia com "Hoje" usa a MESMA query do header** (`usePeriodSummary(id, "today")` = `useTodaySummary`): o handoff exige que os dois saiam do mesmo cálculo — duas fontes divergem, e o operador deixa de confiar nas duas.
- ⚠️ **O Modo cozinha (`/cozinha`) fica fora da casca e não mostra dinheiro** — nem preço, total, frete, pagamento, telefone ou nome. Ele monta o `useNewOrderAlert` por conta própria (a casca não está lá) e lê dele os pendentes. Os itens de cada pedido vêm do detalhe, buscado **uma vez** sob `["order-items", …]`, fora do prefixo `"orders"`: os itens são congelados na criação, e a chave dentro do prefixo seria refeita a cada ação na bancada.
```

Na seção "O que é", troque `(\`apps/panel\` — acesso, pedidos, cardápio com grupos de opções, e a configuração de modalidades, entrega, horário e dados da loja)` por `(\`apps/panel\` — acesso, pedidos, resumo do dia, modo cozinha, cardápio com grupos de opções, e a configuração de modalidades, entrega, horário e dados da loja)`.

- [ ] **Step 2: A spec**

Em `docs/superpowers/specs/2026-09-21-painel-resumo-cozinha-parte-3a-design.md`:

1. Troque `**Estado:** aprovado, não implementado` por `**Estado:** implementado`.
2. Na tabela das colunas da cozinha, troque `` `pending`, de qualquer data `` por `` `pending` de hoje — a mesma query do aviso de pedido novo e da coluna Novos do kanban ``.
3. Na seção "Pedidos por status", troque o primeiro parágrafo (de "Uma linha por status, **todos**" até "(tudo zerado: barras vazias).") por:

```markdown
As cinco linhas do protótipo, agrupadas como as colunas do kanban: **Novos**
(`pending`), **Em preparo** (`confirmed` + `preparing`), **Prontos / em rota**
(`ready_for_pickup` + `out_for_delivery`), **Concluídos** e **Cancelados**. Rótulo
com ponto, contagem 16 px/700 e barra de 8 px num trilho `surface3`, com a **fatia
do total que chegou** no período (período vazio: barras vazias).
```

4. Na tabela "Onde a implementação diverge do handoff", acrescente:

```markdown
| O diálogo de aceite da cozinha não mostra nome nem total, e o de estoque insuficiente só tem "Fechar" | A cozinha não decide dinheiro; cancelar e repor estoque continuam em Pedidos |
```

- [ ] **Step 3: Verificação completa**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm lint
pnpm build
pnpm --filter @menuclick/panel test
```

Expected: lint limpo, build dos apps, e a suíte do painel passando (290 antes deste plano, mais os desta parte).

- [ ] **Step 4: Conferência manual (o que sobra para o humano)**

Com `pnpm dev` de pé, liste no relatório:

1. **Resumo** — os números de Hoje batem com os do header; trocar para Ontem e voltar; aceitar um pedido em Pedidos e ver o Resumo mudar em até 10 s.
2. **Cozinha** — abrir por "Modo cozinha"; criar um pedido pelo cardápio e ouvir o bipe na cozinha; "Aceitar e começar" e ver o cartão passar para "Fazendo"; "Pronto — despachar" e ver o cartão sair; nenhum valor em reais na tela.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-21-painel-resumo-cozinha-parte-3a-design.md
git commit -m "docs(panel): 📝 documenta o resumo do dia e o modo cozinha"
```
