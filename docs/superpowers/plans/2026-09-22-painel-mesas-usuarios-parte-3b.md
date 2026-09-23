# Painel da loja, parte 3b — Mesas e QR, e Usuários — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar ao painel as duas telas que faltam para administrar o salão e a equipe — `/mesas` (cadastro, QR, rotação do código e impressão de adesivos) e `/usuarios` (lista, convite e remoção, só para o dono).

**Architecture:** duas features novas em `apps/panel/src/features/`, cada uma com o par já consagrado no projeto: um módulo puro sem React (regras e textos), um módulo de hooks (TanStack Query) e a página. As chamadas HTTP ficam em `src/api/tables.ts` (ampliado) e `src/api/users.ts` (novo). O QR sai de `react-qr-code`, a impressão é uma folha escondida na própria página (`@media print`) e `window.print()`.

**Tech Stack:** Vite + React 19 + Mantine 9 + React Router 8 + TanStack Query 5 + Vitest/Testing Library/jsdom. Dependência nova: `react-qr-code`.

**Spec:** `docs/superpowers/specs/2026-09-22-painel-mesas-usuarios-parte-3b-design.md` — leia antes de começar; é a autoridade, este plano é o argumento dela.

## Global Constraints

- **Branch:** `feat/painel-mesas-usuarios`. Nunca commitar na `main`.
- **Todo comando de shell começa com** `unset -f node npm npx pnpm nvm 2>/dev/null;` — o perfil do usuário define funções com esses nomes e elas quebram o `pnpm`.
- **Copy do handoff é literal.** Textos marcados como literais na spec entram caractere por caractere. Texto novo só onde a spec declara desvio.
- **Cor só por `var(--mc-*)`** (tokens de `src/theme/tokens.ts`). Nenhum hex em CSS de feature. Sem `box-shadow`, sem `transition`, sem `animation`.
- **Números tabulares:** todo número que o olho compara em coluna leva a classe global `n`.
- **Toda chamada HTTP passa por `apiRequest`** (`src/api/client.ts`). Nada de `fetch` direto.
- **Uma instância de mutação por controle independente.** No `@tanstack/query-core` 5, `mutate()` desanexa o observer da mutação anterior e os callbacks por chamada (`onSuccess`/`onError` passados ao `mutate`) deixam de disparar. Quando a tela precisa agir depois do sucesso, use `mutateAsync` + `try/catch`, ou escreva o efeito no `onSuccess` do hook.
- **Loading/erro só quando `data === undefined`.** Um refetch que falha mantém o dado antigo; a tela não pode piscar "carregando".
- **Todo `DELETE`/ação destrutiva passa pelo `ConfirmDialog`** de `src/ui/ConfirmDialog.tsx`, com `busy` ligado à mutação.
- **Mensagem de erro de API vem de `describeError(cause)`** — nunca texto inventado por cima de um erro real.
- **Chaves de query:** mesas em `["tables", restaurantId]` (a MESMA do filtro de Pedidos), usuários em `["users", restaurantId]`.
- **A URL do QR vem pronta da API** (`table.qrUrl`). O painel nunca monta URL de QR.
- **Testes:** `pnpm --filter @menuclick/panel test` precisa passar inteiro ao fim de cada task. Não existe `jest-dom`: asserções são `expect(x).toBe(...)`, `textContent`, `querySelector`.
- **Commits** seguem `.claude/rules/commits.md`: `<tipo>(<escopo>): <emoji> <mensagem>` em pt-BR, presente do indicativo, minúscula, sem ponto final.
- **Zero dependência nova além de `react-qr-code`.**

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/api/types.ts` (modificar) | tipo `RestaurantUser` |
| `src/api/tables.ts` (modificar) | criar, renomear, girar o hash e remover mesa |
| `src/api/users.ts` (criar) | listar, convidar e remover usuário |
| `src/features/tables/tables.ts` (criar) | regras puras: seleção, rótulo do botão de impressão, textos das confirmações |
| `src/features/tables/useTablesAdmin.ts` (criar) | `tablesQueryKey` + hooks de mutação das mesas |
| `src/features/tables/TablesPage.tsx` (criar) | a grade, o cartão de cadastro, as três ações |
| `src/features/tables/PrintSheet.tsx` (criar) | a folha de adesivos, visível só no `@media print` |
| `src/features/tables/TablesPage.module.css` (criar) | grade, cartão e as regras de `@media print` |
| `src/features/users/users.ts` (criar) | regras puras: iniciais, "é você", validação do convite, textos |
| `src/features/users/useUsers.ts` (criar) | `usersQueryKey` + hooks |
| `src/features/users/UsersPage.tsx` (criar) | a lista, o rodapé de convite, a remoção |
| `src/features/users/UsersPage.module.css` (criar) | linhas de 58 px, avatar, selo |
| `src/features/orders/useOrders.ts` (modificar) | `useTables` passa a usar `tablesQueryKey` importado |
| `src/router.tsx` (modificar) | rotas `/mesas` e `/usuarios` |
| `src/layout/Rail.tsx` (modificar) | itens novos no grupo Configuração, `/usuarios` só para o dono |
| `CLAUDE.md` (modificar) | três regras novas da seção do painel |

---

### Task 1: Camada de API — mesas e usuários

**Files:**
- Modify: `apps/panel/src/api/types.ts`
- Modify: `apps/panel/src/api/tables.ts`
- Create: `apps/panel/src/api/users.ts`
- Test: `apps/panel/test/tables-users-api.test.ts`

**Interfaces:**
- Consumes: `apiRequest`, `fetchAllPages`, `Page`, `Table`, `UserRole` (já existem).
- Produces:
  - `type RestaurantUser = { id: string; restaurantId: string; name: string; email: string; role: UserRole; createdAt: string; updatedAt: string }`
  - `createTable(restaurantId: string, label: string): Promise<Table>`
  - `renameTable(restaurantId: string, id: string, label: string): Promise<Table>`
  - `rotateTableHash(restaurantId: string, id: string): Promise<Table>`
  - `deleteTable(restaurantId: string, id: string): Promise<void>`
  - `type InviteBody = { name: string; email: string; password: string; role: UserRole }`
  - `listUsers(restaurantId: string): Promise<RestaurantUser[]>`
  - `inviteUser(restaurantId: string, body: InviteBody): Promise<RestaurantUser>`
  - `deleteUser(restaurantId: string, id: string): Promise<void>`

**Contexto da API (não invente caminho):**

| Chamada | Rota |
| --- | --- |
| criar mesa | `POST /restaurants/:restaurantId/tables` · corpo `{ label }` · 201 · 409 rótulo repetido |
| renomear | `PATCH /restaurants/:restaurantId/tables/:id` · corpo `{ label }` · 200 · 409 |
| girar o código | `POST /restaurants/:restaurantId/tables/:id/rotate-hash` · sem corpo · 200 (devolve a mesa com `hash` e `qrUrl` novos) |
| remover mesa | `DELETE /restaurants/:restaurantId/tables/:id` · 204 |
| listar usuários | `GET /restaurants/:restaurantId/users` · **não é paginada**: responde `{ data: [...] }`, sem `limit`/`offset`/`total` |
| convidar | `POST /restaurants/:restaurantId/users` · corpo `{ name, email, password, role? }` · 201 · 409 e-mail já usado |
| remover usuário | `DELETE /restaurants/:restaurantId/users/:id` · 204 · 409 ao remover a si mesmo |

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/tables-users-api.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTable,
  deleteTable,
  renameTable,
  rotateTableHash,
} from "../src/api/tables.ts";
import { deleteUser, inviteUser, listUsers } from "../src/api/users.ts";
import { mockApi } from "./api-mock.ts";
import { RESTAURANT_ID, signIn } from "./fixtures.ts";

const TABLES = `/restaurants/${RESTAURANT_ID}/tables`;
const USERS = `/restaurants/${RESTAURANT_ID}/users`;

const table = {
  id: "mesa-1",
  restaurantId: RESTAURANT_ID,
  label: "Mesa 7",
  hash: "a1b2c3",
  qrUrl: "http://localhost:5173/trattoria-bella?mesa=a1b2c3",
};

describe("api de mesas e usuários", () => {
  beforeEach(() => {
    signIn();
  });

  it("cria mesa mandando só o rótulo", async () => {
    const api = mockApi([{ method: "POST", path: TABLES, status: 201, body: table }]);
    const created = await createTable(RESTAURANT_ID, "Mesa 7");
    expect(created.qrUrl).toBe(table.qrUrl);
    expect(api.calls[0].body).toEqual({ label: "Mesa 7" });
  });

  it("renomeia com PATCH e não manda mais nada junto", async () => {
    const api = mockApi([{ method: "PATCH", path: `${TABLES}/mesa-1`, body: table }]);
    await renameTable(RESTAURANT_ID, "mesa-1", "Mesa 8");
    expect(api.calls[0].method).toBe("PATCH");
    expect(api.calls[0].body).toEqual({ label: "Mesa 8" });
  });

  it("gira o código pela rota própria, sem corpo", async () => {
    const api = mockApi([
      { method: "POST", path: `${TABLES}/mesa-1/rotate-hash`, body: { ...table, hash: "z9" } },
    ]);
    const rotated = await rotateTableHash(RESTAURANT_ID, "mesa-1");
    expect(rotated.hash).toBe("z9");
    expect(api.calls[0].body).toBeUndefined();
  });

  it("remove mesa com DELETE e aceita o 204 sem corpo", async () => {
    const api = mockApi([{ method: "DELETE", path: `${TABLES}/mesa-1`, status: 204 }]);
    await deleteTable(RESTAURANT_ID, "mesa-1");
    expect(api.calls[0].method).toBe("DELETE");
  });

  it("lista usuários: a rota não é paginada, responde só { data }", async () => {
    const users = [
      {
        id: "u-1",
        restaurantId: RESTAURANT_ID,
        name: "Cláudia Mendes",
        email: "gerencia@trattoriabella.com.br",
        role: "owner",
        createdAt: "2026-09-01T12:00:00.000Z",
        updatedAt: "2026-09-01T12:00:00.000Z",
      },
    ];
    mockApi([{ method: "GET", path: USERS, body: { data: users } }]);
    expect(await listUsers(RESTAURANT_ID)).toEqual(users);
  });

  it("convida mandando nome, e-mail, senha e papel", async () => {
    const api = mockApi([{ method: "POST", path: USERS, status: 201, body: { id: "u-2" } }]);
    await inviteUser(RESTAURANT_ID, {
      name: "João",
      email: "joao@trattoriabella.com.br",
      password: "provisoria8",
      role: "staff",
    });
    expect(api.calls[0].body).toEqual({
      name: "João",
      email: "joao@trattoriabella.com.br",
      password: "provisoria8",
      role: "staff",
    });
  });

  it("remove usuário com DELETE", async () => {
    const api = mockApi([{ method: "DELETE", path: `${USERS}/u-2`, status: 204 }]);
    await deleteUser(RESTAURANT_ID, "u-2");
    expect(api.calls[0].method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/tables-users-api.test.ts
```

Esperado: falha na resolução de `../src/api/users.ts` e dos nomes novos em `tables.ts`.

- [ ] **Step 3: Tipo `RestaurantUser`**

Em `apps/panel/src/api/types.ts`, logo depois do tipo `Table`:

```ts
/**
 * Usuário do restaurante. O papel não se edita: a API não tem
 * `PATCH .../users/:id`, então trocar é remover e convidar de novo.
 */
export type RestaurantUser = {
  id: string;
  restaurantId: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 4: Ampliar `src/api/tables.ts`**

Acrescente ao arquivo (mantendo o `listAllTables` que já existe):

```ts
export function createTable(restaurantId: string, label: string): Promise<Table> {
  return apiRequest<Table>(`/restaurants/${restaurantId}/tables`, { method: "POST", body: { label } });
}

/**
 * Só o rótulo. O `PATCH` da API não toca no hash de propósito — é isso que a
 * nota do topo da tela promete: renomear a mesa não mata o adesivo colado
 * nela.
 */
export function renameTable(restaurantId: string, id: string, label: string): Promise<Table> {
  return apiRequest<Table>(`/restaurants/${restaurantId}/tables/${id}`, {
    method: "PATCH",
    body: { label },
  });
}

/**
 * Rota própria porque o efeito é próprio: o adesivo que está na mesa para de
 * funcionar no mesmo instante. Devolve a mesa com `hash` e `qrUrl` novos.
 */
export function rotateTableHash(restaurantId: string, id: string): Promise<Table> {
  return apiRequest<Table>(`/restaurants/${restaurantId}/tables/${id}/rotate-hash`, { method: "POST" });
}

export function deleteTable(restaurantId: string, id: string): Promise<void> {
  return apiRequest<void>(`/restaurants/${restaurantId}/tables/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 5: Criar `src/api/users.ts`**

```ts
import { apiRequest } from "./client.ts";
import type { RestaurantUser, UserRole } from "./types.ts";

/**
 * A listagem de usuários é a ÚNICA do painel que não é paginada: a API
 * responde `{ data }` cru, sem `limit`/`offset`/`total`. Por isso não passa
 * por `fetchAllPages` — não há página seguinte para buscar.
 */
export function listUsers(restaurantId: string): Promise<RestaurantUser[]> {
  return apiRequest<{ data: RestaurantUser[] }>(`/restaurants/${restaurantId}/users`).then(
    (result) => result.data,
  );
}

/**
 * A senha vai no convite porque o projeto não manda e-mail de convite: quem
 * convida entrega a senha provisória à pessoa, que troca depois no menu da
 * conta.
 */
export type InviteBody = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};

export function inviteUser(restaurantId: string, body: InviteBody): Promise<RestaurantUser> {
  return apiRequest<RestaurantUser>(`/restaurants/${restaurantId}/users`, { method: "POST", body });
}

export function deleteUser(restaurantId: string, id: string): Promise<void> {
  return apiRequest<void>(`/restaurants/${restaurantId}/users/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 6: Rodar e ver passar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/tables-users-api.test.ts
```

Esperado: 7 testes passando.

- [ ] **Step 7: Type-check e suíte inteira**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec tsc --noEmit && pnpm --filter @menuclick/panel test
```

- [ ] **Step 8: Commit**

```bash
git add apps/panel/src/api apps/panel/test/tables-users-api.test.ts
git commit -m "feat(panel): ✨ adiciona chamadas de mesas e usuários à camada de api"
```

---

### Task 2: Regras puras das mesas

**Files:**
- Create: `apps/panel/src/features/tables/tables.ts`
- Test: `apps/panel/test/tables.test.ts`

**Interfaces:**
- Consumes: `Table` (`src/api/types.ts`), `ConfirmCopy` (`src/ui/confirmCopy.ts`).
- Produces:
  - `toggleSelection(selected: readonly string[], id: string): string[]`
  - `visibleSelection(selected: readonly string[], tables: readonly Table[]): string[]`
  - `allSelected(selected: readonly string[], tables: readonly Table[]): boolean`
  - `selectAllLabel(everythingSelected: boolean): string`
  - `printButtonLabel(count: number): string`
  - `labelError(label: string): string | null`
  - `rotateConfirm(label: string): ConfirmCopy`
  - `removeConfirm(label: string): ConfirmCopy`

**Textos (literais da spec — copie exatamente):**

- Rotacionar · título: `Gerar um código novo para a "<rótulo>"?`
- Rotacionar · corpo: `O adesivo que está na mesa para de funcionar imediatamente. Quem apontar a câmera para o QR antigo não abre o cardápio.`
- Rotacionar · aviso (`warn`): `Só faça isso se você vai reimprimir e trocar o adesivo agora.`
- Rotacionar · botão: `Gerar código novo`
- Remover · título: `Remover a "<rótulo>"?`
- Remover · corpo: `O adesivo dela para de funcionar. Os pedidos que ela atendeu continuam no histórico, com o rótulo que já tinham.`
- Remover · botão: `Remover mesa`
- Rótulo vazio: `Dê um rótulo à mesa.`

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/tables.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Table } from "../src/api/types.ts";
import {
  allSelected,
  labelError,
  printButtonLabel,
  removeConfirm,
  rotateConfirm,
  selectAllLabel,
  toggleSelection,
  visibleSelection,
} from "../src/features/tables/tables.ts";

function makeTable(id: string, label: string): Table {
  return {
    id,
    restaurantId: "r-1",
    label,
    hash: `hash-${id}`,
    qrUrl: `http://localhost:5173/loja?mesa=hash-${id}`,
  };
}

const tables = [makeTable("t-1", "Mesa 1"), makeTable("t-2", "Mesa 2")];

describe("regras das mesas", () => {
  it("o rótulo do botão de impressão conta o que está selecionado", () => {
    expect(printButtonLabel(0)).toBe("Selecione para imprimir");
    expect(printButtonLabel(1)).toBe("Imprimir 1 adesivo");
    expect(printButtonLabel(4)).toBe("Imprimir 4 adesivos");
  });

  it("'Selecionar todas' vira 'Limpar seleção' quando tudo está marcado", () => {
    expect(selectAllLabel(false)).toBe("Selecionar todas");
    expect(selectAllLabel(true)).toBe("Limpar seleção");
  });

  it("marcar e desmarcar é a mesma ação", () => {
    expect(toggleSelection([], "t-1")).toEqual(["t-1"]);
    expect(toggleSelection(["t-1", "t-2"], "t-1")).toEqual(["t-2"]);
  });

  it("a seleção descarta a mesa que sumiu da lista", () => {
    // outro aparelho removeu a t-2: ela não pode entrar na contagem nem na folha
    expect(visibleSelection(["t-1", "t-2"], [tables[0]])).toEqual(["t-1"]);
  });

  it("tudo selecionado é falso quando não há mesa nenhuma", () => {
    expect(allSelected([], [])).toBe(false);
    expect(allSelected(["t-1"], tables)).toBe(false);
    expect(allSelected(["t-1", "t-2"], tables)).toBe(true);
    // id fantasma não conta como "tudo selecionado"
    expect(allSelected(["t-1", "t-9"], tables)).toBe(false);
  });

  it("rótulo vazio ou só espaço é barrado antes da chamada", () => {
    expect(labelError("")).toBe("Dê um rótulo à mesa.");
    expect(labelError("   ")).toBe("Dê um rótulo à mesa.");
    expect(labelError("Mesa 7")).toBeNull();
  });

  it("a confirmação de código novo diz a consequência e o aviso", () => {
    const copy = rotateConfirm("Mesa 7");
    expect(copy.title).toBe('Gerar um código novo para a "Mesa 7"?');
    expect(copy.body).toBe(
      "O adesivo que está na mesa para de funcionar imediatamente. Quem apontar a câmera para o QR antigo não abre o cardápio.",
    );
    expect(copy.warn).toBe("Só faça isso se você vai reimprimir e trocar o adesivo agora.");
    expect(copy.cta).toBe("Gerar código novo");
    expect(copy.tone).toBe("danger");
  });

  it("a confirmação de remover promete o histórico intacto", () => {
    const copy = removeConfirm("Varanda 1");
    expect(copy.title).toBe('Remover a "Varanda 1"?');
    expect(copy.body).toBe(
      "O adesivo dela para de funcionar. Os pedidos que ela atendeu continuam no histórico, com o rótulo que já tinham.",
    );
    expect(copy.cta).toBe("Remover mesa");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/tables.test.ts
```

Esperado: falha ao resolver `src/features/tables/tables.ts`.

- [ ] **Step 3: Implementar**

Crie `apps/panel/src/features/tables/tables.ts`:

```ts
import type { Table } from "../../api/types.ts";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";

export function toggleSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((each) => each !== id) : [...selected, id];
}

/**
 * A seleção é por id e descarta o que sumiu da lista: com dois aparelhos
 * abertos, a mesa removida no outro não pode entrar na contagem do botão nem
 * na folha de impressão.
 */
export function visibleSelection(selected: readonly string[], tables: readonly Table[]): string[] {
  return selected.filter((id) => tables.some((table) => table.id === id));
}

export function allSelected(selected: readonly string[], tables: readonly Table[]): boolean {
  if (tables.length === 0) return false;
  return visibleSelection(selected, tables).length === tables.length;
}

export function selectAllLabel(everythingSelected: boolean): string {
  return everythingSelected ? "Limpar seleção" : "Selecionar todas";
}

export function printButtonLabel(count: number): string {
  if (count === 0) return "Selecione para imprimir";
  return count === 1 ? "Imprimir 1 adesivo" : `Imprimir ${count} adesivos`;
}

export function labelError(label: string): string | null {
  return label.trim() === "" ? "Dê um rótulo à mesa." : null;
}

export function rotateConfirm(label: string): ConfirmCopy {
  return {
    title: `Gerar um código novo para a "${label}"?`,
    body: "O adesivo que está na mesa para de funcionar imediatamente. Quem apontar a câmera para o QR antigo não abre o cardápio.",
    warn: "Só faça isso se você vai reimprimir e trocar o adesivo agora.",
    cta: "Gerar código novo",
    tone: "danger",
  };
}

export function removeConfirm(label: string): ConfirmCopy {
  return {
    title: `Remover a "${label}"?`,
    body: "O adesivo dela para de funcionar. Os pedidos que ela atendeu continuam no histórico, com o rótulo que já tinham.",
    cta: "Remover mesa",
    tone: "danger",
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/tables.test.ts
```

Esperado: 8 testes passando.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/features/tables/tables.ts apps/panel/test/tables.test.ts
git commit -m "feat(panel): ✨ adiciona as regras puras da tela de mesas"
```

---

### Task 3: A tela de Mesas — grade, QR e as três ações

**Files:**
- Create: `apps/panel/src/features/tables/useTablesAdmin.ts`
- Create: `apps/panel/src/features/tables/TablesPage.tsx`
- Create: `apps/panel/src/features/tables/TablesPage.module.css`
- Modify: `apps/panel/src/features/orders/useOrders.ts` (o `useTables` passa a usar a chave importada)
- Modify: `apps/panel/src/router.tsx`
- Modify: `apps/panel/src/layout/Rail.tsx`
- Modify: `apps/panel/package.json` (dependência `react-qr-code`)
- Test: `apps/panel/test/tables-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`createTable`, `renameTable`, `rotateTableHash`, `deleteTable`, `listAllTables`), Task 2 (`labelError`, `rotateConfirm`, `removeConfirm`).
- Produces:
  - `tablesQueryKey(restaurantId: string): readonly ["tables", string]`
  - `useTablesList(restaurantId: string)` — `useQuery` das mesas
  - `useCreateTable(restaurantId)`, `useRenameTable(restaurantId, tableId)`, `useRotateTableHash(restaurantId, tableId)`, `useRemoveTable(restaurantId, tableId)`
  - `TablesPage` (componente)

**Nota literal do topo da tela:** `Renomear a mesa não invalida o adesivo: o QR continua funcionando. O que invalida é gerar um código novo.`

- [ ] **Step 1: Instalar `react-qr-code`**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel add react-qr-code
```

Confira depois: `git diff pnpm-workspace.yaml` precisa sair **vazio** — a biblioteca não tem script de instalação, então não entra no `allowBuilds`. Se o pnpm pedir decisão de build, PARE e reporte: a spec escolheu essa biblioteca justamente por não exigir isso.

- [ ] **Step 2: Escrever o teste que falha**

Crie `apps/panel/test/tables-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TablesPage } from "../src/features/tables/TablesPage.tsx";
import { mockApi } from "./api-mock.ts";
import { panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const TABLES = `/restaurants/${RESTAURANT_ID}/tables`;
const routes = [{ path: "/mesas", element: <TablesPage /> }];

function makeTable(id: string, label: string) {
  return {
    id,
    restaurantId: RESTAURANT_ID,
    label,
    hash: `hash-${id}`,
    qrUrl: `http://localhost:5173/trattoria-bella?mesa=hash-${id}`,
  };
}

function withTables(tables: ReturnType<typeof makeTable>[]) {
  return mockApi([
    { method: "GET", path: TABLES, body: { data: tables, limit: 100, offset: 0, total: tables.length } },
    ...panelHandlers(),
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tela de mesas", () => {
  it("mostra o QR e a URL de cada mesa", async () => {
    signIn();
    withTables([makeTable("t-1", "Mesa 1"), makeTable("t-2", "Mesa 2")]);
    const { container } = renderInPanel(routes, "/mesas");
    await screen.findByText("Mesa 1");
    expect(screen.getByText("http://localhost:5173/trattoria-bella?mesa=hash-t-1")).not.toBeNull();
    // um <svg> por mesa na grade, mais um por mesa na folha de impressão
    expect(container.querySelectorAll("svg").length >= 2).toBe(true);
  });

  it("cadastra mandando o rótulo, e a mesa nova aparece", async () => {
    signIn();
    const api = withTables([]);
    renderInPanel(routes, "/mesas");
    fireEvent.change(await screen.findByLabelText("Rótulo da nova mesa"), {
      target: { value: "Varanda 1" },
    });
    api.add({ method: "POST", path: TABLES, status: 201, body: makeTable("t-9", "Varanda 1") });
    api.add({
      method: "GET",
      path: TABLES,
      body: { data: [makeTable("t-9", "Varanda 1")], limit: 100, offset: 0, total: 1 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar mesa" }));
    await screen.findByText("Varanda 1");
    const post = api.calls.find((call) => call.method === "POST");
    expect(post?.body).toEqual({ label: "Varanda 1" });
  });

  it("rótulo repetido mostra o 409 da API no cartão de cadastro", async () => {
    signIn();
    const api = withTables([]);
    renderInPanel(routes, "/mesas");
    fireEvent.change(await screen.findByLabelText("Rótulo da nova mesa"), { target: { value: "mesa 1" } });
    api.add({
      method: "POST",
      path: TABLES,
      status: 409,
      body: { statusCode: 409, error: "Conflict", message: "Já existe uma mesa com esse rótulo." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar mesa" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Já existe uma mesa com esse rótulo.");
  });

  it("renomear manda só o rótulo e não chama a rota do código novo", async () => {
    signIn();
    const api = withTables([makeTable("t-1", "Mesa 1")]);
    renderInPanel(routes, "/mesas");
    fireEvent.click(await screen.findByRole("button", { name: "Renomear Mesa 1" }));
    fireEvent.change(screen.getByLabelText("Novo rótulo da mesa"), { target: { value: "Mesa 10" } });
    api.add({ method: "PATCH", path: `${TABLES}/t-1`, body: makeTable("t-1", "Mesa 10") });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ label: "Mesa 10" });
    expect(api.calls.some((call) => call.path.endsWith("/rotate-hash"))).toBe(false);
  });

  it("'Novo código' confirma com o texto literal antes de chamar", async () => {
    signIn();
    const api = withTables([makeTable("t-1", "Mesa 1")]);
    renderInPanel(routes, "/mesas");
    fireEvent.click(await screen.findByRole("button", { name: "Novo código Mesa 1" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(
      "O adesivo que está na mesa para de funcionar imediatamente.",
    );
    expect(dialog.textContent).toContain("Só faça isso se você vai reimprimir e trocar o adesivo agora.");
    expect(api.calls.some((call) => call.path.endsWith("/rotate-hash"))).toBe(false);
    api.add({ method: "POST", path: `${TABLES}/t-1/rotate-hash`, body: makeTable("t-1", "Mesa 1") });
    fireEvent.click(screen.getByRole("button", { name: "Gerar código novo" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.path.endsWith("/rotate-hash"))).toBe(true),
    );
  });

  it("remover confirma e chama o DELETE", async () => {
    signIn();
    const api = withTables([makeTable("t-1", "Mesa 1")]);
    renderInPanel(routes, "/mesas");
    fireEvent.click(await screen.findByRole("button", { name: "Remover Mesa 1" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("continuam no histórico");
    api.add({ method: "DELETE", path: `${TABLES}/t-1`, status: 204 });
    api.add({ method: "GET", path: TABLES, body: { data: [], limit: 100, offset: 0, total: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "Remover mesa" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/tables-page.test.tsx
```

Esperado: falha ao resolver `TablesPage.tsx`.

- [ ] **Step 4: Os hooks**

Crie `apps/panel/src/features/tables/useTablesAdmin.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTable,
  deleteTable,
  listAllTables,
  renameTable,
  rotateTableHash,
} from "../../api/tables.ts";

/**
 * A MESMA chave do filtro por mesa do kanban de Pedidos (`useTables`, em
 * `features/orders/useOrders.ts`): criar, renomear, girar o código ou remover
 * aqui invalida lá também, e o filtro enxerga a mudança na hora.
 */
export function tablesQueryKey(restaurantId: string) {
  return ["tables", restaurantId] as const;
}

export function useTablesList(restaurantId: string) {
  return useQuery({
    queryKey: tablesQueryKey(restaurantId),
    queryFn: () => listAllTables(restaurantId),
  });
}

function useInvalidateTables(restaurantId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: tablesQueryKey(restaurantId) });
}

export function useCreateTable(restaurantId: string) {
  const invalidate = useInvalidateTables(restaurantId);
  return useMutation({
    mutationFn: (label: string) => createTable(restaurantId, label),
    onSuccess: invalidate,
  });
}

/**
 * Uma instância por mesa (o hook é chamado dentro do cartão): com uma
 * instância dividida, `mutate()` de um cartão desanexaria o observer do
 * anterior e a falha de um `PATCH` sobreposto sumiria sem mensagem.
 */
export function useRenameTable(restaurantId: string, tableId: string) {
  const invalidate = useInvalidateTables(restaurantId);
  return useMutation({
    mutationFn: (label: string) => renameTable(restaurantId, tableId, label),
    onSuccess: invalidate,
  });
}

export function useRotateTableHash(restaurantId: string, tableId: string) {
  const invalidate = useInvalidateTables(restaurantId);
  return useMutation({
    mutationFn: () => rotateTableHash(restaurantId, tableId),
    onSuccess: invalidate,
  });
}

export function useRemoveTable(restaurantId: string, tableId: string) {
  const invalidate = useInvalidateTables(restaurantId);
  return useMutation({
    mutationFn: () => deleteTable(restaurantId, tableId),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 5: A chave passa a ser importada em Pedidos**

Em `apps/panel/src/features/orders/useOrders.ts`, troque o literal da chave pelo helper (fonte única):

```ts
import { tablesQueryKey } from "../tables/useTablesAdmin.ts";
```

e dentro do `useTables`:

```ts
export function useTables(restaurantId: string) {
  return useQuery({
    queryKey: tablesQueryKey(restaurantId),
    queryFn: () => listAllTables(restaurantId),
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 6: O CSS**

Crie `apps/panel/src/features/tables/TablesPage.module.css`:

```css
.page {
  display: grid;
  gap: 14px;
  padding: 18px 20px;
}

.note {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-ink2);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 12px;
}

.card {
  display: grid;
  gap: 10px;
  padding: 12px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.cardSelected {
  border-color: var(--mc-accent-line);
}

.pick {
  display: flex;
  align-items: center;
  gap: 8px;
}

.label {
  font-size: 15px;
  font-weight: 700;
}

.qr {
  display: grid;
  place-items: center;
  padding: 10px;
  background: var(--mc-surface2);
  border-radius: 8px;
}

.url {
  overflow-wrap: anywhere;
  font-size: 11.5px;
  color: var(--mc-ink3);
}

.actions {
  display: flex;
  gap: 4px;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--mc-line);
}

.newCard {
  display: grid;
  align-content: center;
  gap: 8px;
  padding: 12px;
  border: 1px dashed var(--mc-line-hi);
  border-radius: 10px;
}

.renameForm {
  display: grid;
  gap: 8px;
}

.renameActions {
  display: flex;
  gap: 8px;
}

.error {
  margin: 0;
  font-size: 12.5px;
  color: var(--mc-danger);
}
```

- [ ] **Step 7: A página**

Crie `apps/panel/src/features/tables/TablesPage.tsx`:

```tsx
import { Button, Checkbox, TextInput } from "@mantine/core";
import { type FormEvent, useState } from "react";
import QRCode from "react-qr-code";
import { describeError } from "../../api/client.ts";
import type { Table } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Notice } from "../../ui/Notice.tsx";
import { labelError, removeConfirm, rotateConfirm } from "./tables.ts";
import classes from "./TablesPage.module.css";
import {
  useCreateTable,
  useRemoveTable,
  useRenameTable,
  useRotateTableHash,
  useTablesList,
} from "./useTablesAdmin.ts";

/**
 * O cartão é um componente próprio porque cada mesa precisa das SUAS
 * instâncias de mutação: no query-core 5, `mutate()` desanexa o observer da
 * mutação anterior, e cartões dividindo uma instância perderiam a mensagem de
 * erro de um `PATCH` sobreposto a outro.
 */
function TableCard({
  restaurantId,
  table,
  selected,
  onToggle,
}: {
  restaurantId: string;
  table: Table;
  selected: boolean;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"rotate" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rename = useRenameTable(restaurantId, table.id);
  const rotate = useRotateTableHash(restaurantId, table.id);
  const remove = useRemoveTable(restaurantId, table.id);

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (editing === null) return;
    const problem = labelError(editing);
    setError(problem);
    if (problem !== null) return;
    rename.mutate(editing.trim(), {
      onSuccess: () => setEditing(null),
      onError: (cause) => setError(describeError(cause)),
    });
  };

  return (
    <div className={selected ? `${classes.card} ${classes.cardSelected}` : classes.card}>
      <label className={classes.pick}>
        <Checkbox size={18} checked={selected} onChange={onToggle} aria-label={`Selecionar ${table.label}`} />
        <span className={classes.label}>{table.label}</span>
      </label>
      <div className={classes.qr}>
        <QRCode value={table.qrUrl} size={104} level="Q" />
      </div>
      <span className={classes.url}>{table.qrUrl}</span>
      {editing === null ? (
        <div className={classes.actions}>
          <Button variant="subtle" aria-label={`Renomear ${table.label}`} onClick={() => setEditing(table.label)}>
            Renomear
          </Button>
          <Button variant="subtle" aria-label={`Novo código ${table.label}`} onClick={() => setConfirming("rotate")}>
            Novo código
          </Button>
          <Button
            variant="subtle"
            className={buttons.dangerText}
            aria-label={`Remover ${table.label}`}
            onClick={() => setConfirming("remove")}
          >
            Remover
          </Button>
        </div>
      ) : (
        <form className={classes.renameForm} onSubmit={submitRename}>
          <TextInput
            aria-label="Novo rótulo da mesa"
            value={editing}
            onChange={(event) => setEditing(event.currentTarget.value)}
          />
          <div className={classes.renameActions}>
            <Button type="submit" loading={rename.isPending}>
              Salvar
            </Button>
            <Button
              variant="default"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className={classes.error}>
          {error}
        </p>
      )}
      <ConfirmDialog
        copy={
          confirming === "rotate"
            ? rotateConfirm(table.label)
            : confirming === "remove"
              ? removeConfirm(table.label)
              : null
        }
        busy={rotate.isPending || remove.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          const action = confirming === "rotate" ? rotate : remove;
          action.mutate(undefined, {
            onSuccess: () => setConfirming(null),
            onError: (cause) => {
              setConfirming(null);
              setError(describeError(cause));
            },
          });
        }}
      />
    </div>
  );
}

export function TablesPage() {
  const { restaurantId } = useSessionUser();
  const tables = useTablesList(restaurantId);
  const list = tables.data ?? [];

  const [selected, setSelected] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const create = useCreateTable(restaurantId);

  const submitNew = (event: FormEvent) => {
    event.preventDefault();
    const problem = labelError(newLabel);
    setNewError(problem);
    if (problem !== null) return;
    create.mutate(newLabel.trim(), {
      onSuccess: () => setNewLabel(""),
      onError: (cause) => setNewError(describeError(cause)),
    });
  };

  return (
    <div className={classes.page}>
      <p className={classes.note}>
        Renomear a mesa não invalida o adesivo: o QR continua funcionando. O que invalida é gerar um código
        novo.
      </p>
      {tables.isError && tables.data === undefined && (
        <Notice tone="danger" title="Não foi possível carregar as mesas">
          {describeError(tables.error)}
        </Notice>
      )}
      <div className={classes.grid}>
        {list.map((table) => (
          <TableCard
            key={table.id}
            restaurantId={restaurantId}
            table={table}
            selected={selected.includes(table.id)}
            onToggle={() =>
              setSelected((current) =>
                current.includes(table.id)
                  ? current.filter((id) => id !== table.id)
                  : [...current, table.id],
              )
            }
          />
        ))}
        <form className={classes.newCard} onSubmit={submitNew}>
          <TextInput
            aria-label="Rótulo da nova mesa"
            placeholder="Mesa 7"
            value={newLabel}
            onChange={(event) => setNewLabel(event.currentTarget.value)}
          />
          <Button type="submit" loading={create.isPending}>
            Cadastrar mesa
          </Button>
          {newError && (
            <p role="alert" className={classes.error}>
              {newError}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
```

⚠️ A barra de seleção e a folha de impressão entram na Task 4 — o `selected` já existe aqui porque a caixa de seleção do cartão é do desenho desta task. O `toggleSelection`/`visibleSelection` da Task 2 passam a ser usados na Task 4, que substitui o `setSelected` inline acima.

- [ ] **Step 8: Rota e rail**

Em `apps/panel/src/router.tsx`, importe a página e acrescente a rota depois de `/horario`:

```tsx
import { TablesPage } from "./features/tables/TablesPage.tsx";
```

```tsx
              { path: "/mesas", handle: { title: "Mesas e QR" }, element: <TablesPage /> },
```

Em `apps/panel/src/layout/Rail.tsx`, acrescente o item ao grupo Configuração, depois de Horário:

```tsx
      { to: "/horario", label: "Horário" },
      { to: "/mesas", label: "Mesas e QR" },
      { to: "/dados-da-loja", label: "Dados da loja" },
```

- [ ] **Step 9: Rodar e ver passar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/tables-page.test.tsx
```

Esperado: 6 testes passando.

- [ ] **Step 10: Type-check e suíte inteira**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec tsc --noEmit && pnpm --filter @menuclick/panel test
```

- [ ] **Step 11: Commit**

```bash
git add apps/panel/package.json apps/panel/src apps/panel/test/tables-page.test.tsx pnpm-lock.yaml
git commit -m "feat(panel): ✨ adiciona a tela de mesas com qr code"
```

---

### Task 4: Seleção, barra de ações e folha de impressão

**Files:**
- Create: `apps/panel/src/features/tables/PrintSheet.tsx`
- Modify: `apps/panel/src/features/tables/TablesPage.tsx`
- Modify: `apps/panel/src/features/tables/TablesPage.module.css`
- Test: `apps/panel/test/tables-print.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`toggleSelection`, `visibleSelection`, `allSelected`, `selectAllLabel`, `printButtonLabel`), Task 3 (`TablesPage`, `useTablesList`).
- Produces: `PrintSheet({ storeName, tables }: { storeName: string; tables: Table[] })`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/tables-print.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TablesPage } from "../src/features/tables/TablesPage.tsx";
import { mockApi } from "./api-mock.ts";
import { panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const TABLES = `/restaurants/${RESTAURANT_ID}/tables`;
const routes = [{ path: "/mesas", element: <TablesPage /> }];

function makeTable(id: string, label: string) {
  return {
    id,
    restaurantId: RESTAURANT_ID,
    label,
    hash: `hash-${id}`,
    qrUrl: `http://localhost:5173/trattoria-bella?mesa=hash-${id}`,
  };
}

function withTables(tables: ReturnType<typeof makeTable>[]) {
  return mockApi([
    { method: "GET", path: TABLES, body: { data: tables, limit: 100, offset: 0, total: tables.length } },
    ...panelHandlers(),
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("impressão dos adesivos", () => {
  it("sem seleção o botão está desabilitado e diz o que fazer", async () => {
    signIn();
    withTables([makeTable("t-1", "Mesa 1")]);
    renderInPanel(routes, "/mesas");
    const button = await screen.findByRole("button", { name: "Selecione para imprimir" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("com duas mesas selecionadas o texto conta, e o clique manda imprimir", async () => {
    signIn();
    withTables([makeTable("t-1", "Mesa 1"), makeTable("t-2", "Mesa 2")]);
    const print = vi.fn();
    vi.stubGlobal("print", print);
    renderInPanel(routes, "/mesas");
    fireEvent.click(await screen.findByLabelText("Selecionar Mesa 1"));
    fireEvent.click(screen.getByLabelText("Selecionar Mesa 2"));
    const button = screen.getByRole("button", { name: "Imprimir 2 adesivos" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("'Selecionar todas' marca tudo e vira 'Limpar seleção'", async () => {
    signIn();
    withTables([makeTable("t-1", "Mesa 1"), makeTable("t-2", "Mesa 2")]);
    renderInPanel(routes, "/mesas");
    fireEvent.click(await screen.findByRole("button", { name: "Selecionar todas" }));
    expect(screen.getByRole("button", { name: "Imprimir 2 adesivos" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(screen.getByRole("button", { name: "Selecione para imprimir" })).not.toBeNull();
  });

  it("a folha tem um adesivo por mesa selecionada, com o nome da loja", async () => {
    signIn();
    withTables([makeTable("t-1", "Mesa 1"), makeTable("t-2", "Mesa 2")]);
    renderInPanel(routes, "/mesas");
    fireEvent.click(await screen.findByLabelText("Selecionar Mesa 2"));
    const sheet = screen.getByTestId("folha-de-impressao");
    expect(sheet.querySelectorAll("[data-testid='adesivo']").length).toBe(1);
    expect(sheet.textContent).toContain("Mesa 2");
    expect(sheet.textContent).toContain("Trattoria Bella");
    expect(sheet.textContent).not.toContain("Mesa 1");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/tables-print.test.tsx
```

Esperado: falha por não achar a barra nem a folha.

- [ ] **Step 3: A folha de impressão**

Crie `apps/panel/src/features/tables/PrintSheet.tsx`:

```tsx
import QRCode from "react-qr-code";
import type { Table } from "../../api/types.ts";
import classes from "./TablesPage.module.css";

/**
 * A folha vive na PRÓPRIA página e só aparece no `@media print`: o botão
 * chama `window.print()`, então a prévia do navegador é exatamente o que vai
 * para o papel — e salvar em PDF é o próprio diálogo do navegador, sem
 * biblioteca nenhuma.
 */
export function PrintSheet({ storeName, tables }: { storeName: string; tables: Table[] }) {
  return (
    <div className={classes.sheet} data-testid="folha-de-impressao">
      {tables.map((table) => (
        <div key={table.id} className={classes.sticker} data-testid="adesivo">
          <span className={classes.stickerStore}>{storeName}</span>
          <QRCode value={table.qrUrl} size={180} level="Q" />
          <strong className={classes.stickerLabel}>{table.label}</strong>
          <span className={classes.stickerUrl}>{table.qrUrl}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: O CSS da barra e da impressão**

Acrescente ao fim de `apps/panel/src/features/tables/TablesPage.module.css`:

```css
.bar {
  display: flex;
  gap: 8px;
  align-items: center;
}

/*
 * Na tela a folha não existe; no papel, ela é a única coisa que existe. Sem o
 * `display: none` daqui, os adesivos apareceriam duplicados abaixo da grade.
 */
.sheet {
  display: none;
}

@media print {
  .page > *:not(.sheet) {
    display: none;
  }

  .sheet {
    display: block;
  }

  .sticker {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 16px;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .stickerStore {
    font-size: 13px;
    color: var(--mc-ink2);
  }

  .stickerLabel {
    font-size: 26px;
  }

  .stickerUrl {
    overflow-wrap: anywhere;
    font-size: 10.5px;
    color: var(--mc-ink3);
  }
}
```

⚠️ O `@media print` esconde os irmãos da folha **dentro de `.page`**; o shell do painel (rail e cabeçalho) fica fora deste módulo. Se ao testar no navegador o rail sair no papel, acrescente a regra no CSS do shell numa task de acerto, nunca com `!important` aqui.

- [ ] **Step 5: Ligar a barra na página**

Em `apps/panel/src/features/tables/TablesPage.tsx`:

1. Importe as regras puras, a folha e o restaurante:

```tsx
import { useRestaurant } from "../restaurant/useRestaurant.ts";
import { PrintSheet } from "./PrintSheet.tsx";
import {
  allSelected,
  labelError,
  printButtonLabel,
  removeConfirm,
  rotateConfirm,
  selectAllLabel,
  toggleSelection,
  visibleSelection,
} from "./tables.ts";
```

O hook é o `useRestaurant(restaurantId)` de `src/features/restaurant/useRestaurant.ts` — o mesmo que Modalidades e Dados da loja já usam, com a chave `restaurantQueryKey`. O nome da loja sai de `restaurant.data?.name`, e na falta dele a folha usa string vazia.

2. Dentro de `TablesPage`, depois de `const list = tables.data ?? []`:

```tsx
  const restaurant = useRestaurant(restaurantId);
  const visible = visibleSelection(selected, list);
  const everything = allSelected(selected, list);
  const chosen = list.filter((table) => visible.includes(table.id));
```

3. Troque o `onToggle` inline do cartão por:

```tsx
            onToggle={() => setSelected((current) => toggleSelection(current, table.id))}
```

4. Acrescente a barra logo **acima** da grade:

```tsx
      <div className={classes.bar}>
        <Button
          variant="default"
          disabled={list.length === 0}
          onClick={() => setSelected(everything ? [] : list.map((table) => table.id))}
        >
          {selectAllLabel(everything)}
        </Button>
        <Button disabled={visible.length === 0} onClick={() => window.print()}>
          {printButtonLabel(visible.length)}
        </Button>
      </div>
```

5. Acrescente a folha como último filho de `.page`:

```tsx
      <PrintSheet storeName={restaurant.data?.name ?? ""} tables={chosen} />
```

- [ ] **Step 6: Rodar e ver passar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/tables-print.test.tsx test/tables-page.test.tsx
```

Esperado: 10 testes passando. Se o teste "mostra o QR e a URL" quebrar por contar `<svg>`, a asserção é `>= 2` de propósito — a folha soma os dela.

- [ ] **Step 7: Suíte inteira e type-check**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec tsc --noEmit && pnpm --filter @menuclick/panel test
```

- [ ] **Step 8: Commit**

```bash
git add apps/panel/src/features/tables apps/panel/test/tables-print.test.tsx
git commit -m "feat(panel): ✨ imprime adesivos das mesas selecionadas"
```

---

### Task 5: Regras puras dos usuários

**Files:**
- Create: `apps/panel/src/features/users/users.ts`
- Test: `apps/panel/test/users.test.ts`

**Interfaces:**
- Consumes: `RestaurantUser`, `UserRole` (Task 1), `ConfirmCopy`.
- Produces:
  - `PASSWORD_MIN_LENGTH = 8`
  - `initials(name: string): string`
  - `isSelf(user: RestaurantUser, sessionUserId: string): boolean`
  - `roleLabel(role: UserRole): string`
  - `type InviteForm = { name: string; email: string; password: string; role: UserRole }`
  - `type InviteErrors = Partial<Record<"name" | "email" | "password", string>>`
  - `validateInvite(form: InviteForm): InviteErrors`
  - `removeUserConfirm(name: string): ConfirmCopy`

**Textos:**

- Nome vazio: `Diga o nome da pessoa.`
- E-mail vazio ou sem `@`: `Digite um e-mail válido.`
- Senha curta: `A senha provisória precisa de pelo menos 8 caracteres.`
- Remover · título: `Remover o acesso de <nome>?`
- Remover · corpo: `A conta perde o acesso na hora, e a sessão aberta dela morre na próxima ação. Os pedidos que ela atendeu continuam no histórico.`
- Remover · botão: `Remover acesso`

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/users.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RestaurantUser } from "../src/api/types.ts";
import {
  initials,
  isSelf,
  removeUserConfirm,
  roleLabel,
  validateInvite,
} from "../src/features/users/users.ts";

function makeUser(overrides: Partial<RestaurantUser> = {}): RestaurantUser {
  return {
    id: "u-1",
    restaurantId: "r-1",
    name: "Cláudia Mendes",
    email: "gerencia@trattoriabella.com.br",
    role: "owner",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("regras dos usuários", () => {
  it("as iniciais saem do primeiro e do último nome", () => {
    expect(initials("Cláudia Mendes")).toBe("CM");
    expect(initials("João")).toBe("J");
    expect(initials("  Ana   Paula   Souza  ")).toBe("AS");
    expect(initials("")).toBe("?");
  });

  it("'é você' é decidido pelo id da sessão, nunca pelo e-mail", () => {
    const me = makeUser({ id: "u-1" });
    const outro = makeUser({ id: "u-2", email: "gerencia@trattoriabella.com.br" });
    expect(isSelf(me, "u-1")).toBe(true);
    expect(isSelf(outro, "u-1")).toBe(false);
  });

  it("o selo do papel é texto fixo em pt-BR", () => {
    expect(roleLabel("owner")).toBe("Dono");
    expect(roleLabel("staff")).toBe("Equipe");
  });

  it("o convite é validado campo a campo, com a senha de 8", () => {
    expect(validateInvite({ name: "", email: "", password: "", role: "staff" })).toEqual({
      name: "Diga o nome da pessoa.",
      email: "Digite um e-mail válido.",
      password: "A senha provisória precisa de pelo menos 8 caracteres.",
    });
    expect(
      validateInvite({ name: "João", email: "joao-arroba-nada", password: "1234567", role: "staff" }),
    ).toEqual({
      email: "Digite um e-mail válido.",
      password: "A senha provisória precisa de pelo menos 8 caracteres.",
    });
    expect(
      validateInvite({ name: "João", email: "joao@loja.com.br", password: "12345678", role: "staff" }),
    ).toEqual({});
  });

  it("a confirmação de remover diz que a sessão morre e o histórico fica", () => {
    const copy = removeUserConfirm("João");
    expect(copy.title).toBe("Remover o acesso de João?");
    expect(copy.body).toBe(
      "A conta perde o acesso na hora, e a sessão aberta dela morre na próxima ação. Os pedidos que ela atendeu continuam no histórico.",
    );
    expect(copy.cta).toBe("Remover acesso");
    expect(copy.tone).toBe("danger");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/users.test.ts
```

- [ ] **Step 3: Implementar**

Crie `apps/panel/src/features/users/users.ts`:

```ts
import type { RestaurantUser, UserRole } from "../../api/types.ts";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";

/** O mesmo piso da API (`PASSWORD_MIN_LENGTH`): conferido antes da chamada. */
export const PASSWORD_MIN_LENGTH = 8;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part !== "");
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length === 1 ? "" : parts[parts.length - 1][0];
  return (first + last).toUpperCase();
}

/**
 * Pelo ID da sessão, nunca pelo e-mail: e-mail é dado editável em outro
 * lugar, e comparar por ele deixaria a própria conta com botão de remover no
 * dia em que dois cadastros dividissem um endereço.
 */
export function isSelf(user: RestaurantUser, sessionUserId: string): boolean {
  return user.id === sessionUserId;
}

export function roleLabel(role: UserRole): string {
  return role === "owner" ? "Dono" : "Equipe";
}

export type InviteForm = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};

export type InviteErrors = Partial<Record<"name" | "email" | "password", string>>;

export function validateInvite(form: InviteForm): InviteErrors {
  const errors: InviteErrors = {};
  if (form.name.trim() === "") errors.name = "Diga o nome da pessoa.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Digite um e-mail válido.";
  if (form.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = "A senha provisória precisa de pelo menos 8 caracteres.";
  }
  return errors;
}

export function removeUserConfirm(name: string): ConfirmCopy {
  return {
    title: `Remover o acesso de ${name}?`,
    body: "A conta perde o acesso na hora, e a sessão aberta dela morre na próxima ação. Os pedidos que ela atendeu continuam no histórico.",
    cta: "Remover acesso",
    tone: "danger",
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/users.test.ts
```

Esperado: 5 testes passando.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/features/users/users.ts apps/panel/test/users.test.ts
git commit -m "feat(panel): ✨ adiciona as regras puras da tela de usuários"
```

---

### Task 6: A tela de Usuários — lista, convite e remoção

**Files:**
- Create: `apps/panel/src/features/users/useUsers.ts`
- Create: `apps/panel/src/features/users/UsersPage.tsx`
- Create: `apps/panel/src/features/users/UsersPage.module.css`
- Modify: `apps/panel/src/router.tsx`
- Modify: `apps/panel/src/layout/Rail.tsx`
- Test: `apps/panel/test/users-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`listUsers`, `inviteUser`, `deleteUser`, `InviteBody`, `RestaurantUser`), Task 5 (`initials`, `isSelf`, `roleLabel`, `validateInvite`, `removeUserConfirm`).
- Produces: `usersQueryKey(restaurantId)`, `useUsersList`, `useInviteUser`, `useRemoveUser`, `UsersPage`.

**Textos literais:**

- Nota do topo: `Dono e equipe operam o painel do mesmo jeito. A diferença é só esta tela e a remoção do restaurante.`
- Nota do papel: `O papel é escolhido no convite. Para trocar, remova a pessoa e convide de novo.`
- Ajuda da senha: `Você entrega esta senha à pessoa. Ela troca depois, no menu da conta.`
- Nota final: `Sem papel informado, o usuário nasce como equipe. Ninguém remove a própria conta.`
- Tela para quem é equipe: `Só o dono administra os usuários da loja.`

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/panel/test/users-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsersPage } from "../src/features/users/UsersPage.tsx";
import { mockApi } from "./api-mock.ts";
import { makeMe, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const USERS = `/restaurants/${RESTAURANT_ID}/users`;
const routes = [{ path: "/usuarios", element: <UsersPage /> }];

const dona = {
  id: makeMe().id,
  restaurantId: RESTAURANT_ID,
  name: "Cláudia Mendes",
  email: "gerencia@trattoriabella.com.br",
  role: "owner" as const,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

const joao = { ...dona, id: "u-2", name: "João Alves", email: "joao@trattoriabella.com.br", role: "staff" as const };

function withUsers(users: typeof dona[], me: Parameters<typeof panelHandlers>[0] = {}) {
  return mockApi([{ method: "GET", path: USERS, body: { data: users } }, ...panelHandlers(me)]);
}

describe("tela de usuários", () => {
  it("mostra papel e e-mail, e a própria conta diz 'você' em vez de 'Remover'", async () => {
    signIn();
    withUsers([dona, joao]);
    renderInPanel(routes, "/usuarios");
    await screen.findByText("João Alves");
    expect(screen.getByText("joao@trattoriabella.com.br")).not.toBeNull();
    expect(screen.getByText("Equipe")).not.toBeNull();
    expect(screen.getByText("Dono")).not.toBeNull();
    expect(screen.getByText("você")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Remover Cláudia Mendes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remover João Alves" })).not.toBeNull();
  });

  it("convida mandando nome, e-mail, senha e papel, com Equipe como padrão", async () => {
    signIn();
    const api = withUsers([dona]);
    renderInPanel(routes, "/usuarios");
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "João Alves" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "joao@trattoriabella.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha provisória"), { target: { value: "provisoria8" } });
    api.add({ method: "POST", path: USERS, status: 201, body: joao });
    api.add({ method: "GET", path: USERS, body: { data: [dona, joao] } });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "POST")).toBe(true));
    expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "João Alves",
      email: "joao@trattoriabella.com.br",
      password: "provisoria8",
      role: "staff",
    });
  });

  it("senha curta é barrada antes da chamada", async () => {
    signIn();
    const api = withUsers([dona]);
    renderInPanel(routes, "/usuarios");
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "João" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "joao@loja.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha provisória"), { target: { value: "1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));
    await screen.findByText("A senha provisória precisa de pelo menos 8 caracteres.");
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("e-mail repetido mostra o 409 da API", async () => {
    signIn();
    const api = withUsers([dona]);
    renderInPanel(routes, "/usuarios");
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "João" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "joao@loja.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha provisória"), { target: { value: "provisoria8" } });
    api.add({
      method: "POST",
      path: USERS,
      status: 409,
      body: { statusCode: 409, error: "Conflict", message: "E-mail já cadastrado." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("E-mail já cadastrado.");
  });

  it("remover confirma e chama o DELETE", async () => {
    signIn();
    const api = withUsers([dona, joao]);
    renderInPanel(routes, "/usuarios");
    fireEvent.click(await screen.findByRole("button", { name: "Remover João Alves" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("a sessão aberta dela morre na próxima ação");
    api.add({ method: "DELETE", path: `${USERS}/u-2`, status: 204 });
    api.add({ method: "GET", path: USERS, body: { data: [dona] } });
    fireEvent.click(screen.getByRole("button", { name: "Remover acesso" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
  });

  it("para quem é equipe a tela não aparece", async () => {
    signIn();
    withUsers([dona], { me: { role: "staff" } });
    renderInPanel(routes, "/usuarios");
    await screen.findByText("Só o dono administra os usuários da loja.");
    expect(screen.queryByLabelText("Senha provisória")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/users-page.test.tsx
```

- [ ] **Step 3: Os hooks**

Crie `apps/panel/src/features/users/useUsers.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteUser, type InviteBody, inviteUser, listUsers } from "../../api/users.ts";

export function usersQueryKey(restaurantId: string) {
  return ["users", restaurantId] as const;
}

export function useUsersList(restaurantId: string, enabled: boolean) {
  return useQuery({
    queryKey: usersQueryKey(restaurantId),
    queryFn: () => listUsers(restaurantId),
    // Quem é equipe recebe 403 nas três rotas: pedir a lista só para mostrar
    // o erro seria gastar uma requisição para chegar a uma tela que já sabemos
    // que não existe para essa pessoa.
    enabled,
  });
}

function useInvalidateUsers(restaurantId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: usersQueryKey(restaurantId) });
}

export function useInviteUser(restaurantId: string) {
  const invalidate = useInvalidateUsers(restaurantId);
  return useMutation({
    mutationFn: (body: InviteBody) => inviteUser(restaurantId, body),
    onSuccess: invalidate,
  });
}

/** Uma instância por linha: o observer desanexa a cada `mutate()`. */
export function useRemoveUser(restaurantId: string, userId: string) {
  const invalidate = useInvalidateUsers(restaurantId);
  return useMutation({
    mutationFn: () => deleteUser(restaurantId, userId),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 4: O CSS**

Crie `apps/panel/src/features/users/UsersPage.module.css`:

```css
.page {
  display: grid;
  gap: 14px;
  max-width: 760px;
  padding: 18px 20px;
}

.note {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-ink2);
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

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 58px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--mc-line);
}

.avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--mc-surface3);
  color: var(--mc-ink2);
  font-size: 12.5px;
  font-weight: 700;
}

.info {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
}

.name {
  font-size: 15px;
  font-weight: 600;
}

.email {
  overflow: hidden;
  font-size: 12.5px;
  color: var(--mc-ink3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 12px;
}

.badgeOwner {
  background: var(--mc-accent-soft);
  border-color: var(--mc-accent-line);
  color: var(--mc-accent-hi);
}

.self {
  color: var(--mc-ink3);
  font-size: 13px;
}

.invite {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  background: var(--mc-surface2);
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}

.error {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-danger);
}
```

- [ ] **Step 5: A página**

Crie `apps/panel/src/features/users/UsersPage.tsx`:

```tsx
import { Button, PasswordInput, Select, TextInput } from "@mantine/core";
import { type FormEvent, useState } from "react";
import { describeError } from "../../api/client.ts";
import type { RestaurantUser, UserRole } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Notice } from "../../ui/Notice.tsx";
import {
  initials,
  type InviteErrors,
  type InviteForm,
  isSelf,
  removeUserConfirm,
  roleLabel,
  validateInvite,
} from "./users.ts";
import classes from "./UsersPage.module.css";
import { useInviteUser, useRemoveUser, useUsersList } from "./useUsers.ts";

const EMPTY: InviteForm = { name: "", email: "", password: "", role: "staff" };

function UserRow({
  restaurantId,
  user,
  self,
  onFail,
}: {
  restaurantId: string;
  user: RestaurantUser;
  self: boolean;
  onFail: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useRemoveUser(restaurantId, user.id);

  return (
    <li className={classes.row}>
      <span className={classes.avatar} aria-hidden="true">
        {initials(user.name)}
      </span>
      <div className={classes.info}>
        <span className={classes.name}>{user.name}</span>
        <span className={classes.email}>{user.email}</span>
      </div>
      <span
        className={
          user.role === "owner" ? `${classes.badge} ${classes.badgeOwner}` : classes.badge
        }
      >
        {roleLabel(user.role)}
      </span>
      {self ? (
        <span className={classes.self}>você</span>
      ) : (
        <Button
          variant="subtle"
          className={buttons.dangerText}
          aria-label={`Remover ${user.name}`}
          onClick={() => setConfirming(true)}
        >
          Remover
        </Button>
      )}
      <ConfirmDialog
        copy={confirming ? removeUserConfirm(user.name) : null}
        busy={remove.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => setConfirming(false),
            onError: (cause) => {
              setConfirming(false);
              onFail(describeError(cause));
            },
          })
        }
      />
    </li>
  );
}

export function UsersPage() {
  const me = useSessionUser();
  const owner = me.role === "owner";
  const users = useUsersList(me.restaurantId, owner);
  const [form, setForm] = useState<InviteForm>(EMPTY);
  const [errors, setErrors] = useState<InviteErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const invite = useInviteUser(me.restaurantId);

  if (!owner) {
    return (
      <div className={classes.page}>
        <Notice tone="accent" title="Usuários">
          Só o dono administra os usuários da loja.
        </Notice>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const problems = validateInvite(form);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    invite.mutate(
      { name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role },
      {
        onSuccess: () => setForm(EMPTY),
        onError: (cause) => setFailure(describeError(cause)),
      },
    );
  };

  return (
    <div className={classes.page}>
      <p className={classes.note}>
        Dono e equipe operam o painel do mesmo jeito. A diferença é só esta tela e a remoção do
        restaurante.
      </p>
      {users.isError && users.data === undefined && (
        <Notice tone="danger" title="Não foi possível carregar os usuários">
          {describeError(users.error)}
        </Notice>
      )}
      <section className={classes.card}>
        <ul className={classes.list}>
          {(users.data ?? []).map((user) => (
            <UserRow
              key={user.id}
              restaurantId={me.restaurantId}
              user={user}
              self={isSelf(user, me.id)}
              onFail={setFailure}
            />
          ))}
        </ul>
        <form className={classes.invite} onSubmit={submit}>
          <div className={classes.fields}>
            <TextInput
              label="Nome"
              value={form.name}
              error={errors.name}
              onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
            />
            <TextInput
              label="E-mail"
              value={form.email}
              error={errors.email}
              onChange={(event) => setForm({ ...form, email: event.currentTarget.value })}
            />
            <PasswordInput
              label="Senha provisória"
              description="Você entrega esta senha à pessoa. Ela troca depois, no menu da conta."
              value={form.password}
              error={errors.password}
              onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
            />
            <Select
              label="Papel"
              data={[
                { value: "staff", label: "Equipe" },
                { value: "owner", label: "Dono" },
              ]}
              value={form.role}
              allowDeselect={false}
              onChange={(value) => setForm({ ...form, role: (value ?? "staff") as UserRole })}
            />
          </div>
          <div>
            <Button type="submit" loading={invite.isPending}>
              Convidar
            </Button>
          </div>
        </form>
      </section>
      <p className={classes.note}>
        O papel é escolhido no convite. Para trocar, remova a pessoa e convide de novo.
      </p>
      <p className={classes.note}>
        Sem papel informado, o usuário nasce como equipe. Ninguém remove a própria conta.
      </p>
      {failure && (
        <p role="alert" className={classes.error}>
          {failure}
        </p>
      )}
    </div>
  );
}
```

⚠️ O `Select` do Mantine com `label` fica acessível por `getByLabelText("Papel")`; se o teste precisar dele, use `fireEvent` no input e escolha a opção pelo texto. Os testes deste plano não mexem no papel, então o padrão `staff` é o que vai na chamada.

- [ ] **Step 6: Rota e rail (só o dono)**

Em `apps/panel/src/router.tsx`:

```tsx
import { UsersPage } from "./features/users/UsersPage.tsx";
```

```tsx
              { path: "/usuarios", handle: { title: "Usuários" }, element: <UsersPage /> },
```

Em `apps/panel/src/layout/Rail.tsx`, o tipo do item ganha a marca e o grupo ganha o link:

```tsx
const NAV_GROUPS: { title: string; items: { to: string; label: string; ownerOnly?: true }[] }[] = [
```

```tsx
      { to: "/dados-da-loja", label: "Dados da loja" },
      // Só o dono: a API responde 403 nas três rotas de usuários, e link morto
      // é pior que ausência.
      { to: "/usuarios", label: "Usuários", ownerOnly: true },
```

e o `map` dos itens filtra pelo papel da sessão:

```tsx
            {group.items
              .filter((item) => item.ownerOnly !== true || me.role === "owner")
              .map((item) => (
```

- [ ] **Step 7: Rodar e ver passar**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/users-page.test.tsx
```

Esperado: 6 testes passando.

- [ ] **Step 8: O rail, coberto**

Acrescente ao fim de `apps/panel/test/layout.test.tsx`, dentro do `describe` que já existe, dois casos (adapte os helpers de render aos que o arquivo já usa):

```tsx
  it("o item Usuários existe para o dono e some para a equipe", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/pedidos");
    expect(await screen.findByRole("link", { name: "Usuários" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Mesas e QR" })).not.toBeNull();
  });

  it("para a equipe, Usuários não aparece no rail", async () => {
    signIn();
    mockApi(panelHandlers({ me: { role: "staff" } }));
    renderInPanel(routes, "/pedidos");
    await screen.findByRole("link", { name: "Mesas e QR" });
    expect(screen.queryByRole("link", { name: "Usuários" })).toBeNull();
  });
```

- [ ] **Step 9: Type-check e suíte inteira**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel exec tsc --noEmit && pnpm --filter @menuclick/panel test
```

- [ ] **Step 10: Commit**

```bash
git add apps/panel/src apps/panel/test
git commit -m "feat(panel): ✨ adiciona a tela de usuários restrita ao dono"
```

---

### Task 7: Documentação e verificação final

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-22-painel-mesas-usuarios-parte-3b-design.md`

- [ ] **Step 1: As três regras no `CLAUDE.md`**

Na seção **Painel da loja (`apps/panel`)**, acrescente ao fim da lista de marcadores:

```markdown
- **O QR sai do `qrUrl` que a API monta**, e a impressão é uma folha escondida na própria página (`@media print` + `window.print()`): o painel nunca monta URL de QR, e não há biblioteca de PDF — salvar em PDF é o diálogo do navegador. A seleção é por id e descarta mesa que sumiu da lista (`features/tables/tables.ts`).
- ⚠️ **Renomear a mesa não invalida o adesivo; "Novo código" invalida.** O `PATCH` da API só muda o rótulo, e a rota `rotate-hash` é separada justamente por isso — a nota do topo da tela promete isso a quem vai imprimir.
- ⚠️ **O papel de um usuário não se edita:** a API não tem `PATCH .../users/:id` e o e-mail é único, então reconvidar com outro papel também não funciona enquanto a conta existir. A tela diz isso e a troca é remover e convidar de novo. "É você" é decidido pelo **id da sessão**, nunca pelo e-mail.
```

- [ ] **Step 2: Marcar a spec como implementada**

No cabeçalho da spec, troque `**Estado:** aprovado, não implementado` por `**Estado:** implementado`.

- [ ] **Step 3: Verificação final**

```bash
unset -f node npm npx pnpm nvm 2>/dev/null; pnpm lint && pnpm --filter @menuclick/panel exec tsc --noEmit && pnpm --filter @menuclick/panel test
```

Esperado: lint limpo, type-check limpo, suíte do painel verde (325 testes de antes + os desta parte). A API não foi tocada — não é preciso rodar a suíte dela.

- [ ] **Step 4: Conferir que nada indevido entrou**

```bash
git status --short && git diff main --stat -- pnpm-workspace.yaml apps/api
```

Esperado: árvore limpa, e **nenhuma** mudança em `pnpm-workspace.yaml` nem em `apps/api`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-22-painel-mesas-usuarios-parte-3b-design.md
git commit -m "docs(panel): 📝 documenta as regras de mesas, qr e usuários"
```

---

## Autorrevisão (feita ao escrever o plano)

- **Cobertura da spec:** grade `minmax(215px,1fr)` + QR 104 + URL 11,5 px (Task 3 CSS); nota literal do topo (Task 3); cartão tracejado de cadastro (Task 3); três ações com os textos literais (Tasks 2 e 3); barra "Selecionar todas"/"Limpar seleção"/"Imprimir N adesivos"/"Selecione para imprimir" e folha de impressão com `level="Q"` (Task 4); seleção que descarta mesa sumida (Task 2 + Task 4); mesma chave de cache das mesas (Task 3, `tablesQueryKey` importado por `useOrders.ts`); Usuários com linhas de 58 px, avatar de 32 px, selo, "você" pelo id, confirmação de remoção, convite de quatro campos com senha de 8 e notas literais (Tasks 5 e 6); só o dono na rota e no rail (Task 6); `react-qr-code` como única dependência nova (Task 3); as três regras do `CLAUDE.md` (Task 7).
- **Fora de escopo mantido fora:** trocar e-mail de usuário, conta por mesa, geração de PDF no painel.
- **Identificadores conferidos no código:** `apiRequest`, `fetchAllPages`, `ConfirmDialog`/`ConfirmCopy`, `Notice`, `buttons.dangerText`, `useSessionUser`, `useRestaurant` (`features/restaurant/useRestaurant.ts`), `mockApi`/`panelHandlers`/`signIn`/`renderInPanel`, e os tokens `surface2`/`surface3`/`ink3`/`accent-soft`/`accent-line`/`accent-hi`/`line-hi`.
- **Consistência de tipos:** `tablesQueryKey` é definido na Task 3 e consumido pela Task 3 (Pedidos) e Task 4; `visibleSelection`/`allSelected`/`printButtonLabel`/`selectAllLabel`/`toggleSelection` são definidos na Task 2 e consumidos na Task 4; `InviteForm`/`InviteErrors` são definidos na Task 5 e consumidos na Task 6; `InviteBody` (Task 1) é o corpo que a Task 6 monta a partir do `InviteForm`.
