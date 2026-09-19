# Painel da loja, parte 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A loja entra no painel, destrava o e-mail, recebe e despacha pedidos num kanban que se atualiza sozinho, e mantém produtos e seções — tudo contra a API real.

**Architecture:** SPA em `apps/panel` (Vite + React + Mantine), falando com a API pelo proxy do Vite (`/api` → `:3333`). Estado de servidor no TanStack Query, com polling de 10 s que continua com a aba em segundo plano. As regras de pedido (colunas, ações, textos de confirmação, andamento) moram em funções puras testadas à parte; as telas só as consomem. Os tokens de cor do handoff viram variáveis CSS (`--mc-*`) injetadas pelo `cssVariablesResolver` do Mantine, nos dois temas.

**Tech Stack:** React 19, Mantine 9, React Router 8 (modo data), TanStack Query 5, Vite 8, Vitest 5 + Testing Library + jsdom, TypeScript 7 (`tsc --noEmit`), `@tabler/icons-react`, Figtree via `@fontsource`.

**Spec:** `docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md` — a autoridade. **Handoff:** `docs/design/painel-da-loja/README.md` (tokens, medidas, copy) e o protótipo `Painel da Loja.dc.html` ao lado (abre direto no navegador). **Contrato:** `apps/api/openapi.json`.

## Global Constraints

- **Node >= 23.6** (dev usa 24). No shell do agente, `node`/`pnpm` podem ser funções do nvm que recursam: rode `unset -f node npm npx pnpm nvm 2>/dev/null` no início de cada comando que os use.
- **Dependências — só estas**, todas aprovadas na spec: runtime `react`, `react-dom`, `@mantine/core`, `@mantine/hooks`, `@tabler/icons-react`, `react-router`, `@tanstack/react-query`, `@fontsource/figtree`; dev `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom` (peer obrigatório), `typescript`, `@types/react`, `@types/react-dom`; na raiz, `eslint-plugin-react-hooks`. **Nada além disso sem perguntar ao usuário** — nem `@testing-library/jest-dom`, nem `user-event`, nem msw.
- **Se o `pnpm install` recusar um script de build** ("ignored build scripts" / erro de `allowBuilds`), **pare e pergunte ao usuário**: o `CLAUDE.md` exige decisão explícita no `pnpm-workspace.yaml`.
- **TypeScript apagável:** sem `enum` (uniões `as const`), sem parameter properties, `import type` para tipos, **imports locais com extensão** (`.ts`/`.tsx`).
- **Identificadores em inglês; toda copy em pt-BR, literal do handoff.** Os únicos desvios permitidos são os da tabela "Onde este desenho diverge do handoff" da spec.
- **Cor só por `var(--mc-<token>)`.** Hex solto só existe em `src/theme/tokens.ts`. **Sem sombra, sem gradiente, sem transição, sem animação.**
- **Todo número na tela leva a classe `n`** (`font-variant-numeric: tabular-nums`).
- **Dinheiro é centavo inteiro.** Reais digitados viram centavos por `parseReaisToCents` (string), nunca por float.
- **Toda chamada à API passa por `apiRequest`** (`src/api/client.ts`). Nunca `fetch` direto. Corpo (e `Content-Type`) só quando há corpo — o Fastify responde 400 a corpo JSON vazio.
- **Chaves de query:** tudo que é pedido começa com `"orders"` (lista, detalhe, pendentes, resumo), para uma invalidação só cobrir tudo.
- **`apps/api` não muda neste plano.**
- **Testes:** Vitest + Testing Library, `fetch` mockado por `mockApi` (`test/api-mock.ts`), Mantine com `env="test"`. Sem `jest-dom`: asserte com `toBeTruthy()`/`toBeNull()`/propriedades do elemento.
- **Commits:** `<tipo>(<escopo>): <emoji> <mensagem>`, pt-BR, presente do indicativo, minúscula, sem ponto final, ≤ 72 caracteres; um commit por mudança lógica; **sem** trailer de coautoria.

---

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `apps/panel/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.env.example` | o app e seu build/teste |
| `src/main.tsx`, `src/App.tsx`, `src/providers.tsx`, `src/router.tsx`, `src/env.d.ts` | boot, providers, árvore de rotas |
| `src/theme/tokens.ts`, `theme.ts`, `global.css` | tokens do handoff, tema do Mantine, CSS global |
| `src/lib/money.ts`, `orderCode.ts`, `time.ts`, `useNow.ts`, `useCountdown.ts`, `useOnline.ts`, `audio.ts` | utilitários puros e hooks genéricos |
| `src/api/types.ts`, `client.ts`, `session.ts`, `pagination.ts` | contrato, transporte, sessão |
| `src/api/auth.ts`, `restaurant.ts`, `orders.ts`, `tables.ts`, `delivery.ts`, `categories.ts`, `products.ts`, `optionGroups.ts` | um módulo por recurso da API |
| `src/auth/useMe.ts`, `guards.tsx`, `ScreenStates.tsx`, `sessionExpiry.ts`, `useLogout.ts` | sessão no front e as guardas de rota |
| `src/ui/Notice.tsx`, `ConfirmDialog.tsx`, `confirmCopy.ts`, `buttons.module.css` | peças visuais compartilhadas |
| `src/features/access/*` | login, cadastro, esqueci, nova senha, link de verificação, bloqueio |
| `src/layout/*` | casca: rail, header, pausa, menu da conta |
| `src/features/restaurant/useRestaurant.ts` | o restaurante da sessão e a pausa |
| `src/features/orders/orderRules.ts`, `presentation.ts`, `orderFilters.ts`, `newOrders.ts` | regras puras de pedido |
| `src/features/orders/*.tsx`, `useOrders.ts`, `orderActionFlow.tsx`, `useNewOrderAlert.ts` | kanban, drawer, ações e aviso de pedido novo |
| `src/features/categories/*` | Seções |
| `src/features/products/*` | Produtos e Produto |
| `test/setup.ts`, `api-mock.ts`, `render.tsx`, `fixtures.ts` | infraestrutura de teste |

---

### Task 1: Esqueleto do `apps/panel`

**Files:**
- Create: `apps/panel/package.json`, `apps/panel/tsconfig.json`, `apps/panel/vite.config.ts`, `apps/panel/index.html`, `apps/panel/src/main.tsx`, `apps/panel/src/App.tsx`, `apps/panel/src/env.d.ts`, `apps/panel/test/setup.ts`
- Test: `apps/panel/test/App.test.tsx`
- Modify: `eslint.config.js`, `turbo.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `App` (componente), script `pnpm --filter @menuclick/panel {dev,build,test}`, ambiente de teste jsdom com `test/setup.ts`.

- [ ] **Step 1: Criar o `package.json` só com os scripts**

```json
{
  "name": "@menuclick/panel",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Instalar as dependências aprovadas**

```bash
cd /Users/guilhermepassarinho/Desktop/Projects/MenuClick
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm --filter @menuclick/panel add react react-dom @mantine/core @mantine/hooks @tabler/icons-react react-router @tanstack/react-query @fontsource/figtree
pnpm --filter @menuclick/panel add -D vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/dom typescript @types/react @types/react-dom
pnpm add -D -w eslint-plugin-react-hooks
```

Expected: instala sem erro. **Se aparecer aviso/erro de script de build não autorizado, pare e pergunte ao usuário** (ver Global Constraints).

- [ ] **Step 3: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["vite/client"],

    "allowImportingTsExtensions": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,

    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

- [ ] **Step 4: Criar `vite.config.ts`**

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // Porta fixa: os links de e-mail da API (PASSWORD_RESET_URL e
    // EMAIL_VERIFICATION_URL) apontam para :5173 por default. Se a porta
    // estiver ocupada, é melhor falhar do que subir noutra e o link cair no
    // vazio.
    port: 5173,
    strictPort: true,
    // Mesma origem no dev: o navegador fala com /api e o Vite repassa para a
    // API, sem precisar mexer em CORS_ORIGINS.
    proxy: {
      "/api": {
        target: "http://localhost:3333",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./test/setup.ts"],
  },
});
```

- [ ] **Step 5: Criar `index.html`, `src/env.d.ts` e `test/setup.ts`**

`apps/panel/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MenuClick · Painel da loja</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/panel/src/env.d.ts`:

```ts
interface ImportMetaEnv {
  /** Base da API. Default `/api` (o proxy do Vite no dev). */
  readonly VITE_API_URL?: string;
  /** Link do suporte na tela de bloqueio. Sem ele, o botão não aparece. */
  readonly VITE_SUPPORT_URL?: string;
}
```

`apps/panel/test/setup.ts`:

```ts
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Com `globals: false`, a Testing Library não registra a limpeza sozinha.
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// O jsdom não implementa matchMedia, e o MantineProvider consulta o esquema
// de cor do sistema por ele.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: ResizeObserverStub,
});
window.HTMLElement.prototype.scrollIntoView = () => {};
```

- [ ] **Step 6: Escrever o teste que falha**

`apps/panel/test/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.tsx";

describe("App", () => {
  it("sobe e renderiza", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "MenuClick" })).toBeTruthy();
  });
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test`
Expected: FAIL — `Failed to resolve import "../src/App.tsx"`.

- [ ] **Step 8: Implementar `App.tsx` e `main.tsx` mínimos**

`apps/panel/src/App.tsx`:

```tsx
export function App() {
  return <h1>MenuClick</h1>;
}
```

`apps/panel/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Rodar teste e build**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build`
Expected: 1 teste PASS; `tsc` sem erro; `vite build` gera `apps/panel/dist/`.

- [ ] **Step 10: Ligar o `eslint-plugin-react-hooks` só no painel**

Em `eslint.config.js`, acrescente o import no topo:

```js
import reactHooks from "eslint-plugin-react-hooks";
```

e, como **último** item do `tseslint.config(...)`, depois do bloco de `rules`:

```js
  {
    // Regras de hooks (e as do React Compiler, que vêm no `recommended` da
    // v7) só onde existe React. Se uma delas acusar um padrão legítimo,
    // corrija o código — não desligue a regra sem falar com o usuário.
    files: ["apps/panel/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
  },
```

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm lint`
Expected: sem erros.

- [ ] **Step 11: `turbo.json` guarda o `dist/` no cache do build**

Troque o bloco `build` por:

```json
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
```

- [ ] **Step 12: Commit do app**

```bash
git add apps/panel eslint.config.js turbo.json package.json pnpm-lock.yaml
git commit -m "build(panel): 📦 cria o app do painel com vite, react e mantine"
```

- [ ] **Step 13: CI roda o painel**

Em `.github/workflows/ci.yml`, logo depois do step `Typecheck`, acrescente:

```yaml
      - name: Build (painel)
        run: pnpm --filter @menuclick/panel run build

      - name: Test (painel)
        run: pnpm --filter @menuclick/panel run test
```

```bash
git add .github/workflows/ci.yml
git commit -m "ci: 👷 roda build e testes do painel"
```

---

### Task 2: Utilitários (dinheiro, código do pedido, tempo, relógio, rede)

**Files:**
- Create: `apps/panel/src/lib/money.ts`, `orderCode.ts`, `time.ts`, `useNow.ts`, `useCountdown.ts`, `useOnline.ts`
- Test: `apps/panel/test/money.test.ts`, `orderCode.test.ts`, `time.test.ts`, `hooks.test.ts`

**Interfaces:**
- Produces:
  - `formatCents(cents: number): string` — `"R$ 101,00"`
  - `parseReaisToCents(input: string): number | null`
  - `centsToInput(cents: number): string` — `"1234,56"`
  - `orderCode(id: string): string` — `"#A3F9"`
  - `formatElapsed(fromIso: string, nowMs: number): string`, `elapsedMinutes(fromIso: string, nowMs: number): number`, `formatClock(iso: string, timeZone?: string): string`, `formatCountdown(seconds: number): string`, `formatAge(seconds: number): string`, `formatSecondsAgo(fromMs: number, nowMs: number): string`
  - `useNow(): number` (relógio de 1 s compartilhado), `useCountdown(): { seconds: number; start: (seconds: number) => void }`, `useOnline(): boolean`

- [ ] **Step 1: Escrever os testes que falham**

`apps/panel/test/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, parseReaisToCents } from "../src/lib/money.ts";

describe("money", () => {
  it("formata centavos em reais, com espaço inseparável depois do R$", () => {
    expect(formatCents(10100)).toBe("R$ 101,00");
    expect(formatCents(0)).toBe("R$ 0,00");
    expect(formatCents(123456)).toBe("R$ 1.234,56");
  });

  it("converte o texto digitado em centavos sem passar por float", () => {
    expect(parseReaisToCents("45,90")).toBe(4590);
    expect(parseReaisToCents("45,9")).toBe(4590);
    expect(parseReaisToCents("45")).toBe(4500);
    expect(parseReaisToCents("1.234,56")).toBe(123456);
    expect(parseReaisToCents("R$ 0,29")).toBe(29);
    expect(parseReaisToCents(" 12,50 ")).toBe(1250);
  });

  it("recusa o que não é valor em reais", () => {
    for (const bad of ["", "abc", "12,345", "12.5", "-3", "1,2,3", "12.34,5"]) {
      expect(parseReaisToCents(bad)).toBeNull();
    }
  });

  it("devolve o valor para edição, sem separador de milhar", () => {
    expect(centsToInput(123456)).toBe("1234,56");
    expect(centsToInput(5)).toBe("0,05");
  });
});
```

`apps/panel/test/orderCode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { orderCode } from "../src/lib/orderCode.ts";

describe("orderCode", () => {
  it("usa os quatro primeiros hex do UUID, em maiúsculas", () => {
    expect(orderCode("a3f9c2d1-0000-4000-8000-000000000001")).toBe("#A3F9");
  });
});
```

`apps/panel/test/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  elapsedMinutes,
  formatAge,
  formatClock,
  formatCountdown,
  formatElapsed,
  formatSecondsAgo,
} from "../src/lib/time.ts";

const NOW = Date.parse("2026-09-19T23:00:00.000Z");

describe("time", () => {
  it("diz há quanto tempo, na unidade que se lê de relance", () => {
    expect(formatElapsed("2026-09-19T22:59:30.000Z", NOW)).toBe("agora");
    expect(formatElapsed("2026-09-19T22:58:00.000Z", NOW)).toBe("há 2 min");
    expect(formatElapsed("2026-09-19T21:00:00.000Z", NOW)).toBe("há 2 h");
    expect(formatElapsed("2026-09-17T23:00:00.000Z", NOW)).toBe("há 2 d");
  });

  it("conta os minutos inteiros", () => {
    expect(elapsedMinutes("2026-09-19T22:30:00.000Z", NOW)).toBe(30);
  });

  it("mostra a hora no fuso da loja", () => {
    expect(formatClock("2026-09-19T23:10:00.000Z", "America/Sao_Paulo")).toBe("20:10");
  });

  it("formata a contagem regressiva do reenvio", () => {
    expect(formatCountdown(38)).toBe("0:38");
    expect(formatCountdown(75)).toBe("1:15");
  });

  it("diz a idade da lista em palavras", () => {
    expect(formatAge(1)).toBe("1 segundo");
    expect(formatAge(40)).toBe("40 segundos");
    expect(formatAge(60)).toBe("1 minuto");
    expect(formatAge(180)).toBe("3 minutos");
  });

  it("monta o 'há N s' da barra de filtros", () => {
    expect(formatSecondsAgo(NOW - 6_000, NOW)).toBe("há 6 s");
  });
});
```

`apps/panel/test/hooks.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCountdown } from "../src/lib/useCountdown.ts";
import { useOnline } from "../src/lib/useOnline.ts";

describe("hooks genéricos", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("useCountdown desce um por segundo até zero", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCountdown());
    act(() => result.current.start(2));
    expect(result.current.seconds).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.seconds).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.seconds).toBe(0);
  });

  it("useOnline acompanha os eventos de rede do navegador", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test`
Expected: FAIL — módulos de `src/lib/` não existem.

- [ ] **Step 3: Implementar**

`apps/panel/src/lib/money.ts`:

```ts
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos inteiros → "R$ 1.234,56" (com espaço inseparável). */
export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

// "1.234,56" (milhar com ponto) ou "1234,56" (sem milhar); até 2 decimais.
const REAIS = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/;

/**
 * O que a pessoa digitou → centavos. Faz a conta em string para não passar
 * por float: 0,29 em float é 0.28999…, e um arredondamento mal feito some
 * com um centavo do preço.
 */
export function parseReaisToCents(input: string): number | null {
  const text = input.trim().replace(/^R\$\s*/, "");
  if (!REAIS.test(text)) return null;
  const [integer, fraction = ""] = text.replace(/\./g, "").split(",");
  return Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Centavos → texto para um campo editável ("1234,56", sem milhar). */
export function centsToInput(cents: number): string {
  const reais = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `${reais},${rest}`;
}
```

`apps/panel/src/lib/orderCode.ts`:

```ts
/**
 * Código curto do pedido para falar no balcão. A API só tem UUID, então o
 * código sai dos 4 primeiros hex dele: estável, mas NÃO sequencial. Quando a
 * API ganhar número por loja (pendência da spec), troca-se só esta função.
 */
export function orderCode(id: string): string {
  return `#${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}
```

`apps/panel/src/lib/time.ts`:

```ts
export function elapsedMinutes(fromIso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 60_000));
}

export function formatElapsed(fromIso: string, nowMs: number): string {
  const minutes = elapsedMinutes(fromIso, nowMs);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}

/** Hora de parede ("20:10") no fuso da loja; sem fuso, no do navegador. */
export function formatClock(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function formatAge(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return whole === 1 ? "1 segundo" : `${whole} segundos`;
  const minutes = Math.floor(whole / 60);
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

export function formatSecondsAgo(fromMs: number, nowMs: number): string {
  return `há ${Math.max(0, Math.round((nowMs - fromMs) / 1000))} s`;
}
```

`apps/panel/src/lib/useNow.ts`:

```ts
import { useSyncExternalStore } from "react";

// Um relógio de 1 s para o app inteiro, em vez de um setInterval por cartão.
// Mora fora do React para que ler a hora não seja chamada impura durante o
// render (a regra de pureza do React Compiler acusaria um Date.now() ali).
const listeners = new Set<() => void>();
let current = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  current = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (timer === null) {
    current = Date.now();
    timer = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return current;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
```

`apps/panel/src/lib/useCountdown.ts`:

```ts
import { useCallback, useEffect, useState } from "react";

/** Contagem regressiva em segundos; `start(n)` recomeça de `n`. */
export function useCountdown(): { seconds: number; start: (seconds: number) => void } {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const start = useCallback((value: number) => {
    setSeconds(Math.max(0, Math.ceil(value)));
  }, []);

  return { seconds, start };
}
```

`apps/panel/src/lib/useOnline.ts`:

```ts
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm lint`
Expected: todos PASS, lint limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/lib apps/panel/test
git commit -m "feat(panel): ✨ adiciona dinheiro, código do pedido e relógio"
```

---

### Task 3: Transporte — tipos, sessão, cliente HTTP e paginação

**Files:**
- Create: `apps/panel/src/api/types.ts`, `session.ts`, `client.ts`, `pagination.ts`, `apps/panel/test/api-mock.ts`
- Test: `apps/panel/test/session.test.ts`, `client.test.ts`, `pagination.test.ts`

**Interfaces:**
- Produces:
  - tipos em `types.ts`: `Address`, `UserRole`, `Me`, `LoginResponse`, `Restaurant`, `DeliveryFeeMode`, `OrderType`, `OrderStatus`, `PaymentMethod`, `Period`, `OrderTransition`, `Customer`, `Order`, `OrderItemOption`, `OrderItem`, `OrderDetail`, `OrdersSummary`, `Page<T>`, `Category`, `Product`, `PriceRule`, `Option`, `OptionGroup`, `Table`, `DeliveryNeighborhood`, `RegisterInput`
  - `readSession(): Session | null`, `saveSession(s: Session): void`, `clearSession(): void`, `type Session = LoginResponse`
  - `apiRequest<T>(path: string, options?: RequestOptions): Promise<T>`, `class ApiError { status: number; retryAfterSeconds: number | null; message }`, `class NetworkError`, `onUnauthorized(handler: (() => void) | null): void`, `describeError(error: unknown): string`
  - `fetchAllPages<T>(fetchPage: (offset: number) => Promise<Page<T>>, maxPages?: number): Promise<T[]>`
  - teste: `mockApi(handlers: MockHandler[]): { calls: MockCall[]; add(handler: MockHandler): void }`

- [ ] **Step 1: Criar `types.ts`** (só tipos — espelham `apps/api/openapi.json`; campo que a API **omite** quando nulo é opcional `?`, campo que vem `null` é `| null`)

```ts
export type Address = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

export type UserRole = "owner" | "staff";

export type Me = {
  id: string;
  restaurantId: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
};

export type LoginResponse = { token: string; expiresAt: string };

export type DeliveryFeeMode = "neighborhood" | "fixed" | "distance";

export type Restaurant = {
  id: string;
  slug: string;
  name: string;
  cuisineType: string;
  logoUrl?: string;
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
  deliveryFeeMode: DeliveryFeeMode;
  deliveryFixedFeeInCents: number;
  freeDeliveryAboveInCents?: number;
  deliveryFeeToArrange: boolean;
  minimumOrderInCents: number;
};

export type OrderType = "dine_in" | "takeaway" | "delivery";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready_for_pickup"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

export type PaymentMethod = "cash" | "card_on_delivery" | "pix" | "meal_voucher";

export type Period = "today" | "yesterday" | "last7days" | "thisMonth";

/** "accept" é do painel: vira `confirm` na URL (ver `api/orders.ts`). */
export type OrderTransition =
  | "accept"
  | "start-preparing"
  | "dispatch"
  | "ready"
  | "complete"
  | "cancel";

export type Customer = { id: string; name: string; phone: string };

export type Order = {
  id: string;
  restaurantId: string;
  customer: Customer;
  type: OrderType;
  status: OrderStatus;
  totalInCents: number;
  /** `null` = "a combinar" OU pedido que não é entrega. `0` = grátis. */
  deliveryFeeInCents: number | null;
  deliveryAddress: Address | null;
  paymentMethod: PaymentMethod;
  /** Ausente no dinheiro = o cliente tem o valor exato. */
  changeForInCents?: number;
  table: { id: string; label: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type OrderItemOption = {
  optionId: string;
  groupName: string;
  name: string;
  priceInCents: number;
  quantity: number;
};

export type OrderItem = {
  id: string;
  productId: string;
  name: string;
  priceInCents: number;
  unitPriceInCents: number;
  quantity: number;
  options: OrderItemOption[];
};

export type OrderDetail = Order & { items: OrderItem[] };

export type OrdersSummary = {
  period: { from: string; to: string };
  counts: Record<OrderStatus, number>;
  revenueInCents: number;
  revenueOrderCount: number;
  averageTicketInCents: number;
};

export type Page<T> = { data: T[]; limit: number; offset: number; total: number };

export type Category = { id: string; restaurantId: string; name: string; position: number };

export type Product = {
  id: string;
  restaurantId: string;
  name: string;
  categoryId?: string;
  priceInCents: number;
  description?: string;
  photoUrl?: string;
  stock: number;
  optionGroupIds: string[];
};

export type PriceRule = "sum" | "highest" | "average";

export type Option = {
  id: string;
  name: string;
  priceInCents: number;
  maxQuantity: number;
  available: boolean;
  position: number;
};

export type OptionGroup = {
  id: string;
  restaurantId: string;
  name: string;
  minOptions: number;
  maxOptions: number;
  priceRule: PriceRule;
  options: Option[];
};

export type Table = { id: string; restaurantId: string; label: string; hash: string; qrUrl: string };

export type DeliveryNeighborhood = { name: string; feeInCents: number };

export type RegisterInput = {
  restaurant: {
    name: string;
    cuisineType: string;
    address: Address;
    isDelivery: boolean;
    isTakeaway: boolean;
    isQrcode: boolean;
  };
  user: { name: string; email: string; password: string };
};
```

- [ ] **Step 2: Criar o mock de API dos testes**

`apps/panel/test/api-mock.ts`:

```ts
import { vi } from "vitest";

export type MockHandler = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Casado contra o caminho SEM o prefixo /api e sem querystring. */
  path: string | RegExp;
  /** Se presente, cada chave precisa bater com a querystring. */
  query?: Record<string, string>;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Responde uma vez e sai da lista (para simular "antes" e "depois"). */
  once?: boolean;
};

export type MockCall = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
};

/**
 * Substitui o `fetch` global. O primeiro handler que casa responde — então
 * ponha os específicos (com `query` ou `once`) antes dos genéricos. Chamada
 * sem handler vira 500 com a mensagem "Chamada sem mock: ...", que aparece na
 * tela e denuncia o esquecimento.
 */
export function mockApi(initial: MockHandler[]) {
  const handlers = [...initial];
  const calls: MockCall[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname.replace(/^\/api/, "");
    const query = Object.fromEntries(url.searchParams);
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, query, body, headers });

    const index = handlers.findIndex(
      (handler) =>
        handler.method === method &&
        (typeof handler.path === "string" ? handler.path === path : handler.path.test(path)) &&
        Object.entries(handler.query ?? {}).every(([key, value]) => query[key] === value),
    );
    if (index === -1) {
      return new Response(
        JSON.stringify({ statusCode: 500, error: "Mock", message: `Chamada sem mock: ${method} ${path}` }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
    const handler = handlers[index];
    if (handler.once) handlers.splice(index, 1);
    const status = handler.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(handler.body ?? {}), {
      status,
      headers: { "content-type": "application/json", ...handler.headers },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    /** Acrescenta um handler na FRENTE da lista (passa a ter prioridade). */
    add: (handler: MockHandler) => handlers.unshift(handler),
  };
}
```

- [ ] **Step 3: Escrever os testes que falham**

`apps/panel/test/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clearSession, readSession, saveSession } from "../src/api/session.ts";

describe("session", () => {
  it("guarda e lê a sessão", () => {
    saveSession({ token: "abc", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(readSession()).toEqual({ token: "abc", expiresAt: "2099-01-01T00:00:00.000Z" });
  });

  it("sessão vencida some sozinha", () => {
    saveSession({ token: "abc", expiresAt: "2000-01-01T00:00:00.000Z" });
    expect(readSession()).toBeNull();
    expect(localStorage.getItem("menuclick.session")).toBeNull();
  });

  it("lixo no storage vira sessão nenhuma", () => {
    localStorage.setItem("menuclick.session", "{não é json");
    expect(readSession()).toBeNull();
  });

  it("clearSession apaga", () => {
    saveSession({ token: "abc", expiresAt: "2099-01-01T00:00:00.000Z" });
    clearSession();
    expect(readSession()).toBeNull();
  });
});
```

`apps/panel/test/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiRequest,
  describeError,
  NetworkError,
  onUnauthorized,
} from "../src/api/client.ts";
import { readSession, saveSession } from "../src/api/session.ts";
import { mockApi } from "./api-mock.ts";

function signIn() {
  saveSession({ token: "tok", expiresAt: "2099-01-01T00:00:00.000Z" });
}

describe("apiRequest", () => {
  it("manda o Bearer quando há sessão, e o caminho vai com /api", async () => {
    signIn();
    const api = mockApi([{ method: "GET", path: "/auth/me", body: { id: "u1" } }]);
    await expect(apiRequest("/auth/me")).resolves.toEqual({ id: "u1" });
    expect(api.calls[0].headers.Authorization).toBe("Bearer tok");
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url.startsWith("/api/auth/me")).toBe(true);
  });

  it("sem corpo, não declara Content-Type (o Fastify recusa JSON vazio)", async () => {
    signIn();
    const api = mockApi([{ method: "POST", path: "/auth/logout", status: 204 }]);
    await expect(apiRequest("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
    expect(api.calls[0].headers["Content-Type"]).toBeUndefined();
    expect(api.calls[0].body).toBeUndefined();
  });

  it("com corpo, manda JSON", async () => {
    const api = mockApi([{ method: "POST", path: "/auth/login", body: { token: "t" } }]);
    await apiRequest("/auth/login", { method: "POST", body: { email: "a@b.c" }, auth: false });
    expect(api.calls[0].headers["Content-Type"]).toBe("application/json");
    expect(api.calls[0].body).toEqual({ email: "a@b.c" });
  });

  it("monta a querystring pulando o que é vazio", async () => {
    const api = mockApi([{ method: "GET", path: "/x", body: {} }]);
    await apiRequest("/x", { query: { a: "1", b: undefined, c: "", d: 2 } });
    expect(api.calls[0].query).toEqual({ a: "1", d: "2" });
  });

  it("erro vira ApiError com a mensagem da API e o Retry-After", async () => {
    mockApi([
      {
        method: "POST",
        path: "/auth/resend-verification",
        status: 429,
        body: { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded" },
        headers: { "retry-after": "38" },
      },
    ]);
    const error = await apiRequest("/auth/resend-verification", { method: "POST" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(38);
  });

  it("401 com sessão limpa a sessão e avisa quem escuta", async () => {
    signIn();
    const handler = vi.fn();
    onUnauthorized(handler);
    mockApi([{ method: "GET", path: "/auth/me", status: 401, body: { message: "Sessão inválida ou expirada" } }]);
    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(readSession()).toBeNull();
    expect(handler).toHaveBeenCalledOnce();
    onUnauthorized(null);
  });

  it("401 sem sessão (login errado) não é sessão expirada", async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    mockApi([{ method: "POST", path: "/auth/login", status: 401, body: { message: "E-mail ou senha inválidos" } }]);
    await expect(
      apiRequest("/auth/login", { method: "POST", body: {}, auth: false }),
    ).rejects.toMatchObject({ status: 401, message: "E-mail ou senha inválidos" });
    expect(handler).not.toHaveBeenCalled();
    onUnauthorized(null);
  });

  it("falha de rede vira NetworkError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("describeError", () => {
  it("traduz 429 e rede para quem está no balcão", () => {
    expect(describeError(new ApiError(429, "Rate limit exceeded", 30))).toBe(
      "Muitas tentativas seguidas. Aguarde um instante e tente de novo.",
    );
    expect(describeError(new NetworkError())).toBe(
      "Sem conexão com o servidor. Confira a internet e tente de novo.",
    );
    expect(describeError(new ApiError(409, "Já existe uma categoria chamada \"Bebidas\"", null))).toBe(
      "Já existe uma categoria chamada \"Bebidas\"",
    );
  });
});
```

`apps/panel/test/pagination.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { fetchAllPages } from "../src/api/pagination.ts";

describe("fetchAllPages", () => {
  it("pede páginas seguidas até completar o total", async () => {
    const fetchPage = vi.fn(async (offset: number) => ({
      data: offset === 0 ? [1, 2] : [3],
      limit: 2,
      offset,
      total: 3,
    }));
    await expect(fetchAllPages(fetchPage)).resolves.toEqual([1, 2, 3]);
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 2]);
  });

  it("para numa página vazia mesmo se o total mentir", async () => {
    const fetchPage = vi.fn(async (offset: number) => ({ data: [], limit: 100, offset, total: 50 }));
    await expect(fetchAllPages(fetchPage)).resolves.toEqual([]);
    expect(fetchPage).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test`
Expected: FAIL — `session.ts`, `client.ts`, `pagination.ts` não existem.

- [ ] **Step 5: Implementar**

`apps/panel/src/api/session.ts`:

```ts
import type { LoginResponse } from "./types.ts";

// Provisório (spec, ponto 5 das pendências): localStorage é exposto a XSS.
// A alternativa é cookie httpOnly num BFF, e a decisão foi adiada.
const STORAGE_KEY = "menuclick.session";

export type Session = LoginResponse;

export function readSession(): Session | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "string") {
      clearSession();
      return null;
    }
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      clearSession();
      return null;
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage indisponível: não há o que limpar
  }
}
```

`apps/panel/src/api/client.ts`:

```ts
import { clearSession, readSession } from "./session.ts";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

/** Erro com status HTTP. A `message` vem da API, já em pt-BR para quem lê. */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, message: string, retryAfterSeconds: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** O servidor nem respondeu: sem internet, API fora do ar, proxy caído. */
export class NetworkError extends Error {
  constructor() {
    super("Sem conexão com o servidor.");
    this.name = "NetworkError";
  }
}

type Query = Record<string, string | number | undefined>;

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
  /** `false` nas rotas públicas (login, cadastro...): não manda sessão. */
  auth?: boolean;
};

let unauthorizedHandler: (() => void) | null = null;

/** Quem reage à sessão expirada (o app redireciona para o login). */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function toQueryString(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, auth = true } = options;
  const session = auth ? readSession() : null;
  const headers: Record<string, string> = {};
  if (session) headers.Authorization = `Bearer ${session.token}`;
  // O Fastify responde 400 a `Content-Type: application/json` com corpo
  // vazio, então o header só vai quando há corpo.
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(BASE_URL + path + toQueryString(query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }

  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // 401 só é "sessão expirada" quando havia sessão: no login, 401 é senha
    // errada e não pode mandar ninguém para lugar nenhum.
    if (response.status === 401 && session) {
      clearSession();
      unauthorizedHandler?.();
    }
    const message =
      payload !== null && typeof payload === "object" && "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "Algo deu errado. Tente de novo.";
    const retryAfter = response.headers.get("retry-after");
    throw new ApiError(response.status, message, retryAfter === null ? null : Number(retryAfter));
  }
  return payload as T;
}

/** Texto de erro para a tela. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    // A mensagem do rate limit vem em inglês do plugin; as outras a API
    // escreve em pt-BR para o cliente ler.
    if (error.status === 429) return "Muitas tentativas seguidas. Aguarde um instante e tente de novo.";
    return error.message;
  }
  if (error instanceof NetworkError) {
    return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  }
  return "Algo deu errado. Tente de novo.";
}
```

`apps/panel/src/api/pagination.ts`:

```ts
import type { Page } from "./types.ts";

/**
 * Busca todas as páginas de uma listagem. O teto de páginas é rede de
 * segurança contra um `total` que nunca fecha, não um limite de negócio.
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number) => Promise<Page<T>>,
  maxPages = 10,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(items.length);
    items.push(...result.data);
    if (result.data.length === 0 || items.length >= result.total) break;
  }
  return items;
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/api apps/panel/test
git commit -m "feat(panel): ✨ adiciona cliente http, sessão e paginação"
```

---

### Task 4: Tema, providers e infraestrutura de render dos testes

**Files:**
- Create: `apps/panel/src/theme/tokens.ts`, `theme.ts`, `global.css`, `apps/panel/src/providers.tsx`, `apps/panel/test/render.tsx`, `apps/panel/test/fixtures.ts`
- Modify: `apps/panel/src/main.tsx`, `apps/panel/src/App.tsx`
- Test: `apps/panel/test/theme.test.ts`

**Interfaces:**
- Consumes: `ApiError` (Task 3).
- Produces:
  - `lightTokens`, `darkTokens`, `type TokenName`, `tokenVariables(tokens): Record<string, string>`
  - `theme` (createTheme), `cssVariablesResolver`
  - `createQueryClient(): QueryClient`, `AppProviders({ queryClient, children })`
  - teste: `renderRoutes(routes, initialPath, options?) → { router, queryClient, ...RenderResult }`, `LocationProbe` (mostra `pathname+search` em `data-testid="location"`), fixtures `RESTAURANT_ID`, `makeMe`, `makeRestaurant`, `makeOrder`, `makeOrderDetail`, `makeSummary`, `makeCategory`, `makeProduct`, `makeOptionGroup`, `signIn`

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/theme.test.ts`:

```ts
import { DEFAULT_THEME } from "@mantine/core";
import { describe, expect, it } from "vitest";
import { cssVariablesResolver } from "../src/theme/theme.ts";
import { lightTokens } from "../src/theme/tokens.ts";

describe("tema", () => {
  const resolved = cssVariablesResolver(DEFAULT_THEME);

  it("injeta os tokens do handoff nos dois temas", () => {
    expect(resolved.light["--mc-bg"]).toBe("#F5F4F1");
    expect(resolved.dark["--mc-bg"]).toBe("#15140F");
    expect(resolved.light["--mc-accent"]).toBe("#4A6B3A");
    expect(resolved.dark["--mc-accent"]).toBe("#93B375");
  });

  it("todo token claro tem par escuro", () => {
    for (const name of Object.keys(lightTokens)) {
      expect(resolved.dark[`--mc-${name}`]).toBeTruthy();
    }
  });

  it("componentes do Mantine usam a superfície, não o fundo da janela", () => {
    expect(resolved.light["--mantine-color-body"]).toBe("#FFFFFF");
    expect(resolved.light["--mantine-color-default-border"]).toBe("#E4E1DB");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- theme`
Expected: FAIL — `src/theme/theme.ts` não existe.

- [ ] **Step 3: Implementar tokens e tema**

`apps/panel/src/theme/tokens.ts`:

```ts
/**
 * Os tokens de cor do handoff (docs/design/painel-da-loja/README.md), nos
 * dois temas. É o ÚNICO lugar com hex no painel: a tela lê
 * `var(--mc-<nome>)`. Regra do handoff, mais importante que os valores: um
 * acento só (oliva); âmbar só para "exige ação agora"; vermelho só para
 * destrutivo e falha.
 */
export const lightTokens = {
  bg: "#F5F4F1",
  surface: "#FFFFFF",
  surface2: "#FAF9F7",
  surface3: "#EFEDE9",
  line: "#E4E1DB",
  "line-hi": "#CFCAC2",
  ink: "#1B1A17",
  ink2: "#5F5A52",
  ink3: "#6E6960",
  accent: "#4A6B3A",
  "accent-hi": "#3C5A2D",
  "accent-soft": "#EDF1E7",
  "accent-line": "#CBD8BD",
  "on-accent": "#FFFFFF",
  warn: "#8A5A12",
  "warn-strong": "#C4841F",
  "warn-soft": "#FBF2E2",
  "warn-line": "#E8D3A8",
  danger: "#98362A",
  "danger-soft": "#FAEDEB",
  "danger-line": "#E7C6C0",
  // ponto da pill "Retirada" — o handoff dá um valor só, para os dois temas
  pickup: "#6B7B8C",
  // fundo do modal de confirmação
  overlay: "rgba(20, 18, 14, 0.42)",
} as const;

export type TokenName = keyof typeof lightTokens;

export const darkTokens: Record<TokenName, string> = {
  bg: "#15140F",
  surface: "#1E1D19",
  surface2: "#242320",
  surface3: "#2B2A25",
  line: "#332F29",
  "line-hi": "#443F37",
  ink: "#EFEDE7",
  ink2: "#A8A29A",
  ink3: "#98928A",
  accent: "#93B375",
  "accent-hi": "#A6C489",
  "accent-soft": "#232A1C",
  "accent-line": "#39452C",
  "on-accent": "#14170F",
  warn: "#DFAE5E",
  "warn-strong": "#E8BE74",
  "warn-soft": "#2B2417",
  "warn-line": "#4A3D22",
  danger: "#E08878",
  "danger-soft": "#2C1D19",
  "danger-line": "#4E2F27",
  pickup: "#6B7B8C",
  overlay: "rgba(0, 0, 0, 0.55)",
};

export function tokenVariables(tokens: Record<TokenName, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tokens).map(([name, value]) => [`--mc-${name}`, value]),
  );
}
```

`apps/panel/src/theme/theme.ts`:

```ts
import {
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from "@mantine/core";
import { darkTokens, lightTokens, tokenVariables, type TokenName } from "./tokens.ts";

// Shade 6 = accent do tema claro; shade 3 = accent do escuro; 7 = accent-hi.
const olive: MantineColorsTuple = [
  "#EDF1E7",
  "#DCE5D2",
  "#CBD8BD",
  "#93B375",
  "#7A9A5F",
  "#5F814B",
  "#4A6B3A",
  "#3C5A2D",
  "#2F4723",
  "#23351A",
];

const FONT = "Figtree, ui-sans-serif, system-ui, sans-serif";
const NO_MOTION = { transitionProps: { duration: 0 } };

export const theme = createTheme({
  primaryColor: "olive",
  primaryShade: { light: 6, dark: 3 },
  autoContrast: true,
  colors: { olive },
  fontFamily: FONT,
  headings: { fontFamily: FONT },
  defaultRadius: "sm",
  radius: { xs: "4px", sm: "6px", md: "10px", lg: "10px", xl: "10px" },
  // "Sem sombra em nenhum lugar": separação é borda de 1px + troca de superfície.
  shadows: { xs: "none", sm: "none", md: "none", lg: "none", xl: "none" },
  components: {
    // O painel fica aberto o dia inteiro: nada anima.
    Modal: { defaultProps: NO_MOTION },
    Drawer: { defaultProps: NO_MOTION },
    Menu: { defaultProps: NO_MOTION },
    Popover: { defaultProps: NO_MOTION },
    Skeleton: { defaultProps: { animate: false } },
  },
});

function schemeVariables(tokens: Record<TokenName, string>): Record<string, string> {
  return {
    ...tokenVariables(tokens),
    // `--mantine-color-body` é o fundo de Modal, Paper, Drawer: vira a
    // superfície. O fundo da janela é o `bg`, aplicado no body (global.css).
    "--mantine-color-body": tokens.surface,
    "--mantine-color-text": tokens.ink,
    "--mantine-color-dimmed": tokens.ink3,
    "--mantine-color-placeholder": tokens.ink3,
    "--mantine-color-default": tokens.surface,
    "--mantine-color-default-hover": tokens.surface3,
    "--mantine-color-default-color": tokens.ink,
    "--mantine-color-default-border": tokens.line,
    "--mantine-color-error": tokens.danger,
  };
}

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: schemeVariables(lightTokens),
  dark: schemeVariables(darkTokens),
});
```

`apps/panel/src/theme/global.css`:

```css
body {
  margin: 0;
  background: var(--mc-bg);
  color: var(--mc-ink);
  font-size: 14px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

/* O handoff não admite transição: hover troca cor, sem animar. */
*,
*::before,
*::after {
  transition: none !important;
}

/* Todo número alinha em coluna. */
.n {
  font-variant-numeric: tabular-nums;
}

.eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mc-ink3);
}
```

- [ ] **Step 4: Providers e boot**

`apps/panel/src/providers.tsx`:

```tsx
import { localStorageColorSchemeManager, MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiError } from "./api/client.ts";
import { cssVariablesResolver, theme } from "./theme/theme.ts";

const colorSchemeManager = localStorageColorSchemeManager({ key: "menuclick.color-scheme" });

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        // 4xx não melhora tentando de novo; rede e 5xx ganham uma chance.
        retry: (failureCount, error) =>
          failureCount < 1 && !(error instanceof ApiError && error.status < 500),
      },
      mutations: { retry: false },
    },
  });
}

export function AppProviders({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="light"
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}
```

`apps/panel/src/main.tsx` (substitui o da Task 1):

```tsx
import "@mantine/core/styles.css";
import "@fontsource/figtree/400.css";
import "@fontsource/figtree/500.css";
import "@fontsource/figtree/600.css";
import "@fontsource/figtree/700.css";
import "./theme/global.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/panel/src/App.tsx` (substitui o da Task 1; a Task 5 troca o conteúdo pelo roteador):

```tsx
import { AppProviders, createQueryClient } from "./providers.tsx";

const queryClient = createQueryClient();

export function App() {
  return (
    <AppProviders queryClient={queryClient}>
      <h1>MenuClick</h1>
    </AppProviders>
  );
}
```

- [ ] **Step 5: Infraestrutura de render e fixtures dos testes**

`apps/panel/test/render.tsx`:

```tsx
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, type RouteObject, useLocation } from "react-router";
import { RouterProvider } from "react-router/dom";
import { cssVariablesResolver, theme } from "../src/theme/theme.ts";

type TestRouter = ReturnType<typeof createMemoryRouter>;

export type RenderOptions = {
  /** Roda antes do render — para instalar handlers que o boot do app instala. */
  beforeRender?: (context: { router: TestRouter; queryClient: QueryClient }) => void;
};

export function renderRoutes(routes: RouteObject[], initialPath: string, options: RenderOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  options.beforeRender?.({ router, queryClient });
  const view = render(
    // env="test": sem transições e sem portal — Modal, Drawer e Menu
    // renderizam no lugar, e a Testing Library os enxerga.
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} env="test">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
  return { ...view, router, queryClient };
}

/** Mostra onde o roteador está, para asserções de navegação. */
export function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}
```

`apps/panel/test/fixtures.ts`:

```ts
import { saveSession } from "../src/api/session.ts";
import type {
  Category,
  Me,
  OptionGroup,
  Order,
  OrderDetail,
  OrdersSummary,
  Product,
  Restaurant,
} from "../src/api/types.ts";

export const RESTAURANT_ID = "cb95db58-0ea1-4157-a6fd-64f775f24a6e";

export function signIn(): void {
  saveSession({ token: "token-de-teste", expiresAt: "2099-01-01T00:00:00.000Z" });
}

export function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    id: "2f8a1c04-9d3e-4b57-8a26-0c5e7b91d4f3",
    restaurantId: RESTAURANT_ID,
    name: "Cláudia Mendes",
    email: "gerencia@trattoriabella.com.br",
    role: "owner",
    emailVerified: true,
    ...overrides,
  };
}

export function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: RESTAURANT_ID,
    slug: "trattoria-bella",
    name: "Trattoria Bella",
    cuisineType: "Italiana",
    address: {
      street: "Rua Aspicuelta",
      number: "120",
      neighborhood: "Vila Madalena",
      city: "São Paulo",
      state: "SP",
      zipCode: "05433-010",
    },
    isDelivery: true,
    isTakeaway: true,
    isQrcode: true,
    timezone: "America/Sao_Paulo",
    acceptingOrders: true,
    acceptsCash: true,
    acceptsCardOnDelivery: true,
    acceptsPix: true,
    acceptsMealVoucher: false,
    deliveryFeeMode: "fixed",
    deliveryFixedFeeInCents: 900,
    deliveryFeeToArrange: false,
    minimumOrderInCents: 0,
    ...overrides,
  };
}

let orderSeq = 0;

/** Ids distintos a cada chamada: #A001, #A002... (passe `id` para fixar). */
export function makeOrder(overrides: Partial<Order> = {}): Order {
  orderSeq += 1;
  const head = (0xa000 + orderSeq).toString(16);
  return {
    id: `${head}f00d-0000-4000-8000-000000000000`,
    restaurantId: RESTAURANT_ID,
    customer: { id: "c1", name: "Marcela Andrade", phone: "11987654321" },
    type: "delivery",
    status: "pending",
    totalInCents: 10100,
    deliveryFeeInCents: 900,
    deliveryAddress: {
      street: "Rua Harmonia",
      number: "45",
      neighborhood: "Vila Madalena",
      city: "São Paulo",
      state: "SP",
      zipCode: "05435-000",
    },
    paymentMethod: "pix",
    table: null,
    createdAt: "2026-09-19T22:58:00.000Z",
    updatedAt: "2026-09-19T22:58:00.000Z",
    ...overrides,
  };
}

export function makeOrderDetail(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    ...makeOrder(overrides),
    items: [
      {
        id: "i1",
        productId: "p1",
        name: "Pizza Grande",
        priceInCents: 3000,
        unitPriceInCents: 4000,
        quantity: 2,
        options: [
          { optionId: "o1", groupName: "Sabores", name: "Calabresa", priceInCents: 4000, quantity: 1 },
          { optionId: "o2", groupName: "Sabores", name: "Portuguesa", priceInCents: 3800, quantity: 1 },
          { optionId: "o3", groupName: "Borda", name: "Catupiry", priceInCents: 800, quantity: 1 },
        ],
      },
      {
        id: "i2",
        productId: "p2",
        name: "Coca 2L",
        priceInCents: 1200,
        unitPriceInCents: 1200,
        quantity: 1,
        options: [],
      },
    ],
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<OrdersSummary> = {}): OrdersSummary {
  return {
    period: { from: "2026-09-19T03:00:00.000Z", to: "2026-09-20T03:00:00.000Z" },
    counts: {
      pending: 0,
      confirmed: 0,
      preparing: 0,
      ready_for_pickup: 0,
      out_for_delivery: 0,
      completed: 0,
      cancelled: 0,
    },
    revenueInCents: 0,
    revenueOrderCount: 0,
    averageTicketInCents: 0,
    ...overrides,
  };
}

export function makeCategory(overrides: Partial<Category> = {}): Category {
  return { id: "cat-1", restaurantId: RESTAURANT_ID, name: "Pizzas", position: 0, ...overrides };
}

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    restaurantId: RESTAURANT_ID,
    name: "Pizza Grande",
    categoryId: "cat-1",
    priceInCents: 4590,
    description: "Massa fina, 8 fatias. Escolha até 2 sabores.",
    stock: 12,
    optionGroupIds: [],
    ...overrides,
  };
}

export function makeOptionGroup(overrides: Partial<OptionGroup> = {}): OptionGroup {
  return {
    id: "grp-1",
    restaurantId: RESTAURANT_ID,
    name: "Sabores",
    minOptions: 1,
    maxOptions: 2,
    priceRule: "highest",
    options: [],
    ...overrides,
  };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS (o `App.test.tsx` da Task 1 continua passando).

- [ ] **Step 7: Conferir o tema no navegador**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel dev` e abra `http://localhost:5173`.
Expected: "MenuClick" em Figtree sobre fundo `#F5F4F1`. Pare o servidor.

- [ ] **Step 8: Commit**

```bash
git add apps/panel/src apps/panel/test
git commit -m "feat(panel): ✨ aplica os tokens do handoff como tema do mantine"
```

---

### Task 5: Rotas e guardas de acesso

**Files:**
- Create: `apps/panel/src/api/auth.ts`, `apps/panel/src/auth/useMe.ts`, `guards.tsx`, `ScreenStates.tsx`, `ScreenStates.module.css`, `sessionExpiry.ts`, `apps/panel/src/router.tsx`
- Modify: `apps/panel/src/App.tsx`, `apps/panel/test/render.tsx`
- Delete: `apps/panel/test/App.test.tsx`
- Test: `apps/panel/test/guards.test.tsx`

**Interfaces:**
- Consumes: `apiRequest`, `readSession`, `onUnauthorized` (Task 3); `renderRoutes`, `LocationProbe`, fixtures (Task 4).
- Produces:
  - `login(email, password): Promise<LoginResponse>`, `register(input: RegisterInput): Promise<unknown>`, `fetchMe(): Promise<Me>`, `logout(): Promise<void>`, `resendVerification(): Promise<{ message: string }>`, `verifyEmail(token): Promise<{ message: string }>`, `forgotPassword(email): Promise<{ message: string }>`, `resetPassword(token, newPassword): Promise<{ message: string }>`
  - `meQueryKey`, `useMe()`, `useSessionUser(): Me`
  - `RequireSession`, `RedirectIfSession`, `RequireVerified` (componentes de rota com `<Outlet />`)
  - `NeutralScreen`, `LoadFailure({ onRetry })`
  - `installSessionExpiry(queryClient, router): () => void`
  - `routes: RouteObject[]` (com `Placeholder` para as telas das tasks seguintes)
  - teste: `renderInPanel(routes, path, options?)` — envolve em `RequireVerified`

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/guards.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { describe, expect, it } from "vitest";
import { readSession } from "../src/api/session.ts";
import { RedirectIfSession, RequireSession, RequireVerified } from "../src/auth/guards.tsx";
import { installSessionExpiry } from "../src/auth/sessionExpiry.ts";
import { mockApi } from "./api-mock.ts";
import { makeMe, signIn } from "./fixtures.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes: RouteObject[] = [
  { element: <RedirectIfSession />, children: [{ path: "/login", element: <h1>Login</h1> }] },
  {
    element: <RequireSession />,
    children: [
      { path: "/confirme-seu-email", element: <h1>Bloqueio</h1> },
      { element: <RequireVerified />, children: [{ path: "/pedidos", element: <h1>Pedidos</h1> }] },
    ],
  },
  { path: "*", element: <LocationProbe /> },
];

describe("guardas de rota", () => {
  it("sem sessão, o painel manda para o login", async () => {
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByRole("heading", { name: "Login" })).toBeTruthy();
  });

  it("loja não verificada vai para o bloqueio, sem tentar carregar pedidos", async () => {
    signIn();
    const api = mockApi([{ method: "GET", path: "/auth/me", body: makeMe({ emailVerified: false }) }]);
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByRole("heading", { name: "Bloqueio" })).toBeTruthy();
    expect(api.calls.map((call) => call.path)).toEqual(["/auth/me"]);
  });

  it("loja verificada entra", async () => {
    signIn();
    mockApi([{ method: "GET", path: "/auth/me", body: makeMe() }]);
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeTruthy();
  });

  it("com sessão, o login redireciona para o painel", async () => {
    signIn();
    mockApi([{ method: "GET", path: "/auth/me", body: makeMe() }]);
    renderRoutes(routes, "/login");
    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeTruthy();
  });

  it("401 em qualquer resposta limpa a sessão e leva ao login com o aviso", async () => {
    signIn();
    mockApi([{ method: "GET", path: "/auth/me", status: 401, body: { message: "Sessão inválida ou expirada" } }]);
    let uninstall = () => {};
    const { router } = renderRoutes(routes, "/pedidos", {
      beforeRender: ({ router: r, queryClient }) => {
        uninstall = installSessionExpiry(queryClient, r);
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?motivo=sessao-expirada");
    expect(readSession()).toBeNull();
    uninstall();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- guards`
Expected: FAIL — `src/auth/guards.tsx` não existe.

- [ ] **Step 3: Implementar `api/auth.ts`**

```ts
import { apiRequest } from "./client.ts";
import type { LoginResponse, Me, RegisterInput } from "./types.ts";

type Message = { message: string };

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
}

/** Responde 201 SEM token: quem chama faz o login em seguida. */
export function register(input: RegisterInput): Promise<unknown> {
  return apiRequest<unknown>("/auth/register", { method: "POST", body: input, auth: false });
}

export function fetchMe(): Promise<Me> {
  return apiRequest<Me>("/auth/me");
}

export function logout(): Promise<void> {
  return apiRequest<void>("/auth/logout", { method: "POST" });
}

export function resendVerification(): Promise<Message> {
  return apiRequest<Message>("/auth/resend-verification", { method: "POST" });
}

export function verifyEmail(token: string): Promise<Message> {
  return apiRequest<Message>("/auth/verify-email", {
    method: "POST",
    body: { token },
    auth: false,
  });
}

export function forgotPassword(email: string): Promise<Message> {
  return apiRequest<Message>("/auth/forgot-password", {
    method: "POST",
    body: { email },
    auth: false,
  });
}

export function resetPassword(token: string, newPassword: string): Promise<Message> {
  return apiRequest<Message>("/auth/reset-password", {
    method: "POST",
    body: { token, newPassword },
    auth: false,
  });
}
```

- [ ] **Step 4: Implementar `auth/`**

`apps/panel/src/auth/useMe.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "../api/auth.ts";
import type { Me } from "../api/types.ts";

export const meQueryKey = ["me"] as const;

export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: fetchMe, staleTime: 60_000 });
}

/** O usuário da sessão. Só dentro das rotas guardadas por `RequireVerified`. */
export function useSessionUser(): Me {
  const { data } = useMe();
  if (data === undefined) {
    throw new Error("useSessionUser só funciona dentro das rotas guardadas por RequireVerified");
  }
  return data;
}
```

`apps/panel/src/auth/ScreenStates.module.css`:

```css
.neutral {
  min-height: 100vh;
  background: var(--mc-bg);
}

.failure {
  min-height: 100vh;
  display: grid;
  place-content: center;
  gap: 12px;
  justify-items: center;
  color: var(--mc-ink2);
}
```

`apps/panel/src/auth/ScreenStates.tsx`:

```tsx
import { Button } from "@mantine/core";
import classes from "./ScreenStates.module.css";

/** Enquanto a sessão carrega: nada — sem skeleton pulsante (handoff). */
export function NeutralScreen() {
  return <div className={classes.neutral} aria-busy="true" />;
}

export function LoadFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={classes.failure}>
      <p>Não foi possível carregar o painel.</p>
      <Button variant="default" onClick={onRetry}>
        Tentar de novo
      </Button>
    </div>
  );
}
```

`apps/panel/src/auth/guards.tsx`:

```tsx
import { Navigate, Outlet, useLocation } from "react-router";
import { readSession } from "../api/session.ts";
import { LoadFailure, NeutralScreen } from "./ScreenStates.tsx";
import { useMe } from "./useMe.ts";

export function RequireSession() {
  const location = useLocation();
  if (readSession() === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** Login, cadastro e "esqueci" não fazem sentido para quem já entrou. */
export function RedirectIfSession() {
  if (readSession() !== null) return <Navigate to="/pedidos" replace />;
  return <Outlet />;
}

/**
 * Loja que não provou o e-mail recebe 403 em TODA rota do painel. Quem decide
 * é o `emailVerified` do /auth/me — nunca a listagem GET /restaurants, que
 * responde 200 para a loja bloqueada (incoerência documentada da API).
 */
export function RequireVerified() {
  const me = useMe();
  if (me.isPending) return <NeutralScreen />;
  if (me.isError) return <LoadFailure onRetry={() => void me.refetch()} />;
  if (!me.data.emailVerified) return <Navigate to="/confirme-seu-email" replace />;
  return <Outlet />;
}
```

`apps/panel/src/auth/sessionExpiry.ts`:

```ts
import type { QueryClient } from "@tanstack/react-query";
import { onUnauthorized } from "../api/client.ts";

type Navigator = { navigate: (to: string) => unknown };

/**
 * 401 em qualquer resposta autenticada: o cliente HTTP já limpou a sessão;
 * aqui o cache some (dados de uma sessão não vazam para a próxima) e a tela
 * vai para o login com o aviso "Sua sessão expirou".
 */
export function installSessionExpiry(queryClient: QueryClient, router: Navigator): () => void {
  onUnauthorized(() => {
    queryClient.clear();
    void router.navigate("/login?motivo=sessao-expirada");
  });
  return () => onUnauthorized(null);
}
```

- [ ] **Step 5: Árvore de rotas e `App`**

`apps/panel/src/router.tsx`:

```tsx
import { Navigate, type RouteObject } from "react-router";
import { RedirectIfSession, RequireSession, RequireVerified } from "./auth/guards.tsx";

// Provisório: cada tela entra no lugar do seu Placeholder na task dela.
function Placeholder({ title }: { title: string }) {
  return <h1>{title}</h1>;
}

export const routes: RouteObject[] = [
  {
    element: <RedirectIfSession />,
    children: [
      { path: "/login", element: <Placeholder title="Entrar" /> },
      { path: "/cadastro", element: <Placeholder title="Criar a conta da loja" /> },
      { path: "/esqueci-senha", element: <Placeholder title="Esqueci a senha" /> },
    ],
  },
  // Os dois links que a API manda por e-mail (PASSWORD_RESET_URL e
  // EMAIL_VERIFICATION_URL) — funcionam com ou sem sessão.
  { path: "/recuperar-senha", element: <Placeholder title="Definir nova senha" /> },
  { path: "/verificar-email", element: <Placeholder title="Confirmando o e-mail" /> },
  {
    element: <RequireSession />,
    children: [
      { path: "/confirme-seu-email", element: <Placeholder title="Confirme o e-mail da loja" /> },
      {
        element: <RequireVerified />,
        children: [{ path: "/pedidos", element: <Placeholder title="Pedidos" /> }],
      },
    ],
  },
  { path: "*", element: <Navigate to="/pedidos" replace /> },
];
```

`apps/panel/src/App.tsx`:

```tsx
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { installSessionExpiry } from "./auth/sessionExpiry.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { routes } from "./router.tsx";

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);
installSessionExpiry(queryClient, router);

export function App() {
  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
```

Delete `apps/panel/test/App.test.tsx` (o `App` agora sobe o roteador do navegador; as guardas têm teste próprio):

```bash
git rm apps/panel/test/App.test.tsx
```

- [ ] **Step 6: `renderInPanel` no helper de teste**

Acrescente ao fim de `apps/panel/test/render.tsx`:

```tsx
import { RequireVerified } from "../src/auth/guards.tsx";

/** Rotas de dentro do painel: exigem /auth/me mockado e sessão (`signIn`). */
export function renderInPanel(routes: RouteObject[], initialPath: string, options: RenderOptions = {}) {
  return renderRoutes([{ element: <RequireVerified />, children: routes }], initialPath, options);
}
```

(e mova o `import` para junto dos outros no topo do arquivo).

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 8: Commit**

```bash
git add -A apps/panel
git commit -m "feat(panel): ✨ adiciona as rotas e as guardas de sessão e de e-mail"
```

---

### Task 6: Login e cadastro

**Files:**
- Create: `apps/panel/src/ui/Notice.tsx`, `apps/panel/src/ui/Notice.module.css`, `apps/panel/src/features/access/AuthLayout.tsx`, `AuthLayout.module.css`, `access.module.css`, `password.ts`, `LoginPage.tsx`, `RegisterPage.tsx`
- Modify: `apps/panel/src/router.tsx`
- Test: `apps/panel/test/password.test.ts`, `login.test.tsx`, `register.test.tsx`

**Interfaces:**
- Consumes: `login`, `register` (Task 5); `saveSession`, `describeError` (Task 3).
- Produces:
  - `Notice({ tone: "warn" | "accent" | "danger"; title?: string; children })`
  - `AuthLayout({ children, aside? })`
  - `checkPassword(password: string): string | null`
  - `LoginPage`, `RegisterPage`; `validateRegister(form: RegisterForm): string | null`, `toRegisterInput(form: RegisterForm): RegisterInput`

- [ ] **Step 1: Escrever os testes que falham**

`apps/panel/test/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkPassword } from "../src/features/access/password.ts";

describe("checkPassword", () => {
  it("exige 8 caracteres", () => {
    expect(checkPassword("1234567")).toBe("A senha precisa de pelo menos 8 caracteres.");
    expect(checkPassword("12345678")).toBeNull();
  });

  it("conta BYTES no teto de 72, como o bcrypt da API", () => {
    // 40 "ç" são 40 caracteres e 80 bytes
    expect(checkPassword("ç".repeat(40))).toBe(
      "A senha passou do limite: use até 72 bytes (letras acentuadas contam em dobro).",
    );
    expect(checkPassword("a".repeat(72))).toBeNull();
  });
});
```

`apps/panel/test/login.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readSession } from "../src/api/session.ts";
import { LoginPage } from "../src/features/access/LoginPage.tsx";
import { mockApi } from "./api-mock.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  { path: "/login", element: <LoginPage /> },
  { path: "/pedidos", element: <LocationProbe /> },
];

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("LoginPage", () => {
  it("entra, guarda a sessão e vai para os pedidos", async () => {
    const api = mockApi([
      {
        method: "POST",
        path: "/auth/login",
        body: { token: "tok", expiresAt: "2099-01-01T00:00:00.000Z" },
      },
    ]);
    renderRoutes(routes, "/login");
    fill(" dono@tokyoramen.com.br ", "senha-de-exemplo-123");
    expect((await screen.findByTestId("location")).textContent).toBe("/pedidos");
    expect(api.calls[0].body).toEqual({
      email: "dono@tokyoramen.com.br",
      password: "senha-de-exemplo-123",
    });
    expect(readSession()?.token).toBe("tok");
  });

  it("login errado mostra a mensagem da API", async () => {
    mockApi([
      { method: "POST", path: "/auth/login", status: 401, body: { message: "E-mail ou senha inválidos" } },
    ]);
    renderRoutes(routes, "/login");
    fill("a@b.com", "12345678");
    expect(await screen.findByText("E-mail ou senha inválidos")).toBeTruthy();
  });

  it("429 pede para aguardar", async () => {
    mockApi([{ method: "POST", path: "/auth/login", status: 429, body: { message: "Rate limit exceeded" } }]);
    renderRoutes(routes, "/login");
    fill("a@b.com", "12345678");
    expect(
      await screen.findByText("Muitas tentativas seguidas. Aguarde um instante e tente de novo."),
    ).toBeTruthy();
  });

  it("não envia com campo vazio", () => {
    const api = mockApi([]);
    renderRoutes(routes, "/login");
    fill("", "");
    expect(screen.getByText("Preencha e-mail e senha.")).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it("explica a sessão expirada", () => {
    mockApi([]);
    renderRoutes(routes, "/login?motivo=sessao-expirada");
    expect(screen.getByText("Sua sessão expirou")).toBeTruthy();
    expect(
      screen.getByText(
        "Entre de novo para continuar. Nada do que estava na tela foi enviado; os pedidos seguem registrados no servidor.",
      ),
    ).toBeTruthy();
  });
});
```

`apps/panel/test/register.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegisterPage } from "../src/features/access/RegisterPage.tsx";
import { mockApi } from "./api-mock.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  { path: "/cadastro", element: <RegisterPage /> },
  { path: "*", element: <LocationProbe /> },
];

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillAll(password = "senha-forte-1") {
  type("Nome da loja", "Trattoria Bella");
  type("Tipo de cozinha", "Italiana");
  type("Rua", "Rua Aspicuelta");
  type("Número", "120");
  type("Bairro", "Vila Madalena");
  type("Cidade", "São Paulo");
  type("UF", "sp");
  type("CEP", "05433-010");
  type("Seu nome", "Cláudia Mendes");
  type("E-mail", "gerencia@trattoriabella.com.br");
  type("Senha", password);
}

describe("RegisterPage", () => {
  it("entrega nasce desligada; retirada e salão ligados", () => {
    mockApi([]);
    renderRoutes(routes, "/cadastro");
    expect((screen.getByRole("switch", { name: "Entrega" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("switch", { name: "Retirada no balcão" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("switch", { name: "Salão" }) as HTMLInputElement).checked).toBe(true);
  });

  it("cria a loja, entra em seguida e cai no bloqueio de e-mail", async () => {
    const api = mockApi([
      { method: "POST", path: "/auth/register", status: 201, body: {} },
      { method: "POST", path: "/auth/login", body: { token: "tok", expiresAt: "2099-01-01T00:00:00.000Z" } },
    ]);
    renderRoutes(routes, "/cadastro");
    fillAll();
    fireEvent.click(screen.getByRole("button", { name: "Criar loja e continuar" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/confirme-seu-email");
    expect(api.calls[0].body).toEqual({
      restaurant: {
        name: "Trattoria Bella",
        cuisineType: "Italiana",
        address: {
          street: "Rua Aspicuelta",
          number: "120",
          neighborhood: "Vila Madalena",
          city: "São Paulo",
          state: "SP",
          zipCode: "05433-010",
        },
        isDelivery: false,
        isTakeaway: true,
        isQrcode: true,
      },
      user: { name: "Cláudia Mendes", email: "gerencia@trattoriabella.com.br", password: "senha-forte-1" },
    });
    expect(api.calls[1]).toMatchObject({
      path: "/auth/login",
      body: { email: "gerencia@trattoriabella.com.br", password: "senha-forte-1" },
    });
  });

  it("e-mail em uso mostra a mensagem da API", async () => {
    mockApi([
      {
        method: "POST",
        path: "/auth/register",
        status: 409,
        body: { message: 'O e-mail "gerencia@trattoriabella.com.br" já está em uso' },
      },
    ]);
    renderRoutes(routes, "/cadastro");
    fillAll();
    fireEvent.click(screen.getByRole("button", { name: "Criar loja e continuar" }));
    expect(await screen.findByText('O e-mail "gerencia@trattoriabella.com.br" já está em uso')).toBeTruthy();
  });

  it("senha curta não chega à API", () => {
    const api = mockApi([]);
    renderRoutes(routes, "/cadastro");
    fillAll("curta");
    fireEvent.click(screen.getByRole("button", { name: "Criar loja e continuar" }));
    expect(screen.getByText("A senha precisa de pelo menos 8 caracteres.")).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it("conta criada mas login barrado vai para o login com aviso", async () => {
    mockApi([
      { method: "POST", path: "/auth/register", status: 201, body: {} },
      { method: "POST", path: "/auth/login", status: 429, body: { message: "Rate limit exceeded" } },
    ]);
    renderRoutes(routes, "/cadastro");
    fillAll();
    fireEvent.click(screen.getByRole("button", { name: "Criar loja e continuar" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/login?motivo=conta-criada");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- password login register`
Expected: FAIL — módulos de `features/access/` não existem.

- [ ] **Step 3: `Notice` (aviso reutilizável)**

`apps/panel/src/ui/Notice.module.css`:

```css
.notice {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid;
  border-radius: 6px;
  font-size: 13.5px;
}

.title {
  font-weight: 700;
}

.body {
  color: var(--mc-ink2);
  max-width: 78ch;
}

.warn {
  background: var(--mc-warn-soft);
  border-color: var(--mc-warn-line);
  border-left: 3px solid var(--mc-warn-strong);
  color: var(--mc-warn);
}

.accent {
  background: var(--mc-accent-soft);
  border-color: var(--mc-accent-line);
  color: var(--mc-accent-hi);
}

.danger {
  background: var(--mc-danger-soft);
  border-color: var(--mc-danger-line);
  color: var(--mc-danger);
}
```

`apps/panel/src/ui/Notice.tsx`:

```tsx
import type { ReactNode } from "react";
import classes from "./Notice.module.css";

export function Notice({
  tone,
  title,
  children,
}: {
  tone: "warn" | "accent" | "danger";
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div role="status" className={`${classes.notice} ${classes[tone]}`}>
      {title && <strong className={classes.title}>{title}</strong>}
      {children !== undefined && <div className={classes.body}>{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Layout e estilos de acesso**

`apps/panel/src/features/access/AuthLayout.module.css`:

```css
.page {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-height: 100vh;
  background: var(--mc-surface);
}

.main {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
}

.column {
  width: 100%;
  max-width: 352px;
}

.brand {
  margin: 0 0 20px;
  font-size: 13px;
  font-weight: 700;
  color: var(--mc-accent-hi);
}

.aside {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding: 48px 40px;
  background: var(--mc-surface2);
  border-left: 1px solid var(--mc-line);
  color: var(--mc-ink2);
}

@media (max-width: 860px) {
  .page {
    grid-template-columns: minmax(0, 1fr);
  }

  .aside {
    border-left: 0;
    border-top: 1px solid var(--mc-line);
  }
}
```

`apps/panel/src/features/access/AuthLayout.tsx`:

```tsx
import type { ReactNode } from "react";
import classes from "./AuthLayout.module.css";

export function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className={classes.page}>
      <main className={classes.main}>
        <div className={classes.column}>
          <p className={classes.brand}>Painel da loja</p>
          {children}
        </div>
      </main>
      {aside !== undefined && <aside className={classes.aside}>{aside}</aside>}
    </div>
  );
}
```

`apps/panel/src/features/access/access.module.css`:

```css
.title {
  margin: 0 0 6px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--mc-ink);
}

.subtitle {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--mc-ink2);
}

.eyebrow {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--mc-ink3);
}

.eyebrowWarn {
  composes: eyebrow;
  color: var(--mc-warn);
}

.form {
  display: grid;
  gap: 14px;
  margin-top: 16px;
}

.links {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  font-size: 13.5px;
  font-weight: 600;
}

.links a,
.link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--mc-accent);
  font: inherit;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.error {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-danger);
}

.success {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-accent-hi);
}

.asideLead {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--mc-ink);
}

.asideBody {
  margin: 0;
  font-size: 13.5px;
  max-width: 46ch;
}

.cardPage {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: 40px 16px;
  background: var(--mc-bg);
}

.card {
  width: 100%;
  max-width: 620px;
  align-self: start;
  padding: 28px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.section {
  display: grid;
  gap: 12px;
  padding: 20px 0;
  border-top: 1px solid var(--mc-line);
}

.sectionTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.grid2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.grid3 {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 0.7fr) minmax(0, 1fr);
  gap: 12px;
}

.footnote {
  margin: 16px 0 0;
  font-size: 13.5px;
  color: var(--mc-ink2);
}
```

- [ ] **Step 5: Regra de senha**

`apps/panel/src/features/access/password.ts`:

```ts
const encoder = new TextEncoder();

/**
 * Mesmas regras da API: mínimo de 8 caracteres e teto de 72 BYTES — o bcrypt
 * ignora tudo depois do byte 72, em silêncio (S20). A API recusa com 400; a
 * tela avisa antes, com texto que a pessoa entende.
 */
export function checkPassword(password: string): string | null {
  if (password.length < 8) return "A senha precisa de pelo menos 8 caracteres.";
  if (encoder.encode(password).length > 72) {
    return "A senha passou do limite: use até 72 bytes (letras acentuadas contam em dobro).";
  }
  return null;
}
```

- [ ] **Step 6: `LoginPage`**

`apps/panel/src/features/access/LoginPage.tsx`:

```tsx
import { Button, PasswordInput, TextInput } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { login } from "../../api/auth.ts";
import { describeError } from "../../api/client.ts";
import { saveSession } from "../../api/session.ts";
import { Notice } from "../../ui/Notice.tsx";
import classes from "./access.module.css";
import { AuthLayout } from "./AuthLayout.tsx";

// `?motivo=` explica por que a pessoa caiu no login.
const NOTICES: Record<string, { tone: "warn" | "accent"; title: string; body: string }> = {
  "sessao-expirada": {
    tone: "warn",
    title: "Sua sessão expirou",
    body: "Entre de novo para continuar. Nada do que estava na tela foi enviado; os pedidos seguem registrados no servidor.",
  },
  "email-confirmado": { tone: "accent", title: "E-mail confirmado", body: "Entre para abrir o painel." },
  "senha-trocada": { tone: "accent", title: "Senha trocada", body: "Entre com a nova senha." },
  "conta-criada": {
    tone: "accent",
    title: "Loja criada",
    body: "Entre com o e-mail e a senha que você cadastrou.",
  },
};

function LoginAside() {
  return (
    <>
      <span className={classes.eyebrow}>Antes de abrir</span>
      <p className={classes.asideLead}>
        Se o e-mail da loja ainda não foi confirmado, o painel inteiro fica bloqueado.
      </p>
      <p className={classes.asideBody}>
        Depois de entrar, o app checa a verificação antes de tentar carregar pedidos — e leva direto
        para a tela de confirmação, sem erro genérico.
      </p>
    </>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => login(email.trim(), password),
    onSuccess: (session) => {
      saveSession(session);
      // nada de uma sessão anterior pode aparecer na nova
      queryClient.clear();
      navigate("/pedidos", { replace: true });
    },
  });

  const notice = NOTICES[params.get("motivo") ?? ""];

  return (
    <AuthLayout aside={<LoginAside />}>
      <h1 className={classes.title}>Entrar</h1>
      <p className={classes.subtitle}>Acesso do dono e da equipe do restaurante.</p>
      {notice && (
        <Notice tone={notice.tone} title={notice.title}>
          {notice.body}
        </Notice>
      )}
      <form
        className={classes.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim() === "" || password === "") {
            setLocalError("Preencha e-mail e senha.");
            return;
          }
          setLocalError(null);
          mutation.mutate();
        }}
      >
        <TextInput
          label="E-mail"
          type="email"
          size="md"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <PasswordInput
          label="Senha"
          size="md"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        {localError && (
          <p role="alert" className={classes.error}>
            {localError}
          </p>
        )}
        {mutation.isError && (
          <p role="alert" className={classes.error}>
            {describeError(mutation.error)}
          </p>
        )}
        <Button type="submit" fullWidth h={46} fz={15} loading={mutation.isPending}>
          Entrar
        </Button>
      </form>
      <div className={classes.links}>
        <Link to="/esqueci-senha">Esqueci a senha</Link>
        <Link to="/cadastro">Criar conta da loja</Link>
      </div>
    </AuthLayout>
  );
}
```

- [ ] **Step 7: `RegisterPage`**

`apps/panel/src/features/access/RegisterPage.tsx`:

```tsx
import { Button, NativeSelect, PasswordInput, Switch, TextInput } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { login, register } from "../../api/auth.ts";
import { describeError } from "../../api/client.ts";
import { saveSession } from "../../api/session.ts";
import type { RegisterInput } from "../../api/types.ts";
import classes from "./access.module.css";
import { checkPassword } from "./password.ts";

const CUISINES = [
  "Pizzaria",
  "Italiana",
  "Hamburgueria",
  "Japonesa",
  "Brasileira",
  "Lanchonete",
  "Árabe",
  "Doceria",
  "Outra",
];

export type RegisterForm = {
  restaurantName: string;
  cuisineType: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  isTakeaway: boolean;
  isQrcode: boolean;
  isDelivery: boolean;
  userName: string;
  email: string;
  password: string;
};

// Entrega nasce DESLIGADA: a loja nova tem taxa fixa de R$ 0, e ligar entrega
// aqui seria entregar de graça para a cidade inteira. Liga-se na tela de
// Entrega, já com o frete configurado (spec, seção Acesso).
const INITIAL: RegisterForm = {
  restaurantName: "",
  cuisineType: "",
  street: "",
  number: "",
  neighborhood: "",
  city: "",
  state: "",
  zipCode: "",
  isTakeaway: true,
  isQrcode: true,
  isDelivery: false,
  userName: "",
  email: "",
  password: "",
};

const REQUIRED: [keyof RegisterForm, string][] = [
  ["restaurantName", "o nome da loja"],
  ["cuisineType", "o tipo de cozinha"],
  ["street", "a rua"],
  ["number", "o número"],
  ["neighborhood", "o bairro"],
  ["city", "a cidade"],
  ["state", "a UF"],
  ["zipCode", "o CEP"],
  ["userName", "seu nome"],
  ["email", "o e-mail"],
];

export function validateRegister(form: RegisterForm): string | null {
  for (const [field, label] of REQUIRED) {
    if (String(form[field]).trim() === "") return `Preencha ${label}.`;
  }
  const passwordProblem = checkPassword(form.password);
  if (passwordProblem) return passwordProblem;
  if (!form.isTakeaway && !form.isQrcode && !form.isDelivery) {
    return "Ligue ao menos uma modalidade — sem nenhuma, a loja não recebe pedido.";
  }
  return null;
}

export function toRegisterInput(form: RegisterForm): RegisterInput {
  return {
    restaurant: {
      name: form.restaurantName.trim(),
      cuisineType: form.cuisineType,
      address: {
        street: form.street.trim(),
        number: form.number.trim(),
        neighborhood: form.neighborhood.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        zipCode: form.zipCode.trim(),
      },
      isDelivery: form.isDelivery,
      isTakeaway: form.isTakeaway,
      isQrcode: form.isQrcode,
    },
    user: { name: form.userName.trim(), email: form.email.trim(), password: form.password },
  };
}

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RegisterForm>(INITIAL);
  const [localError, setLocalError] = useState<string | null>(null);

  const set = <K extends keyof RegisterForm>(field: K, value: RegisterForm[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  const mutation = useMutation({
    mutationFn: async (input: RegisterInput) => {
      // O register responde 201 SEM token; o login em seguida é o que abre
      // a sessão. Se ele falhar, a loja já existe: manda para o login.
      await register(input);
      try {
        return await login(input.user.email, input.user.password);
      } catch {
        return null;
      }
    },
    onSuccess: (session) => {
      if (session === null) {
        navigate("/login?motivo=conta-criada", { replace: true });
        return;
      }
      saveSession(session);
      queryClient.clear();
      navigate("/confirme-seu-email", { replace: true });
    },
  });

  type TextField = Exclude<keyof RegisterForm, "isTakeaway" | "isQrcode" | "isDelivery">;
  const text = (field: TextField) => ({
    value: form[field],
    onChange: (event: { currentTarget: { value: string } }) => set(field, event.currentTarget.value),
  });

  return (
    <div className={classes.cardPage}>
      <div className={classes.card}>
        <Link to="/login" className={classes.link}>
          Voltar
        </Link>
        <p className={classes.eyebrow}>Painel da loja</p>
        <h1 className={classes.title}>Criar a conta da loja</h1>
        <p className={classes.subtitle}>
          O restaurante e o primeiro acesso são criados juntos. Quem criar a conta fica como dono.
        </p>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const problem = validateRegister(form);
            setLocalError(problem);
            if (problem === null) mutation.mutate(toRegisterInput(form));
          }}
        >
          <section className={classes.section}>
            <h2 className={classes.sectionTitle}>O restaurante</h2>
            <div className={classes.grid2}>
              <TextInput label="Nome da loja" placeholder="Trattoria Bella" {...text("restaurantName")} />
              <NativeSelect
                label="Tipo de cozinha"
                data={[{ value: "", label: "Escolha" }, ...CUISINES]}
                {...text("cuisineType")}
              />
            </div>
          </section>

          <section className={classes.section}>
            <h2 className={classes.sectionTitle}>Endereço e modalidades</h2>
            <TextInput label="Rua" {...text("street")} />
            <div className={classes.grid2}>
              <TextInput label="Número" {...text("number")} />
              <TextInput label="Bairro" {...text("neighborhood")} />
            </div>
            <div className={classes.grid3}>
              <TextInput label="Cidade" {...text("city")} />
              <TextInput label="UF" maxLength={2} {...text("state")} />
              <TextInput label="CEP" {...text("zipCode")} />
            </div>
            <Switch
              label="Retirada no balcão"
              description="O cliente busca no endereço da loja"
              checked={form.isTakeaway}
              onChange={(event) => set("isTakeaway", event.currentTarget.checked)}
            />
            <Switch
              label="Salão"
              description="Pedido pela mesa, com QR code"
              checked={form.isQrcode}
              onChange={(event) => set("isQrcode", event.currentTarget.checked)}
            />
            <Switch
              label="Entrega"
              description="Ligue depois, na tela de Entrega, junto com o frete. Ligada agora, a entrega sairia de graça."
              checked={form.isDelivery}
              onChange={(event) => set("isDelivery", event.currentTarget.checked)}
            />
          </section>

          <section className={classes.section}>
            <h2 className={classes.sectionTitle}>Seu acesso</h2>
            <TextInput label="Seu nome" placeholder="Cláudia Mendes" {...text("userName")} />
            <TextInput
              label="E-mail"
              type="email"
              placeholder="gerencia@sualoja.com.br"
              description="É para cá que vai o link de confirmação, e não há como trocar depois pelo painel. Confira antes de criar."
              {...text("email")}
            />
            <PasswordInput label="Senha" placeholder="mínimo 8 caracteres" {...text("password")} />
          </section>

          {localError && (
            <p role="alert" className={classes.error}>
              {localError}
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className={classes.error}>
              {describeError(mutation.error)}
            </p>
          )}
          <Button type="submit" fullWidth h={46} fz={15} mt={12} loading={mutation.isPending}>
            Criar loja e continuar
          </Button>
        </form>
        <p className={classes.footnote}>
          Já tem conta?{" "}
          <Link to="/login" className={classes.link}>
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Trocar os placeholders no roteador**

Em `apps/panel/src/router.tsx`, importe as páginas e troque as duas rotas:

```tsx
import { LoginPage } from "./features/access/LoginPage.tsx";
import { RegisterPage } from "./features/access/RegisterPage.tsx";
```

```tsx
      { path: "/login", element: <LoginPage /> },
      { path: "/cadastro", element: <RegisterPage /> },
```

- [ ] **Step 9: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ adiciona login e cadastro da loja"
```

---

### Task 7: Esqueci a senha, nova senha e link de verificação

**Files:**
- Create: `apps/panel/src/features/access/ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`, `VerifyEmailLinkPage.tsx`
- Modify: `apps/panel/src/router.tsx`
- Test: `apps/panel/test/password-recovery.test.tsx`, `verify-link.test.tsx`

**Interfaces:**
- Consumes: `forgotPassword`, `resetPassword`, `verifyEmail` (Task 5); `meQueryKey` (Task 5); `checkPassword`, `AuthLayout`, `access.module.css`, `Notice` (Task 6).
- Produces: `ForgotPasswordPage`, `ResetPasswordPage`, `VerifyEmailLinkPage`.

- [ ] **Step 1: Escrever os testes que falham**

`apps/panel/test/password-recovery.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ForgotPasswordPage } from "../src/features/access/ForgotPasswordPage.tsx";
import { ResetPasswordPage } from "../src/features/access/ResetPasswordPage.tsx";
import { mockApi } from "./api-mock.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  { path: "/esqueci-senha", element: <ForgotPasswordPage /> },
  { path: "/recuperar-senha", element: <ResetPasswordPage /> },
  { path: "*", element: <LocationProbe /> },
];

const EXPIRED =
  "Link expirado ou já usado: peça outro na etapa 1. Cada link vale uma vez.";

describe("recuperação de senha", () => {
  it("responde sempre a mesma coisa, exista a conta ou não", async () => {
    const api = mockApi([{ method: "POST", path: "/auth/forgot-password", status: 202, body: { message: "ok" } }]);
    renderRoutes(routes, "/esqueci-senha");
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "qualquer@coisa.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar link" }));
    expect(
      await screen.findByText(
        "Se existir uma conta com esse e-mail, o link de redefinição chega em alguns minutos. Confira o spam.",
      ),
    ).toBeTruthy();
    expect(api.calls[0].body).toEqual({ email: "qualquer@coisa.com" });
  });

  it("senhas diferentes não chegam à API", () => {
    const api = mockApi([]);
    renderRoutes(routes, "/recuperar-senha?token=abc");
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "senha-nova-1" } });
    fireEvent.change(screen.getByLabelText("Repita a nova senha"), { target: { value: "senha-nova-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(screen.getByText("As duas senhas não conferem.")).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it("troca e manda para o login (a API não devolve sessão)", async () => {
    const api = mockApi([{ method: "POST", path: "/auth/reset-password", body: { message: "ok" } }]);
    renderRoutes(routes, "/recuperar-senha?token=abc");
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "senha-nova-1" } });
    fireEvent.change(screen.getByLabelText("Repita a nova senha"), { target: { value: "senha-nova-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/login?motivo=senha-trocada");
    expect(api.calls[0].body).toEqual({ token: "abc", newPassword: "senha-nova-1" });
  });

  it("link vencido mostra a faixa âmbar", async () => {
    mockApi([
      {
        method: "POST",
        path: "/auth/reset-password",
        status: 400,
        body: { message: "Link de recuperação inválido ou expirado" },
      },
    ]);
    renderRoutes(routes, "/recuperar-senha?token=abc");
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "senha-nova-1" } });
    fireEvent.change(screen.getByLabelText("Repita a nova senha"), { target: { value: "senha-nova-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
  });

  it("sem token na URL, avisa de cara", () => {
    mockApi([]);
    renderRoutes(routes, "/recuperar-senha");
    expect(screen.getByText(EXPIRED)).toBeTruthy();
  });
});
```

`apps/panel/test/verify-link.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerifyEmailLinkPage } from "../src/features/access/VerifyEmailLinkPage.tsx";
import { mockApi } from "./api-mock.ts";
import { signIn } from "./fixtures.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  { path: "/verificar-email", element: <VerifyEmailLinkPage /> },
  { path: "*", element: <LocationProbe /> },
];

describe("VerifyEmailLinkPage", () => {
  it("com sessão, confirma e abre o painel", async () => {
    signIn();
    const api = mockApi([{ method: "POST", path: "/auth/verify-email", body: { message: "ok" } }]);
    renderRoutes(routes, "/verificar-email?token=tok-1");
    expect((await screen.findByTestId("location")).textContent).toBe("/pedidos");
    expect(api.calls[0].body).toEqual({ token: "tok-1" });
    expect(api.calls[0].headers.Authorization).toBeUndefined();
  });

  it("sem sessão, confirma e manda para o login com aviso", async () => {
    mockApi([{ method: "POST", path: "/auth/verify-email", body: { message: "ok" } }]);
    renderRoutes(routes, "/verificar-email?token=tok-1");
    expect((await screen.findByTestId("location")).textContent).toBe("/login?motivo=email-confirmado");
  });

  it("link usado explica e oferece um novo a quem tem sessão", async () => {
    signIn();
    mockApi([{ method: "POST", path: "/auth/verify-email", status: 400, body: { message: "inválido" } }]);
    renderRoutes(routes, "/verificar-email?token=tok-1");
    expect(await screen.findByText("Este link não vale mais")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mandar um link novo" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- password-recovery verify-link`
Expected: FAIL — páginas não existem.

- [ ] **Step 3: `ForgotPasswordPage`**

```tsx
import { Button, TextInput } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { forgotPassword } from "../../api/auth.ts";
import { ApiError, describeError } from "../../api/client.ts";
import { Notice } from "../../ui/Notice.tsx";
import classes from "./access.module.css";
import { AuthLayout } from "./AuthLayout.tsx";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const mutation = useMutation({ mutationFn: () => forgotPassword(email.trim()) });

  return (
    <AuthLayout>
      <span className={classes.eyebrow}>Etapa 1</span>
      <h1 className={classes.title}>Esqueci a senha</h1>
      <p className={classes.subtitle}>
        Informe o e-mail da conta. A resposta é sempre a mesma, exista a conta ou não — é assim de
        propósito, para não revelar quem tem cadastro.
      </p>
      <form
        className={classes.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim() !== "") mutation.mutate();
        }}
      >
        <TextInput
          label="E-mail"
          type="email"
          size="md"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        {mutation.isSuccess && (
          <Notice tone="accent">
            Se existir uma conta com esse e-mail, o link de redefinição chega em alguns minutos.
            Confira o spam.
          </Notice>
        )}
        {mutation.isError && (
          <p role="alert" className={classes.error}>
            {/* 400 aqui só pode ser formato de e-mail: a API responde 202
                para qualquer endereço bem formado. */}
            {mutation.error instanceof ApiError && mutation.error.status === 400
              ? "Confira o e-mail digitado."
              : describeError(mutation.error)}
          </p>
        )}
        <Button type="submit" fullWidth h={44} fz={15} loading={mutation.isPending}>
          Enviar link
        </Button>
      </form>
      <div className={classes.links}>
        <Link to="/login">Voltar para o login</Link>
      </div>
    </AuthLayout>
  );
}
```

- [ ] **Step 4: `ResetPasswordPage`**

```tsx
import { Button, PasswordInput } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { resetPassword } from "../../api/auth.ts";
import { ApiError, describeError } from "../../api/client.ts";
import { Notice } from "../../ui/Notice.tsx";
import classes from "./access.module.css";
import { AuthLayout } from "./AuthLayout.tsx";
import { checkPassword } from "./password.ts";

const EXPIRED = "Link expirado ou já usado: peça outro na etapa 1. Cada link vale uma vez.";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => resetPassword(token, password),
    // A API não devolve sessão no reset, de propósito (S30), e a página só
    // conhece o token: quem recuperou entra pelo login. Por isso o CTA é
    // "Salvar nova senha", e não o "Salvar e entrar" do handoff.
    onSuccess: () => navigate("/login?motivo=senha-trocada", { replace: true }),
  });

  // Com as regras de senha conferidas na tela, 400 do servidor só pode ser o
  // link: vencido, já usado ou inexistente.
  const linkDead =
    token === "" || (mutation.error instanceof ApiError && mutation.error.status === 400);

  return (
    <AuthLayout>
      <span className={classes.eyebrow}>Etapa 2 — pelo link do e-mail</span>
      <h1 className={classes.title}>Definir nova senha</h1>
      <p className={classes.subtitle}>
        O link carrega o código de uso único. Abrindo daqui, a tela já sabe de quem é a conta.
      </p>
      {linkDead && <Notice tone="warn">{EXPIRED}</Notice>}
      <form
        className={classes.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const problem =
            checkPassword(password) ?? (password !== repeat ? "As duas senhas não conferem." : null);
          setLocalError(problem);
          if (problem === null && token !== "") mutation.mutate();
        }}
      >
        <PasswordInput
          label="Nova senha"
          size="md"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <PasswordInput
          label="Repita a nova senha"
          size="md"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.currentTarget.value)}
        />
        {localError && (
          <p role="alert" className={classes.error}>
            {localError}
          </p>
        )}
        {mutation.isError && !linkDead && (
          <p role="alert" className={classes.error}>
            {describeError(mutation.error)}
          </p>
        )}
        <Button type="submit" fullWidth h={44} fz={15} loading={mutation.isPending}>
          Salvar nova senha
        </Button>
      </form>
      <div className={classes.links}>
        <Link to="/esqueci-senha">Pedir outro link</Link>
      </div>
    </AuthLayout>
  );
}
```

- [ ] **Step 5: `VerifyEmailLinkPage`**

```tsx
import { Button } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useSearchParams } from "react-router";
import { verifyEmail } from "../../api/auth.ts";
import { ApiError, describeError } from "../../api/client.ts";
import { readSession } from "../../api/session.ts";
import { meQueryKey } from "../../auth/useMe.ts";
import classes from "./access.module.css";
import { AuthLayout } from "./AuthLayout.tsx";

export function VerifyEmailLinkPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const queryClient = useQueryClient();
  const hasSession = readSession() !== null;

  // useQuery (e não useMutation) porque deduplica: no StrictMode o efeito
  // montaria duas vezes, e o segundo POST encontraria o token já usado.
  const verification = useQuery({
    queryKey: ["verify-email", token],
    queryFn: async () => {
      const result = await verifyEmail(token);
      // O /auth/me em cache ainda diz "não verificado"; sem apagá-lo, a
      // guarda mandaria de volta para o bloqueio.
      queryClient.removeQueries({ queryKey: meQueryKey });
      return result;
    },
    enabled: token !== "",
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (verification.isSuccess) {
    return <Navigate to={hasSession ? "/pedidos" : "/login?motivo=email-confirmado"} replace />;
  }

  const failed = token === "" || verification.isError;
  const rateLimited = verification.error instanceof ApiError && verification.error.status === 429;

  return (
    <AuthLayout>
      {!failed ? (
        <h1 className={classes.title}>Confirmando o e-mail…</h1>
      ) : rateLimited ? (
        <>
          <h1 className={classes.title}>Aguarde um instante</h1>
          <p className={classes.subtitle}>{describeError(verification.error)}</p>
        </>
      ) : (
        <>
          <h1 className={classes.title}>Este link não vale mais</h1>
          <p className={classes.subtitle}>
            O link de confirmação expirou ou já foi usado. Cada link vale uma vez, por 24 horas.
          </p>
          {hasSession ? (
            <Button component={Link} to="/confirme-seu-email" h={44}>
              Mandar um link novo
            </Button>
          ) : (
            <Button component={Link} to="/login" h={44}>
              Entrar
            </Button>
          )}
        </>
      )}
    </AuthLayout>
  );
}
```

- [ ] **Step 6: Rotas**

Em `apps/panel/src/router.tsx`, importe e troque os três placeholders:

```tsx
import { ForgotPasswordPage } from "./features/access/ForgotPasswordPage.tsx";
import { ResetPasswordPage } from "./features/access/ResetPasswordPage.tsx";
import { VerifyEmailLinkPage } from "./features/access/VerifyEmailLinkPage.tsx";
```

```tsx
      { path: "/esqueci-senha", element: <ForgotPasswordPage /> },
```

```tsx
  { path: "/recuperar-senha", element: <ResetPasswordPage /> },
  { path: "/verificar-email", element: <VerifyEmailLinkPage /> },
```

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ adiciona recuperação de senha e o link de verificação"
```

---

### Task 8: Tela de bloqueio "Confirme o e-mail da loja"

**Files:**
- Create: `apps/panel/src/auth/useLogout.ts`, `apps/panel/src/features/access/EmailBlockedPage.tsx`, `EmailBlockedPage.module.css`
- Modify: `apps/panel/src/router.tsx`
- Test: `apps/panel/test/email-blocked.test.tsx`

**Interfaces:**
- Consumes: `useMe` (Task 5), `resendVerification`, `logout` (Task 5), `useCountdown`, `formatCountdown` (Task 2), `ApiError`, `describeError`, `clearSession` (Task 3), `Notice` (Task 6).
- Produces: `useLogout()` (mutation: chama a API, limpa sessão e cache, vai para `/login` — mesmo se a API falhar), `EmailBlockedPage`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/email-blocked.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readSession } from "../src/api/session.ts";
import { EmailBlockedPage } from "../src/features/access/EmailBlockedPage.tsx";
import { mockApi } from "./api-mock.ts";
import { makeMe, signIn } from "./fixtures.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  { path: "/confirme-seu-email", element: <EmailBlockedPage /> },
  { path: "*", element: <LocationProbe /> },
];

const me = { method: "GET" as const, path: "/auth/me", body: makeMe({ emailVerified: false }) };

describe("EmailBlockedPage", () => {
  it("mostra o endereço que recebeu o link", async () => {
    signIn();
    mockApi([me]);
    renderRoutes(routes, "/confirme-seu-email");
    expect(await screen.findByText("gerencia@trattoriabella.com.br")).toBeTruthy();
    expect(screen.getByText("Painel bloqueado")).toBeTruthy();
  });

  it("reenvio aceito mostra a mensagem neutra", async () => {
    signIn();
    mockApi([me, { method: "POST", path: "/auth/resend-verification", status: 202, body: { message: "ok" } }]);
    renderRoutes(routes, "/confirme-seu-email");
    fireEvent.click(await screen.findByRole("button", { name: "Não recebi, reenviar" }));
    expect(await screen.findByText("Link reenviado. Confira também a caixa de spam.")).toBeTruthy();
  });

  it("429 trava o botão com a contagem do Retry-After", async () => {
    signIn();
    mockApi([
      me,
      {
        method: "POST",
        path: "/auth/resend-verification",
        status: 429,
        body: { message: "Rate limit exceeded" },
        headers: { "retry-after": "38" },
      },
    ]);
    renderRoutes(routes, "/confirme-seu-email");
    fireEvent.click(await screen.findByRole("button", { name: "Não recebi, reenviar" }));
    const locked = await screen.findByRole("button", { name: "Reenviar em 0:38" });
    expect((locked as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(
        "Aguarde um instante: são no máximo 3 reenvios por minuto. O último link continua valendo.",
      ),
    ).toBeTruthy();
  });

  it("loja já verificada vai para os pedidos", async () => {
    signIn();
    mockApi([{ method: "GET", path: "/auth/me", body: makeMe() }]);
    renderRoutes(routes, "/confirme-seu-email");
    expect((await screen.findByTestId("location")).textContent).toBe("/pedidos");
  });

  it("sair da conta encerra a sessão", async () => {
    signIn();
    const api = mockApi([me, { method: "POST", path: "/auth/logout", status: 204 }]);
    renderRoutes(routes, "/confirme-seu-email");
    fireEvent.click(await screen.findByRole("button", { name: "Sair da conta" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/login");
    expect(readSession()).toBeNull();
    expect(api.calls.some((call) => call.path === "/auth/logout")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- email-blocked`
Expected: FAIL — página não existe.

- [ ] **Step 3: `useLogout`**

`apps/panel/src/auth/useLogout.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { logout } from "../api/auth.ts";
import { clearSession } from "../api/session.ts";

/** Sair: avisa a API (que revoga a sessão) e limpa tudo local, dê a API certo ou não. */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      try {
        await logout();
      } catch {
        // sem rede ou sessão já morta: a sessão local morre de qualquer jeito
      }
    },
    onSettled: () => {
      clearSession();
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });
}
```

- [ ] **Step 4: `EmailBlockedPage`**

`apps/panel/src/features/access/EmailBlockedPage.module.css`:

```css
.page {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: 56px 16px;
  background: var(--mc-bg);
}

.column {
  width: 100%;
  max-width: 560px;
  display: grid;
  gap: 16px;
  align-content: start;
}

.title {
  margin: 0;
  font-size: 27px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.lead {
  margin: 0;
  color: var(--mc-ink2);
}

.card {
  display: grid;
  gap: 10px;
  padding: 18px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mc-ink3);
}

.email {
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.wrong {
  display: grid;
  gap: 8px;
  padding: 16px 18px;
  background: var(--mc-surface2);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.wrong p {
  margin: 0;
  color: var(--mc-ink2);
  font-size: 13.5px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.footer {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-ink2);
}
```

`apps/panel/src/features/access/EmailBlockedPage.tsx`:

```tsx
import { Button } from "@mantine/core";
import { IconArrowUpRight } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate } from "react-router";
import { resendVerification } from "../../api/auth.ts";
import { ApiError, describeError } from "../../api/client.ts";
import { LoadFailure, NeutralScreen } from "../../auth/ScreenStates.tsx";
import { useLogout } from "../../auth/useLogout.ts";
import { useMe } from "../../auth/useMe.ts";
import { formatCountdown } from "../../lib/time.ts";
import { useCountdown } from "../../lib/useCountdown.ts";
import { Notice } from "../../ui/Notice.tsx";
import access from "./access.module.css";
import classes from "./EmailBlockedPage.module.css";

const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL;

/**
 * Sem rail e sem header: o painel está bloqueado, e mostrar a navegação
 * desabilitada só frustra. Endereço errado não tem saída pela API (S30 em
 * aberto) — a tela diz isso, em vez de fingir que há um botão.
 */
export function EmailBlockedPage() {
  const me = useMe();
  const countdown = useCountdown();
  const [sent, setSent] = useState(false);
  const logoutMutation = useLogout();

  const resend = useMutation({
    mutationFn: resendVerification,
    onSuccess: () => setSent(true),
    onError: (error) => {
      setSent(false);
      // teto de 3 por minuto por usuário; o Retry-After diz quanto falta
      if (error instanceof ApiError && error.status === 429) {
        countdown.start(error.retryAfterSeconds ?? 60);
      }
    },
  });

  if (me.isPending) return <NeutralScreen />;
  if (me.isError) return <LoadFailure onRetry={() => void me.refetch()} />;
  if (me.data.emailVerified) return <Navigate to="/pedidos" replace />;

  const locked = countdown.seconds > 0;

  return (
    <div className={classes.page}>
      <div className={classes.column}>
        <span className={access.eyebrowWarn}>Painel bloqueado</span>
        <h1 className={classes.title}>Confirme o e-mail da loja</h1>
        <p className={classes.lead}>
          Enviamos um link de confirmação para o endereço abaixo. Até ele ser aberto, nenhuma tela do
          painel carrega — nem os pedidos.
        </p>

        <section className={classes.card}>
          <span className={classes.label}>Endereço cadastrado</span>
          <strong className={classes.email}>{me.data.email}</strong>
          <Button
            variant="default"
            disabled={locked}
            loading={resend.isPending}
            onClick={() => resend.mutate()}
          >
            {locked ? `Reenviar em ${formatCountdown(countdown.seconds)}` : "Não recebi, reenviar"}
          </Button>
          {locked && (
            <Notice tone="warn">
              Aguarde um instante: são no máximo 3 reenvios por minuto. O último link continua valendo.
            </Notice>
          )}
          {sent && !locked && (
            <p className={access.success}>Link reenviado. Confira também a caixa de spam.</p>
          )}
          {resend.isError && !locked && (
            <p role="alert" className={access.error}>
              {describeError(resend.error)}
            </p>
          )}
        </section>

        <section className={classes.wrong}>
          <strong>O endereço está errado?</strong>
          <p>
            Não é possível trocar o e-mail pelo painel. Duas saídas: falar com o suporte, ou aguardar
            7 dias — nesse prazo o cadastro é liberado automaticamente e você entra sem confirmar.
          </p>
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

        <p className={classes.footer}>
          Já confirmou em outra aba?{" "}
          <button type="button" className={access.link} onClick={() => void me.refetch()}>
            Verificar de novo
          </button>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Rota**

Em `apps/panel/src/router.tsx`:

```tsx
import { EmailBlockedPage } from "./features/access/EmailBlockedPage.tsx";
```

```tsx
      { path: "/confirme-seu-email", element: <EmailBlockedPage /> },
```

- [ ] **Step 6: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ adiciona o bloqueio de e-mail com reenvio limitado"
```

---

### Task 9: Casca do painel — rail, header, pausa e menu da conta

**Files:**
- Create: `apps/panel/src/api/restaurant.ts`, `apps/panel/src/api/orders.ts`, `apps/panel/src/features/restaurant/useRestaurant.ts`, `apps/panel/src/features/orders/polling.ts`, `apps/panel/src/features/orders/useSummary.ts`, `apps/panel/src/layout/PanelLayout.tsx`, `PanelLayout.module.css`, `Rail.tsx`, `Rail.module.css`, `Header.tsx`, `Header.module.css`, `PauseSwitch.tsx`, `PauseSwitch.module.css`, `PauseBanner.tsx`, `UserMenu.tsx`, `UserMenu.module.css`
- Modify: `apps/panel/src/router.tsx`, `apps/panel/test/fixtures.ts`
- Test: `apps/panel/test/layout.test.tsx`

**Interfaces:**
- Consumes: `useSessionUser` (Task 5), `useLogout` (Task 8), `formatCents` (Task 2).
- Produces:
  - `getRestaurant(id): Promise<Restaurant>`, `updateRestaurant(id, patch: { acceptingOrders: boolean }): Promise<Restaurant>`
  - `type OrderRange = { period: Period } | { from: string; to: string }`, `rangeQuery(range): Record<string, string>`, `getOrdersSummary(restaurantId, range): Promise<OrdersSummary>`
  - `restaurantQueryKey(id)`, `useRestaurant(id)`, `useSetAcceptingOrders(id)`
  - `ORDERS_POLL_MS = 10_000`
  - `useTodaySummary(restaurantId)` — chave `["orders", "summary", restaurantId, "today"]`
  - `PanelLayout` (lê `handle.title` das rotas), `type RouteHandle = { title: string }`, `Rail({ restaurant, me })`, `initials(name): string`
  - teste: `panelHandlers(options?): MockHandler[]`

- [ ] **Step 1: `panelHandlers` nas fixtures**

Acrescente ao fim de `apps/panel/test/fixtures.ts` (e os imports que faltarem no topo):

```ts
import type { MockHandler } from "./api-mock.ts";

/** O mínimo que toda tela de dentro do painel pede. Específicos antes. */
export function panelHandlers(
  options: { me?: Partial<Me>; restaurant?: Partial<Restaurant>; summary?: Partial<OrdersSummary> } = {},
): MockHandler[] {
  return [
    { method: "GET", path: "/auth/me", body: makeMe(options.me) },
    { method: "GET", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant(options.restaurant) },
    {
      method: "GET",
      path: `/restaurants/${RESTAURANT_ID}/orders/summary`,
      body: makeSummary(options.summary),
    },
  ];
}
```

- [ ] **Step 2: Escrever o teste que falha**

`apps/panel/test/layout.test.tsx`:

```tsx
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readSession } from "../src/api/session.ts";
import { RequireVerified } from "../src/auth/guards.tsx";
import { PanelLayout } from "../src/layout/PanelLayout.tsx";
import { mockApi } from "./api-mock.ts";
import { makeRestaurant, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  {
    element: <RequireVerified />,
    children: [
      {
        element: <PanelLayout />,
        children: [{ path: "/pedidos", handle: { title: "Pedidos" }, element: <p>conteúdo</p> }],
      },
    ],
  },
  { path: "/login", element: <LocationProbe /> },
];

const PAUSED_TEXT = "A loja não está recebendo pedidos novos. O horário cadastrado não foi alterado.";

describe("PanelLayout", () => {
  it("mostra a loja, o título da tela e os números do dia", async () => {
    signIn();
    mockApi(
      panelHandlers({
        summary: { revenueOrderCount: 6, revenueInCents: 45000, averageTicketInCents: 7500 },
      }),
    );
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByText("Trattoria Bella")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pedidos" })).toBeTruthy();
    expect(await screen.findByText("R$ 450,00")).toBeTruthy();
    expect(screen.getByText("R$ 75,00")).toBeTruthy();
    expect(screen.getByText("Aceitos hoje")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("Aceitando pedidos", { selector: "span" })).toBeTruthy();
  });

  it("o interruptor pausa a loja e a faixa aparece", async () => {
    signIn();
    const api = mockApi([
      {
        method: "PATCH",
        path: `/restaurants/${RESTAURANT_ID}`,
        body: makeRestaurant({ acceptingOrders: false }),
      },
      ...panelHandlers(),
    ]);
    renderRoutes(routes, "/pedidos");
    const pause = await screen.findByRole("switch", { name: "Aceitando pedidos" });
    fireEvent.click(pause);
    expect(await screen.findByText(PAUSED_TEXT)).toBeTruthy();
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ acceptingOrders: false });
    expect(pause.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Pausada agora")).toBeTruthy();
  });

  it("loja já pausada abre com a faixa", async () => {
    signIn();
    mockApi(panelHandlers({ restaurant: { acceptingOrders: false } }));
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByText(PAUSED_TEXT)).toBeTruthy();
  });

  it("o menu da conta troca o tema e sai", async () => {
    signIn();
    const api = mockApi([{ method: "POST", path: "/auth/logout", status: 204 }, ...panelHandlers()]);
    renderRoutes(routes, "/pedidos");
    fireEvent.click(await screen.findByRole("button", { name: "Menu da conta" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Tema escuro" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Sair" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/login");
    expect(readSession()).toBeNull();
    expect(api.calls.some((call) => call.path === "/auth/logout")).toBe(true);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- layout`
Expected: FAIL — `src/layout/PanelLayout.tsx` não existe.

- [ ] **Step 4: API do restaurante e do resumo**

`apps/panel/src/api/restaurant.ts`:

```ts
import { apiRequest } from "./client.ts";
import type { Restaurant } from "./types.ts";

export function getRestaurant(id: string): Promise<Restaurant> {
  return apiRequest<Restaurant>(`/restaurants/${id}`);
}

export function updateRestaurant(id: string, patch: { acceptingOrders: boolean }): Promise<Restaurant> {
  return apiRequest<Restaurant>(`/restaurants/${id}`, { method: "PATCH", body: patch });
}
```

`apps/panel/src/api/orders.ts` (a Task 11 acrescenta o resto):

```ts
import { apiRequest } from "./client.ts";
import type { OrdersSummary, Period } from "./types.ts";

/** Período OU intervalo — a API responde 400 se receber os dois. */
export type OrderRange = { period: Period } | { from: string; to: string };

export function rangeQuery(range: OrderRange): Record<string, string> {
  return "period" in range ? { period: range.period } : { from: range.from, to: range.to };
}

export function getOrdersSummary(restaurantId: string, range: OrderRange): Promise<OrdersSummary> {
  return apiRequest<OrdersSummary>(`/restaurants/${restaurantId}/orders/summary`, {
    query: rangeQuery(range),
  });
}
```

- [ ] **Step 5: Hooks do restaurante e do resumo**

`apps/panel/src/features/restaurant/useRestaurant.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRestaurant, updateRestaurant } from "../../api/restaurant.ts";

export function restaurantQueryKey(id: string) {
  return ["restaurant", id] as const;
}

export function useRestaurant(id: string) {
  return useQuery({
    queryKey: restaurantQueryKey(id),
    queryFn: () => getRestaurant(id),
    // outro aparelho da loja pode pausar: a faixa não pode mentir por muito tempo
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
}

export function useSetAcceptingOrders(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (acceptingOrders: boolean) => updateRestaurant(id, { acceptingOrders }),
    onSuccess: (restaurant) => queryClient.setQueryData(restaurantQueryKey(id), restaurant),
  });
}
```

`apps/panel/src/features/orders/polling.ts`:

```ts
/**
 * Intervalo de atualização de tudo que é pedido. Orçamento de rate limit
 * (100 req/min por IP): lista + resumo + pendentes = 18 req/min por aparelho;
 * dois aparelhos da loja atrás do mesmo IP ficam longe do teto.
 */
export const ORDERS_POLL_MS = 10_000;
```

`apps/panel/src/features/orders/useSummary.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getOrdersSummary } from "../../api/orders.ts";
import { ORDERS_POLL_MS } from "./polling.ts";

/**
 * Os números do header ("Aceitos hoje · Faturamento · Ticket médio"). O
 * Resumo do dia (parte 3) usa ESTA query: duas fontes fariam os números
 * divergirem, e o operador deixaria de confiar nos dois (handoff).
 */
export function useTodaySummary(restaurantId: string) {
  return useQuery({
    queryKey: ["orders", "summary", restaurantId, "today"],
    queryFn: () => getOrdersSummary(restaurantId, { period: "today" }),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
  });
}
```

- [ ] **Step 6: Componentes da casca**

`apps/panel/src/layout/PanelLayout.module.css`:

```css
.shell {
  display: flex;
  min-height: 100vh;
  background: var(--mc-bg);
}

.main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.content {
  flex: 1 1 auto;
  min-width: 0;
}

.banner {
  padding: 10px 20px;
  background: var(--mc-warn-soft);
  border-bottom: 1px solid var(--mc-warn-line);
  color: var(--mc-warn);
  font-size: 13.5px;
}
```

`apps/panel/src/layout/PauseBanner.tsx`:

```tsx
import classes from "./PanelLayout.module.css";

/** A segunda frase existe para tirar o medo de ter desconfigurado o horário. */
export function PauseBanner() {
  return (
    <div className={classes.banner} role="status">
      <strong>Pausada</strong> · A loja não está recebendo pedidos novos. O horário cadastrado não foi
      alterado.
    </div>
  );
}
```

`apps/panel/src/layout/PanelLayout.tsx`:

```tsx
import { Outlet, useMatches } from "react-router";
import { useSessionUser } from "../auth/useMe.ts";
import { useRestaurant } from "../features/restaurant/useRestaurant.ts";
import { Header } from "./Header.tsx";
import classes from "./PanelLayout.module.css";
import { PauseBanner } from "./PauseBanner.tsx";
import { Rail } from "./Rail.tsx";

/** Toda rota do painel declara `handle: { title }`; é o título do header. */
export type RouteHandle = { title: string };

function useRouteTitle(): string {
  const matches = useMatches();
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index].handle as RouteHandle | undefined;
    if (handle?.title) return handle.title;
  }
  return "";
}

export function PanelLayout() {
  const me = useSessionUser();
  const restaurant = useRestaurant(me.restaurantId);
  const title = useRouteTitle();
  const paused = restaurant.data?.acceptingOrders === false;

  return (
    <div className={classes.shell}>
      <Rail restaurant={restaurant.data} me={me} />
      <div className={classes.main}>
        <Header title={title} restaurantId={me.restaurantId} restaurant={restaurant.data} />
        {paused && <PauseBanner />}
        <div className={classes.content}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
```

`apps/panel/src/layout/Rail.module.css`:

```css
.rail {
  position: sticky;
  top: 0;
  flex: 0 0 212px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--mc-surface);
  border-right: 1px solid var(--mc-line);
}

.top {
  display: grid;
  gap: 4px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--mc-line);
}

.store {
  font-size: 15px;
  font-weight: 700;
  color: var(--mc-ink);
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--mc-ink2);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--mc-accent);
}

.nav {
  flex: 1 1 auto;
  overflow-y: auto;
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 12px 10px;
}

.group {
  display: grid;
  gap: 2px;
}

.groupTitle {
  padding: 0 10px 4px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--mc-ink3);
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--mc-ink2);
  font-size: 13.5px;
  font-weight: 500;
  text-decoration: none;
}

.item:hover {
  background: var(--mc-surface3);
}

.active,
.active:hover {
  background: var(--mc-accent-soft);
  color: var(--mc-accent-hi);
}

.footer {
  padding: 10px;
  border-top: 1px solid var(--mc-line);
}
```

`apps/panel/src/layout/Rail.tsx`:

```tsx
import { NavLink } from "react-router";
import type { Me, Restaurant } from "../api/types.ts";
import classes from "./Rail.module.css";
import { UserMenu } from "./UserMenu.tsx";

// O rail mostra SÓ o que existe (spec): cada tela entra aqui na task dela.
const NAV_GROUPS: { title: string; items: { to: string; label: string }[] }[] = [
  { title: "Operação", items: [{ to: "/pedidos", label: "Pedidos" }] },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? `${classes.item} ${classes.active}` : classes.item;
}

export function Rail({ restaurant, me }: { restaurant: Restaurant | undefined; me: Me }) {
  const paused = restaurant?.acceptingOrders === false;
  return (
    <nav className={classes.rail} aria-label="Navegação do painel">
      <div className={classes.top}>
        <strong className={classes.store}>{restaurant?.name ?? ""}</strong>
        {/* "Aberta · fecha 23:30" do handoff fica para quando a API expuser
            isOpen e o próximo fechamento (pendência da spec). */}
        <span className={classes.status}>
          <span className={classes.dot} aria-hidden="true" />
          {paused ? "Pausada agora" : "Aceitando pedidos"}
        </span>
      </div>
      <div className={classes.nav}>
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className={classes.group}>
            <span className={classes.groupTitle}>{group.title}</span>
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} className={navClass}>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className={classes.footer}>
        <UserMenu me={me} />
      </div>
    </nav>
  );
}
```

`apps/panel/src/layout/UserMenu.module.css`:

```css
.user {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.user:hover {
  background: var(--mc-surface3);
}

.avatar {
  flex: 0 0 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--mc-surface3);
  color: var(--mc-ink2);
  font-size: 12px;
  font-weight: 700;
}

.who {
  min-width: 0;
  display: grid;
}

.name {
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mc-ink);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.role {
  font-size: 11px;
  color: var(--mc-ink3);
}
```

`apps/panel/src/layout/UserMenu.tsx`:

```tsx
import { Menu, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import type { Me } from "../api/types.ts";
import { useLogout } from "../auth/useLogout.ts";
import classes from "./UserMenu.module.css";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Rodapé do rail. "Sair" e o tema são adição ao handoff, que não tem logout
 * em lugar nenhum (spec, tabela de divergências).
 */
export function UserMenu({ me }: { me: Me }) {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  const logoutMutation = useLogout();

  return (
    <Menu position="top-start" width={200}>
      <Menu.Target>
        <button type="button" className={classes.user} aria-label="Menu da conta">
          <span className={classes.avatar}>{initials(me.name)}</span>
          <span className={classes.who}>
            <span className={classes.name}>{me.name}</span>
            <span className={classes.role}>{me.role === "owner" ? "Dono" : "Equipe"}</span>
          </span>
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => setColorScheme(scheme === "dark" ? "light" : "dark")}>
          {scheme === "dark" ? "Tema claro" : "Tema escuro"}
        </Menu.Item>
        <Menu.Item onClick={() => logoutMutation.mutate()}>Sair</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
```

`apps/panel/src/layout/Header.module.css`:

```css
.header {
  position: sticky;
  top: 0;
  z-index: 20;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 20px;
  background: var(--mc-surface);
  border-bottom: 1px solid var(--mc-line);
}

.title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.right {
  display: flex;
  align-items: center;
  gap: 22px;
}

.indicator {
  display: grid;
  gap: 1px;
}

.eyebrow {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mc-ink3);
}

.value {
  font-size: 16px;
  font-weight: 600;
  color: var(--mc-ink);
}

.divider {
  width: 1px;
  height: 32px;
  background: var(--mc-line);
}
```

`apps/panel/src/layout/Header.tsx`:

```tsx
import type { Restaurant } from "../api/types.ts";
import { useTodaySummary } from "../features/orders/useSummary.ts";
import { formatCents } from "../lib/money.ts";
import classes from "./Header.module.css";
import { PauseSwitch } from "./PauseSwitch.tsx";

function Indicator({ label, value }: { label: string; value: string }) {
  return (
    <div className={classes.indicator}>
      <span className={classes.eyebrow}>{label}</span>
      <span className={`${classes.value} n`}>{value}</span>
    </div>
  );
}

export function Header({
  title,
  restaurantId,
  restaurant,
}: {
  title: string;
  restaurantId: string;
  restaurant: Restaurant | undefined;
}) {
  const summary = useTodaySummary(restaurantId).data;
  return (
    <header className={classes.header}>
      <h1 className={classes.title}>{title}</h1>
      <div className={classes.right}>
        {/* "Aceitos hoje", não "Pedidos": conta de aceito em diante, igual ao
            Resumo — o rótulo antigo contava os chegados e divergia. */}
        <Indicator label="Aceitos hoje" value={summary ? String(summary.revenueOrderCount) : "—"} />
        <Indicator label="Faturamento" value={summary ? formatCents(summary.revenueInCents) : "—"} />
        <Indicator
          label="Ticket médio"
          value={summary ? formatCents(summary.averageTicketInCents) : "—"}
        />
        <span className={classes.divider} aria-hidden="true" />
        <PauseSwitch restaurantId={restaurantId} restaurant={restaurant} />
      </div>
    </header>
  );
}
```

`apps/panel/src/layout/PauseSwitch.module.css`:

```css
.wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 7px 14px 7px 11px;
  border: 1px solid var(--mc-line);
  border-radius: 999px;
  background: var(--mc-surface);
  color: var(--mc-ink);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.pill:hover {
  border-color: var(--mc-line-hi);
}

.pill:disabled {
  cursor: default;
}

.track {
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: var(--mc-accent);
}

.knob {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--mc-on-accent);
}

.paused {
  background: var(--mc-warn-soft);
  border-color: var(--mc-warn-line);
  color: var(--mc-warn);
}

.paused .track {
  background: var(--mc-warn-line);
}

.paused .knob {
  right: auto;
  left: 3px;
  background: var(--mc-warn);
}

.error {
  font-size: 12.5px;
  color: var(--mc-danger);
}
```

`apps/panel/src/layout/PauseSwitch.tsx`:

```tsx
import type { Restaurant } from "../api/types.ts";
import { useSetAcceptingOrders } from "../features/restaurant/useRestaurant.ts";
import classes from "./PauseSwitch.module.css";

/**
 * O botão de "cozinha afogada". Global e sempre visível, de propósito: quem
 * precisa dele está com a cozinha em colapso e não vai procurar em
 * configurações. Não mexe no horário cadastrado.
 */
export function PauseSwitch({
  restaurantId,
  restaurant,
}: {
  restaurantId: string;
  restaurant: Restaurant | undefined;
}) {
  const mutation = useSetAcceptingOrders(restaurantId);
  const accepting = restaurant?.acceptingOrders ?? true;
  return (
    <div className={classes.wrap}>
      <button
        type="button"
        role="switch"
        aria-checked={accepting}
        aria-label="Aceitando pedidos"
        disabled={restaurant === undefined || mutation.isPending}
        className={accepting ? classes.pill : `${classes.pill} ${classes.paused}`}
        onClick={() => mutation.mutate(!accepting)}
      >
        <span className={classes.track} aria-hidden="true">
          <span className={classes.knob} />
        </span>
        {accepting ? "Aceitando pedidos" : "Pausada"}
      </button>
      {mutation.isError && (
        <span role="alert" className={classes.error}>
          Não mudou — tente de novo
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Rota do painel dentro da casca**

Em `apps/panel/src/router.tsx`, importe o layout e troque o bloco de `RequireVerified`:

```tsx
import { PanelLayout } from "./layout/PanelLayout.tsx";
```

```tsx
      {
        element: <RequireVerified />,
        children: [
          {
            element: <PanelLayout />,
            children: [
              { path: "/pedidos", handle: { title: "Pedidos" }, element: <Placeholder title="Pedidos" /> },
            ],
          },
        ],
      },
```

- [ ] **Step 8: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ adiciona a casca do painel com pausa global no header"
```

---

### Task 10: Regras de pedido (funções puras)

**Files:**
- Create: `apps/panel/src/ui/confirmCopy.ts`, `apps/panel/src/features/orders/orderRules.ts`, `apps/panel/src/features/orders/presentation.ts`
- Test: `apps/panel/test/orderRules.test.ts`, `apps/panel/test/presentation.test.ts`

**Interfaces:**
- Consumes: `formatCents`, `orderCode`, `formatClock`, `elapsedMinutes` (Task 2); tipos (Task 3).
- Produces:
  - `type ConfirmCopy = { title: string; body: string; warn?: string; cta: string; tone: "accent" | "danger" }`
  - `type ColumnId`, `COLUMNS`, `columnOf(status)`, `groupByColumn(orders): Record<ColumnId, Order[]>`, `isClosed(status)`
  - `type PrimaryAction = { transition; label; cardLabel; note }`, `primaryAction(order): PrimaryAction | null`
  - `type CancelKind = "refuse" | "return-stock" | "keep-stock"`, `cancelKind(status)`, `cancelLabel(kind)`, `acceptCopy(order)`, `cancelCopy(order): ConfirmCopy | null`, `displayName(order)`
  - `type Step = { label; state: "done" | "current" | "future"; time: string | null }`, `progressSteps(order, timeZone?)`, `closedMessage(order, timeZone?)`
  - `typeLabel(type)`, `stageLabel(status)`, `paymentLabel(order)`, `whereLabel(order)`, `freightLine(order): { label; value } | null`, `itemsSubtotal(order)`, `groupOptions(options)`, `isUrgent(order, nowMs)`, `formatPhone(phone)`

- [ ] **Step 1: Escrever os testes que falham**

`apps/panel/test/orderRules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { OrderStatus, OrderType } from "../src/api/types.ts";
import {
  acceptCopy,
  cancelCopy,
  cancelKind,
  cancelLabel,
  closedMessage,
  columnOf,
  groupByColumn,
  primaryAction,
  progressSteps,
} from "../src/features/orders/orderRules.ts";
import { makeOrder } from "./fixtures.ts";

const ID = "a3f9c2d1-0000-4000-8000-000000000001";
const TZ = "America/Sao_Paulo";

describe("colunas do kanban", () => {
  it("cada status mora numa coluna", () => {
    const expected: Record<OrderStatus, string> = {
      pending: "new",
      confirmed: "preparing",
      preparing: "preparing",
      out_for_delivery: "ready",
      ready_for_pickup: "ready",
      completed: "done",
      cancelled: "done",
    };
    for (const [status, column] of Object.entries(expected)) {
      expect(columnOf(status as OrderStatus)).toBe(column);
    }
  });

  it("agrupa preservando a ordem recebida", () => {
    const a = makeOrder({ status: "pending" });
    const b = makeOrder({ status: "completed" });
    const c = makeOrder({ status: "pending" });
    const groups = groupByColumn([a, b, c]);
    expect(groups.new.map((o) => o.id)).toEqual([a.id, c.id]);
    expect(groups.done.map((o) => o.id)).toEqual([b.id]);
    expect(groups.preparing).toEqual([]);
  });
});

describe("ação principal", () => {
  const cases: [OrderType, OrderStatus, string | null][] = [
    ["delivery", "pending", "accept"],
    ["delivery", "confirmed", "start-preparing"],
    ["delivery", "preparing", "dispatch"],
    ["takeaway", "preparing", "ready"],
    ["dine_in", "preparing", "complete"],
    ["delivery", "out_for_delivery", "complete"],
    ["takeaway", "ready_for_pickup", "complete"],
    ["delivery", "completed", null],
    ["takeaway", "cancelled", null],
  ];
  it.each(cases)("%s em %s → %s", (type, status, transition) => {
    expect(primaryAction({ type, status })?.transition ?? null).toBe(transition);
  });

  it("os rótulos mudam com a modalidade", () => {
    expect(primaryAction({ type: "delivery", status: "preparing" })).toMatchObject({
      label: "Saiu para entrega",
      cardLabel: "Despachar",
    });
    expect(primaryAction({ type: "takeaway", status: "preparing" })).toMatchObject({
      label: "Pronto para retirada",
      cardLabel: "Pronto",
    });
    expect(primaryAction({ type: "dine_in", status: "preparing" })).toMatchObject({
      label: "Concluir pedido",
      cardLabel: "Concluir",
    });
    expect(primaryAction({ type: "delivery", status: "pending" })).toMatchObject({
      label: "Aceitar pedido",
      cardLabel: "Aceitar",
      note: "Aceitar baixa o estoque e não pode ser desfeito.",
    });
  });
});

describe("cancelamento — três textos, porque errar sobre o estoque é o erro mais caro", () => {
  it("pedido novo é recusa: o estoque nunca foi baixado", () => {
    const order = makeOrder({ id: ID, status: "pending" });
    expect(cancelKind("pending")).toBe("refuse");
    expect(cancelCopy(order)).toEqual({
      title: "Recusar o pedido #A3F9?",
      body: "O pedido sai da lista. O estoque não tinha sido baixado, então nada muda nele.",
      cta: "Recusar pedido",
      tone: "danger",
    });
  });

  it("antes de pronto devolve o estoque", () => {
    const order = makeOrder({ id: ID, status: "preparing" });
    expect(cancelCopy(order)).toEqual({
      title: "Cancelar o pedido #A3F9?",
      body: "O pedido #A3F9 sai da lista e as unidades voltam para o estoque.",
      cta: "Cancelar e devolver estoque",
      tone: "danger",
    });
  });

  it("depois de pronto NÃO devolve", () => {
    for (const status of ["out_for_delivery", "ready_for_pickup"] as const) {
      expect(cancelCopy(makeOrder({ id: ID, status }))).toEqual({
        title: "Cancelar sem devolver o estoque?",
        body: "A comida do pedido #A3F9 já ficou pronta. As unidades usadas não voltam para o estoque — só o pedido sai da lista.",
        warn: "O estoque NÃO será devolvido.",
        cta: "Cancelar sem devolver",
        tone: "danger",
      });
    }
  });

  it("pedido encerrado não cancela", () => {
    expect(cancelCopy(makeOrder({ status: "completed" }))).toBeNull();
    expect(cancelKind("cancelled")).toBeNull();
  });

  it("os botões dizem o que vai acontecer", () => {
    expect(cancelLabel("refuse")).toBe("Recusar pedido");
    expect(cancelLabel("return-stock")).toBe("Cancelar pedido");
    expect(cancelLabel("keep-stock")).toBe("Cancelar (sem devolver estoque)");
  });
});

describe("aceite", () => {
  it("avisa que não existe desconfirmar", () => {
    const order = makeOrder({ id: ID, totalInCents: 10100 });
    expect(acceptCopy(order)).toEqual({
      title: "Aceitar o pedido #A3F9?",
      body: "Marcela Andrade · R$ 101,00. Aceitar manda o pedido para a cozinha e baixa o estoque dos itens.",
      warn: "Não existe desconfirmar. Depois de aceito, só cabe cancelar.",
      cta: "Aceitar pedido",
      tone: "accent",
    });
  });

  it("pedido de mesa se identifica pela mesa", () => {
    const order = makeOrder({ id: ID, type: "dine_in", table: { id: "t7", label: "Mesa 7" } });
    expect(acceptCopy(order).body.startsWith("Mesa 7 · ")).toBe(true);
  });
});

describe("andamento", () => {
  it("entrega em preparo: 'Novo' com a hora da chegada, a etapa atual com a última mudança", () => {
    const order = makeOrder({
      type: "delivery",
      status: "preparing",
      createdAt: "2026-09-19T22:58:00.000Z",
      updatedAt: "2026-09-19T23:04:00.000Z",
    });
    expect(progressSteps(order, TZ)).toEqual([
      { label: "Novo", state: "done", time: "19:58" },
      { label: "Em preparo", state: "current", time: "20:04" },
      { label: "Saiu para entrega", state: "future", time: null },
      { label: "Concluído", state: "future", time: null },
    ]);
  });

  it("salão pula direto para concluído", () => {
    const order = makeOrder({ type: "dine_in", status: "completed", updatedAt: "2026-09-19T23:10:00.000Z" });
    expect(progressSteps(order, TZ).map((step) => [step.label, step.state])).toEqual([
      ["Novo", "done"],
      ["Em preparo", "done"],
      ["Concluído", "current"],
    ]);
  });

  it("retirada tem 'Pronto para retirada'", () => {
    const order = makeOrder({ type: "takeaway", status: "ready_for_pickup" });
    expect(progressSteps(order, TZ)[2]).toMatchObject({ label: "Pronto para retirada", state: "current" });
  });

  it("cancelado mostra quando entrou e quando foi cancelado", () => {
    const order = makeOrder({ status: "cancelled", updatedAt: "2026-09-19T23:10:00.000Z" });
    expect(progressSteps(order, TZ)).toEqual([
      { label: "Novo", state: "done", time: "19:58" },
      { label: "Cancelado", state: "current", time: "20:10" },
    ]);
  });

  it("pedido encerrado diz que não há ação", () => {
    const completed = makeOrder({ status: "completed", updatedAt: "2026-09-19T23:10:00.000Z" });
    expect(closedMessage(completed, TZ)).toBe("Pedido concluído às 20:10. Não há mais ação possível.");
    expect(closedMessage(makeOrder({ status: "cancelled" }), TZ)).toBe(
      "Pedido cancelado. Não há mais ação possível.",
    );
    expect(closedMessage(makeOrder({ status: "preparing" }), TZ)).toBeNull();
  });
});
```

`apps/panel/test/presentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatPhone,
  freightLine,
  groupOptions,
  isUrgent,
  itemsSubtotal,
  paymentLabel,
  stageLabel,
  typeLabel,
  whereLabel,
} from "../src/features/orders/presentation.ts";
import { makeOrder } from "./fixtures.ts";

const NOW = Date.parse("2026-09-19T23:00:00.000Z");

describe("apresentação do pedido", () => {
  it("modalidade e estágio", () => {
    expect(typeLabel("delivery")).toBe("Entrega");
    expect(typeLabel("takeaway")).toBe("Retirada");
    expect(typeLabel("dine_in")).toBe("Salão");
    expect(stageLabel("out_for_delivery")).toBe("Saiu para entrega");
    expect(stageLabel("ready_for_pickup")).toBe("Pronto para retirada");
    expect(stageLabel("preparing")).toBeNull();
  });

  it("pagamento, com troco ou sem", () => {
    expect(paymentLabel({ paymentMethod: "pix" })).toBe("Pix");
    expect(paymentLabel({ paymentMethod: "card_on_delivery" })).toBe("Cartão na entrega");
    expect(paymentLabel({ paymentMethod: "meal_voucher" })).toBe("Vale-refeição");
    expect(paymentLabel({ paymentMethod: "cash", changeForInCents: 5000 })).toBe(
      "Dinheiro · troco para R$ 50,00",
    );
    // ausência de troco no dinheiro = o cliente tem o valor exato
    expect(paymentLabel({ paymentMethod: "cash" })).toBe("Dinheiro · sem troco");
  });

  it("onde o pedido vai", () => {
    expect(whereLabel(makeOrder({ type: "delivery" }))).toBe("Rua Harmonia, 45 — Vila Madalena, São Paulo");
    expect(whereLabel(makeOrder({ type: "takeaway", deliveryAddress: null }))).toBe("Retirada no balcão");
    expect(
      whereLabel(makeOrder({ type: "dine_in", deliveryAddress: null, table: { id: "t", label: "Mesa 7" } })),
    ).toBe("Mesa 7");
    // adesivo antigo, sem hash: pedido de salão sem mesa é legítimo
    expect(whereLabel(makeOrder({ type: "dine_in", deliveryAddress: null, table: null }))).toBe(
      "Salão · sem mesa",
    );
  });

  it("frete em três formas, e ausente fora de entrega", () => {
    expect(freightLine(makeOrder({ type: "delivery", deliveryFeeInCents: 900 }))).toEqual({
      label: "Frete",
      value: "R$ 9,00",
    });
    expect(freightLine(makeOrder({ type: "delivery", deliveryFeeInCents: 0 }))).toEqual({
      label: "Entrega grátis",
      value: "R$ 0,00",
    });
    expect(freightLine(makeOrder({ type: "delivery", deliveryFeeInCents: null }))).toEqual({
      label: "Frete a combinar",
      value: "a combinar",
    });
    expect(freightLine(makeOrder({ type: "takeaway", deliveryFeeInCents: null }))).toBeNull();
  });

  it("itens = total menos frete (a conta precisa fechar)", () => {
    expect(itemsSubtotal(makeOrder({ totalInCents: 10100, deliveryFeeInCents: 900 }))).toBe(9200);
    expect(itemsSubtotal(makeOrder({ totalInCents: 5000, deliveryFeeInCents: null }))).toBe(5000);
  });

  it("agrupa as opções por grupo, na ordem em que vieram", () => {
    expect(
      groupOptions([
        { optionId: "1", groupName: "Sabores", name: "Calabresa", priceInCents: 0, quantity: 1 },
        { optionId: "2", groupName: "Borda", name: "Catupiry", priceInCents: 0, quantity: 1 },
        { optionId: "3", groupName: "Sabores", name: "Portuguesa", priceInCents: 0, quantity: 2 },
      ]),
    ).toEqual([
      { groupName: "Sabores", text: "Calabresa, 2× Portuguesa" },
      { groupName: "Borda", text: "Catupiry" },
    ]);
  });

  it("urgente: novo, ou aberto há mais de 25 min", () => {
    expect(isUrgent(makeOrder({ status: "pending", createdAt: "2026-09-19T22:59:00.000Z" }), NOW)).toBe(true);
    expect(isUrgent(makeOrder({ status: "preparing", createdAt: "2026-09-19T22:40:00.000Z" }), NOW)).toBe(false);
    expect(isUrgent(makeOrder({ status: "preparing", createdAt: "2026-09-19T22:30:00.000Z" }), NOW)).toBe(true);
    expect(isUrgent(makeOrder({ status: "completed", createdAt: "2026-09-19T20:00:00.000Z" }), NOW)).toBe(false);
  });

  it("telefone brasileiro legível", () => {
    expect(formatPhone("11987654321")).toBe("(11) 98765-4321");
    expect(formatPhone("1187654321")).toBe("(11) 8765-4321");
    expect(formatPhone("+55 11 9")).toBe("+55 11 9");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- orderRules presentation`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar**

`apps/panel/src/ui/confirmCopy.ts`:

```ts
/** O conteúdo de uma confirmação: quem decide o texto é a regra, não o modal. */
export type ConfirmCopy = {
  title: string;
  body: string;
  /** Faixa âmbar: a consequência que não pode passar despercebida. */
  warn?: string;
  cta: string;
  tone: "accent" | "danger";
};
```

`apps/panel/src/features/orders/orderRules.ts`:

```ts
import type { Order, OrderStatus, OrderTransition, OrderType } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import { orderCode } from "../../lib/orderCode.ts";
import { formatClock } from "../../lib/time.ts";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";

export type ColumnId = "new" | "preparing" | "ready" | "done";

export type Column = {
  id: ColumnId;
  title: string;
  statuses: readonly OrderStatus[];
  empty: string;
};

/** As quatro colunas do kanban: cada uma corresponde a uma ação física. */
export const COLUMNS: readonly Column[] = [
  { id: "new", title: "Novos", statuses: ["pending"], empty: "Nada esperando aceite." },
  {
    id: "preparing",
    title: "Em preparo",
    statuses: ["confirmed", "preparing"],
    empty: "A cozinha está livre.",
  },
  {
    id: "ready",
    title: "Prontos",
    statuses: ["out_for_delivery", "ready_for_pickup"],
    empty: "Nada aguardando saída.",
  },
  {
    id: "done",
    title: "Finalizados",
    statuses: ["completed", "cancelled"],
    empty: "Nenhum pedido encerrado hoje.",
  },
];

export function columnOf(status: OrderStatus): ColumnId {
  const column = COLUMNS.find((candidate) => candidate.statuses.includes(status));
  if (column === undefined) throw new Error(`status sem coluna: ${status}`);
  return column.id;
}

export function groupByColumn(orders: readonly Order[]): Record<ColumnId, Order[]> {
  const groups: Record<ColumnId, Order[]> = { new: [], preparing: [], ready: [], done: [] };
  for (const order of orders) groups[columnOf(order.status)].push(order);
  return groups;
}

export function isClosed(status: OrderStatus): boolean {
  return status === "completed" || status === "cancelled";
}

export type PrimaryAction = {
  transition: Exclude<OrderTransition, "cancel">;
  /** Rótulo no drawer (botão de 46 px). */
  label: string;
  /** Rótulo curto no cartão do kanban. */
  cardLabel: string;
  /** Nota de consequência ao lado do cancelamento, no drawer. */
  note: string;
};

const NOTE_ACCEPT = "Aceitar baixa o estoque e não pode ser desfeito.";
const NOTE_RETURNS = "O cancelamento ainda devolve o estoque.";
const NOTE_KEEPS = "A partir daqui o cancelamento não devolve estoque.";

/**
 * O próximo passo, conforme a trilha da modalidade (TRANSITIONS da API).
 * `confirmed` só aparece quando o `start-preparing` do aceite encadeado
 * falhou — "Começar preparo" é a rede (spec, seção Ações).
 */
export function primaryAction(order: Pick<Order, "type" | "status">): PrimaryAction | null {
  switch (order.status) {
    case "pending":
      return { transition: "accept", label: "Aceitar pedido", cardLabel: "Aceitar", note: NOTE_ACCEPT };
    case "confirmed":
      return {
        transition: "start-preparing",
        label: "Começar preparo",
        cardLabel: "Começar preparo",
        note: NOTE_RETURNS,
      };
    case "preparing":
      if (order.type === "delivery") {
        return { transition: "dispatch", label: "Saiu para entrega", cardLabel: "Despachar", note: NOTE_RETURNS };
      }
      if (order.type === "takeaway") {
        return { transition: "ready", label: "Pronto para retirada", cardLabel: "Pronto", note: NOTE_RETURNS };
      }
      return { transition: "complete", label: "Concluir pedido", cardLabel: "Concluir", note: NOTE_RETURNS };
    case "out_for_delivery":
    case "ready_for_pickup":
      return { transition: "complete", label: "Concluir pedido", cardLabel: "Concluir", note: NOTE_KEEPS };
    default:
      return null;
  }
}

export type CancelKind = "refuse" | "return-stock" | "keep-stock";

/** O corte da API: o estoque volta até a comida ficar pronta. */
export function cancelKind(status: OrderStatus): CancelKind | null {
  switch (status) {
    case "pending":
      return "refuse";
    case "confirmed":
    case "preparing":
      return "return-stock";
    case "out_for_delivery":
    case "ready_for_pickup":
      return "keep-stock";
    default:
      return null;
  }
}

export function cancelLabel(kind: CancelKind): string {
  if (kind === "refuse") return "Recusar pedido";
  if (kind === "return-stock") return "Cancelar pedido";
  return "Cancelar (sem devolver estoque)";
}

/** Pedido de mesa se identifica pela mesa; os outros, pelo cliente. */
export function displayName(order: Pick<Order, "type" | "table" | "customer">): string {
  return order.type === "dine_in" && order.table ? order.table.label : order.customer.name;
}

export function acceptCopy(order: Order): ConfirmCopy {
  return {
    title: `Aceitar o pedido ${orderCode(order.id)}?`,
    body: `${displayName(order)} · ${formatCents(order.totalInCents)}. Aceitar manda o pedido para a cozinha e baixa o estoque dos itens.`,
    warn: "Não existe desconfirmar. Depois de aceito, só cabe cancelar.",
    cta: "Aceitar pedido",
    tone: "accent",
  };
}

/**
 * Três textos de cancelamento. O terceiro ("recusar") não está no handoff,
 * que reaproveitava "as unidades voltam" num pedido que nunca baixou nada —
 * afirmar algo falso sobre o estoque é o erro mais caro do fluxo.
 */
export function cancelCopy(order: Order): ConfirmCopy | null {
  const code = orderCode(order.id);
  switch (cancelKind(order.status)) {
    case "refuse":
      return {
        title: `Recusar o pedido ${code}?`,
        body: "O pedido sai da lista. O estoque não tinha sido baixado, então nada muda nele.",
        cta: "Recusar pedido",
        tone: "danger",
      };
    case "return-stock":
      return {
        title: `Cancelar o pedido ${code}?`,
        body: `O pedido ${code} sai da lista e as unidades voltam para o estoque.`,
        cta: "Cancelar e devolver estoque",
        tone: "danger",
      };
    case "keep-stock":
      return {
        title: "Cancelar sem devolver o estoque?",
        body: `A comida do pedido ${code} já ficou pronta. As unidades usadas não voltam para o estoque — só o pedido sai da lista.`,
        warn: "O estoque NÃO será devolvido.",
        cta: "Cancelar sem devolver",
        tone: "danger",
      };
    default:
      return null;
  }
}

export type Step = { label: string; state: "done" | "current" | "future"; time: string | null };

const STEP_LABELS: Record<OrderType, readonly string[]> = {
  delivery: ["Novo", "Em preparo", "Saiu para entrega", "Concluído"],
  takeaway: ["Novo", "Em preparo", "Pronto para retirada", "Concluído"],
  dine_in: ["Novo", "Em preparo", "Concluído"],
};

function stepIndex(order: Pick<Order, "type" | "status">): number {
  switch (order.status) {
    case "pending":
      return 0;
    case "confirmed":
    case "preparing":
      return 1;
    case "out_for_delivery":
    case "ready_for_pickup":
      return 2;
    default:
      return STEP_LABELS[order.type].length - 1;
  }
}

/**
 * A API só guarda `createdAt` e `updatedAt`: "Novo" leva a hora da chegada,
 * a etapa atual leva a da última mudança, e as cumpridas no meio ficam sem
 * hora (horário por etapa é pendência de backend da spec).
 */
export function progressSteps(order: Order, timeZone?: string): Step[] {
  if (order.status === "cancelled") {
    return [
      { label: "Novo", state: "done", time: formatClock(order.createdAt, timeZone) },
      { label: "Cancelado", state: "current", time: formatClock(order.updatedAt, timeZone) },
    ];
  }
  const current = stepIndex(order);
  return STEP_LABELS[order.type].map((label, index) => ({
    label,
    state: index < current ? "done" : index === current ? "current" : "future",
    time:
      index === 0
        ? formatClock(order.createdAt, timeZone)
        : index === current
          ? formatClock(order.updatedAt, timeZone)
          : null,
  }));
}

export function closedMessage(order: Order, timeZone?: string): string | null {
  if (order.status === "completed") {
    return `Pedido concluído às ${formatClock(order.updatedAt, timeZone)}. Não há mais ação possível.`;
  }
  if (order.status === "cancelled") return "Pedido cancelado. Não há mais ação possível.";
  return null;
}
```

`apps/panel/src/features/orders/presentation.ts`:

```ts
import type { Order, OrderItemOption, OrderStatus, OrderType } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import { elapsedMinutes } from "../../lib/time.ts";
import { isClosed } from "./orderRules.ts";

const TYPE_LABEL: Record<OrderType, string> = {
  delivery: "Entrega",
  takeaway: "Retirada",
  dine_in: "Salão",
};

export function typeLabel(type: OrderType): string {
  return TYPE_LABEL[type];
}

/** O estágio que o cartão mostra junto do tipo, na coluna Prontos. */
export function stageLabel(status: OrderStatus): string | null {
  if (status === "out_for_delivery") return "Saiu para entrega";
  if (status === "ready_for_pickup") return "Pronto para retirada";
  return null;
}

/** Sem "pago": a API não registra se o pagamento aconteceu (spec). */
export function paymentLabel(order: Pick<Order, "paymentMethod" | "changeForInCents">): string {
  switch (order.paymentMethod) {
    case "cash":
      return order.changeForInCents === undefined
        ? "Dinheiro · sem troco"
        : `Dinheiro · troco para ${formatCents(order.changeForInCents)}`;
    case "card_on_delivery":
      return "Cartão na entrega";
    case "pix":
      return "Pix";
    case "meal_voucher":
      return "Vale-refeição";
  }
}

export function whereLabel(order: Pick<Order, "type" | "deliveryAddress" | "table">): string {
  if (order.type === "delivery" && order.deliveryAddress) {
    const a = order.deliveryAddress;
    return `${a.street}, ${a.number} — ${a.neighborhood}, ${a.city}`;
  }
  if (order.type === "dine_in") return order.table ? order.table.label : "Salão · sem mesa";
  return "Retirada no balcão";
}

/**
 * Três formas distintas: um valor, grátis (R$ 0,00) e "a combinar". Confundir
 * 0 com null esconde uma promoção ou entrega de graça por acidente.
 */
export function freightLine(
  order: Pick<Order, "type" | "deliveryFeeInCents">,
): { label: string; value: string } | null {
  if (order.type !== "delivery") return null;
  if (order.deliveryFeeInCents === null) return { label: "Frete a combinar", value: "a combinar" };
  if (order.deliveryFeeInCents === 0) return { label: "Entrega grátis", value: formatCents(0) };
  return { label: "Frete", value: formatCents(order.deliveryFeeInCents) };
}

/** Em entrega, `totalInCents` já inclui o frete; a linha "Itens" é o resto. */
export function itemsSubtotal(order: Pick<Order, "totalInCents" | "deliveryFeeInCents">): number {
  return order.totalInCents - (order.deliveryFeeInCents ?? 0);
}

export function groupOptions(
  options: readonly OrderItemOption[],
): { groupName: string; text: string }[] {
  const groups: { groupName: string; names: string[] }[] = [];
  for (const option of options) {
    let group = groups.find((candidate) => candidate.groupName === option.groupName);
    if (group === undefined) {
      group = { groupName: option.groupName, names: [] };
      groups.push(group);
    }
    group.names.push(option.quantity > 1 ? `${option.quantity}× ${option.name}` : option.name);
  }
  return groups.map((group) => ({ groupName: group.groupName, text: group.names.join(", ") }));
}

/** Tempo em âmbar: pedido novo, ou aberto há mais de 25 min. */
export function isUrgent(order: Pick<Order, "status" | "createdAt">, nowMs: number): boolean {
  if (isClosed(order.status)) return false;
  return order.status === "pending" || elapsedMinutes(order.createdAt, nowMs) > 25;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return phone;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ adiciona as regras de coluna, ação e cancelamento do pedido"
```

---

### Task 11: Dados de pedidos — API, filtros na URL e hooks

**Files:**
- Modify: `apps/panel/src/api/orders.ts`
- Create: `apps/panel/src/api/tables.ts`, `apps/panel/src/api/delivery.ts`, `apps/panel/src/features/orders/orderFilters.ts`, `apps/panel/src/features/orders/useOrders.ts`
- Test: `apps/panel/test/orderFilters.test.ts`, `apps/panel/test/orders-api.test.ts`

**Interfaces:**
- Consumes: `apiRequest`, `fetchAllPages` (Task 3); `rangeQuery`, `OrderRange` (Task 9); `ORDERS_POLL_MS` (Task 9).
- Produces:
  - `type OrderListQuery = OrderRange & { tableId?: string; sort: "createdAt" | "totalInCents"; order: "asc" | "desc" }`
  - `listAllOrders(restaurantId, query): Promise<Order[]>`, `getOrder(restaurantId, orderId): Promise<OrderDetail>`, `transitionOrder(restaurantId, orderId, transition: OrderTransition): Promise<OrderDetail>`
  - `listAllTables(restaurantId): Promise<Table[]>`, `listNeighborhoods(restaurantId): Promise<DeliveryNeighborhood[]>`
  - `PERIODS`, `type SortChoice`, `type OrderFilters = { period: Period | null; from: string | null; to: string | null; tableId: string | null; sort: SortChoice }`, `parseFilters(params)`, `filtersToParams(filters)`, `withPeriod(filters, period)`, `withRange(filters, from, to)`, `isRange(filters)`, `toListQuery(filters)`, `formatRangeLabel(from, to)`, `useOrderFilters(): [OrderFilters, (next: OrderFilters) => void]`
  - `useOrders(restaurantId, filters)` (chave `["orders", "list", …]`), `useOrder(restaurantId, orderId)` (`["orders", "detail", …]`), `useTables(restaurantId)`, `useDeliveryAlert(restaurantId, restaurant): boolean`

- [ ] **Step 1: Escrever os testes que falham**

`apps/panel/test/orderFilters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  filtersToParams,
  formatRangeLabel,
  isRange,
  parseFilters,
  toListQuery,
  withPeriod,
  withRange,
} from "../src/features/orders/orderFilters.ts";

describe("filtros de pedidos", () => {
  it("sem nada na URL: hoje, mais recentes, todas as mesas", () => {
    expect(parseFilters(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
  });

  it("intervalo vence o período — os dois nunca vão juntos", () => {
    const filters = parseFilters(new URLSearchParams("period=yesterday&from=2026-09-12&to=2026-09-17"));
    expect(filters.period).toBeNull();
    expect(isRange(filters)).toBe(true);
    expect(toListQuery(filters)).toEqual({
      from: "2026-09-12",
      to: "2026-09-17",
      tableId: undefined,
      sort: "createdAt",
      order: "desc",
    });
  });

  it("período inválido vira hoje", () => {
    expect(parseFilters(new URLSearchParams("period=ontem")).period).toBe("today");
  });

  it("escolher um desliga o outro", () => {
    const range = withRange(DEFAULT_FILTERS, "2026-09-12", "2026-09-17");
    expect(range.period).toBeNull();
    const back = withPeriod(range, "yesterday");
    expect(back).toMatchObject({ period: "yesterday", from: null, to: null });
  });

  it("a URL só carrega o que difere do padrão", () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("");
    expect(
      filtersToParams({ ...DEFAULT_FILTERS, period: "thisMonth", tableId: "t7", sort: "value" }).toString(),
    ).toBe("period=thisMonth&tableId=t7&sort=value");
  });

  it("'Maior valor' ordena por total", () => {
    expect(toListQuery({ ...DEFAULT_FILTERS, sort: "value" })).toMatchObject({
      period: "today",
      sort: "totalInCents",
      order: "desc",
    });
  });

  it("rótulo do intervalo", () => {
    expect(formatRangeLabel("2026-09-12", "2026-09-17")).toBe("12/09 – 17/09");
  });
});
```

`apps/panel/test/orders-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listAllOrders, transitionOrder } from "../src/api/orders.ts";
import { mockApi } from "./api-mock.ts";
import { makeOrder, makeOrderDetail, RESTAURANT_ID } from "./fixtures.ts";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;

describe("API de pedidos", () => {
  it("pagina de 100 em 100 até trazer tudo — pedido aberto antigo não some", async () => {
    const api = mockApi([
      {
        method: "GET",
        path: LIST,
        query: { offset: "0" },
        body: { data: Array.from({ length: 100 }, () => makeOrder()), limit: 100, offset: 0, total: 101 },
      },
      {
        method: "GET",
        path: LIST,
        query: { offset: "100" },
        body: { data: [makeOrder()], limit: 100, offset: 100, total: 101 },
      },
    ]);
    const orders = await listAllOrders(RESTAURANT_ID, { period: "today", sort: "createdAt", order: "desc" });
    expect(orders).toHaveLength(101);
    expect(api.calls[0].query).toEqual({
      period: "today",
      sort: "createdAt",
      order: "desc",
      limit: "100",
      offset: "0",
    });
  });

  it("intervalo manda from/to e nunca period", async () => {
    const api = mockApi([{ method: "GET", path: LIST, body: { data: [], limit: 100, offset: 0, total: 0 } }]);
    await listAllOrders(RESTAURANT_ID, { from: "2026-09-12", to: "2026-09-17", sort: "createdAt", order: "desc" });
    expect(api.calls[0].query.period).toBeUndefined();
    expect(api.calls[0].query).toMatchObject({ from: "2026-09-12", to: "2026-09-17" });
  });

  it("aceitar é o /confirm da API, sem corpo", async () => {
    const order = makeOrderDetail();
    const api = mockApi([{ method: "POST", path: `${LIST}/${order.id}/confirm`, body: order }]);
    await transitionOrder(RESTAURANT_ID, order.id, "accept");
    expect(api.calls[0].path).toBe(`${LIST}/${order.id}/confirm`);
    expect(api.calls[0].body).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- orderFilters orders-api`
Expected: FAIL — `listAllOrders` e `orderFilters.ts` não existem.

- [ ] **Step 3: Completar `api/orders.ts`**

Substitua o arquivo inteiro por:

```ts
import { apiRequest } from "./client.ts";
import { fetchAllPages } from "./pagination.ts";
import type {
  Order,
  OrderDetail,
  OrdersSummary,
  OrderTransition,
  Page,
  Period,
} from "./types.ts";

/** Período OU intervalo — a API responde 400 se receber os dois. */
export type OrderRange = { period: Period } | { from: string; to: string };

export type OrderListQuery = OrderRange & {
  tableId?: string;
  sort: "createdAt" | "totalInCents";
  order: "asc" | "desc";
};

export function rangeQuery(range: OrderRange): Record<string, string> {
  return "period" in range ? { period: range.period } : { from: range.from, to: range.to };
}

// "accept" é vocabulário do painel; na API a rota é /confirm.
const ENDPOINT: Record<OrderTransition, string> = {
  accept: "confirm",
  "start-preparing": "start-preparing",
  dispatch: "dispatch",
  ready: "ready",
  complete: "complete",
  cancel: "cancel",
};

/**
 * Todas as páginas, não só a primeira: com "mais recentes" num dia cheio, um
 * pedido aberto antigo cairia da página 1 e SUMIRIA do kanban.
 */
export function listAllOrders(restaurantId: string, query: OrderListQuery): Promise<Order[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<Order>>(`/restaurants/${restaurantId}/orders`, {
      query: {
        ...rangeQuery(query),
        tableId: query.tableId,
        sort: query.sort,
        order: query.order,
        limit: 100,
        offset,
      },
    }),
  );
}

export function getOrder(restaurantId: string, orderId: string): Promise<OrderDetail> {
  return apiRequest<OrderDetail>(`/restaurants/${restaurantId}/orders/${orderId}`);
}

export function transitionOrder(
  restaurantId: string,
  orderId: string,
  transition: OrderTransition,
): Promise<OrderDetail> {
  return apiRequest<OrderDetail>(
    `/restaurants/${restaurantId}/orders/${orderId}/${ENDPOINT[transition]}`,
    { method: "POST" },
  );
}

export function getOrdersSummary(restaurantId: string, range: OrderRange): Promise<OrdersSummary> {
  return apiRequest<OrdersSummary>(`/restaurants/${restaurantId}/orders/summary`, {
    query: rangeQuery(range),
  });
}
```

- [ ] **Step 4: Mesas e bairros**

`apps/panel/src/api/tables.ts`:

```ts
import { apiRequest } from "./client.ts";
import { fetchAllPages } from "./pagination.ts";
import type { Page, Table } from "./types.ts";

export function listAllTables(restaurantId: string): Promise<Table[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<Table>>(`/restaurants/${restaurantId}/tables`, { query: { limit: 100, offset } }),
  );
}
```

`apps/panel/src/api/delivery.ts`:

```ts
import { apiRequest } from "./client.ts";
import type { DeliveryNeighborhood } from "./types.ts";

export async function listNeighborhoods(restaurantId: string): Promise<DeliveryNeighborhood[]> {
  const result = await apiRequest<{ neighborhoods: DeliveryNeighborhood[] }>(
    `/restaurants/${restaurantId}/delivery-neighborhoods`,
  );
  return result.neighborhoods;
}
```

- [ ] **Step 5: Filtros**

`apps/panel/src/features/orders/orderFilters.ts`:

```ts
import { useSearchParams } from "react-router";
import type { OrderListQuery } from "../../api/orders.ts";
import type { Period } from "../../api/types.ts";

export const PERIODS: readonly { value: Period; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last7days", label: "Últimos 7 dias" },
  { value: "thisMonth", label: "Este mês" },
];

export type SortChoice = "recent" | "value";

/**
 * Período e intervalo são mutuamente exclusivos: quando um está ligado, o
 * outro é `null`. A API responde 400 aos dois juntos, e a UI nunca os deixa
 * ligados ao mesmo tempo (correção do handoff).
 */
export type OrderFilters = {
  period: Period | null;
  from: string | null;
  to: string | null;
  tableId: string | null;
  sort: SortChoice;
};

export const DEFAULT_FILTERS: OrderFilters = {
  period: "today",
  from: null,
  to: null,
  tableId: null,
  sort: "recent",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPeriod(value: string | null): value is Period {
  return PERIODS.some((period) => period.value === value);
}

export function parseFilters(params: URLSearchParams): OrderFilters {
  const from = params.get("from");
  const to = params.get("to");
  const tableId = params.get("tableId") || null;
  const sort: SortChoice = params.get("sort") === "value" ? "value" : "recent";
  if (from && to && DATE.test(from) && DATE.test(to)) {
    return { period: null, from, to, tableId, sort };
  }
  const period = params.get("period");
  return { period: isPeriod(period) ? period : "today", from: null, to: null, tableId, sort };
}

export function isRange(filters: OrderFilters): boolean {
  return filters.from !== null && filters.to !== null;
}

export function filtersToParams(filters: OrderFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.from !== null && filters.to !== null) {
    params.set("from", filters.from);
    params.set("to", filters.to);
  } else if (filters.period !== null && filters.period !== "today") {
    params.set("period", filters.period);
  }
  if (filters.tableId !== null) params.set("tableId", filters.tableId);
  if (filters.sort === "value") params.set("sort", "value");
  return params;
}

export function withPeriod(filters: OrderFilters, period: Period): OrderFilters {
  return { ...filters, period, from: null, to: null };
}

export function withRange(filters: OrderFilters, from: string, to: string): OrderFilters {
  return { ...filters, period: null, from, to };
}

export function toListQuery(filters: OrderFilters): OrderListQuery {
  const range =
    filters.from !== null && filters.to !== null
      ? { from: filters.from, to: filters.to }
      : { period: filters.period ?? "today" };
  return {
    ...range,
    tableId: filters.tableId ?? undefined,
    sort: filters.sort === "value" ? "totalInCents" : "createdAt",
    order: "desc",
  };
}

/** "2026-09-12" + "2026-09-17" → "12/09 – 17/09". */
export function formatRangeLabel(from: string, to: string): string {
  const short = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  return `${short(from)} – ${short(to)}`;
}

/** Os filtros moram na URL: sobrevivem ao recarregar e dá para mandar o link. */
export function useOrderFilters(): [OrderFilters, (next: OrderFilters) => void] {
  const [params, setParams] = useSearchParams();
  return [parseFilters(params), (next) => setParams(filtersToParams(next))];
}
```

- [ ] **Step 6: Hooks**

`apps/panel/src/features/orders/useOrders.ts`:

```ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listNeighborhoods } from "../../api/delivery.ts";
import { getOrder, listAllOrders } from "../../api/orders.ts";
import { listAllTables } from "../../api/tables.ts";
import type { Restaurant } from "../../api/types.ts";
import { type OrderFilters, toListQuery } from "./orderFilters.ts";
import { ORDERS_POLL_MS } from "./polling.ts";

/**
 * Polling também com a aba em segundo plano: o painel passa o dia atrás de
 * outras janelas, e ninguém vai apertar F5.
 */
export function useOrders(restaurantId: string, filters: OrderFilters) {
  const query = toListQuery(filters);
  return useQuery({
    queryKey: ["orders", "list", restaurantId, query],
    queryFn: () => listAllOrders(restaurantId, query),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
  });
}

export function useOrder(restaurantId: string, orderId: string) {
  return useQuery({
    queryKey: ["orders", "detail", restaurantId, orderId],
    queryFn: () => getOrder(restaurantId, orderId),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

export function useTables(restaurantId: string) {
  return useQuery({
    queryKey: ["tables", restaurantId],
    queryFn: () => listAllTables(restaurantId),
    staleTime: 5 * 60_000,
  });
}

/**
 * "Entrega por bairro sem nenhum bairro cadastrado": não é frete grátis — a
 * loja recusa pedidos de entrega sem ninguém perceber. Por isso vira alerta
 * persistente em Pedidos, e não erro de formulário (correção do handoff).
 */
export function useDeliveryAlert(restaurantId: string, restaurant: Restaurant | undefined): boolean {
  const byNeighborhood = restaurant?.isDelivery === true && restaurant.deliveryFeeMode === "neighborhood";
  const neighborhoods = useQuery({
    queryKey: ["delivery-neighborhoods", restaurantId],
    queryFn: () => listNeighborhoods(restaurantId),
    enabled: byNeighborhood,
    staleTime: 60_000,
  });
  return byNeighborhood && neighborhoods.data !== undefined && neighborhoods.data.length === 0;
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ busca pedidos com filtros na url e polling em segundo plano"
```

---

### Task 12: Kanban de pedidos

**Files:**
- Create: `apps/panel/src/features/orders/OrdersPage.tsx`, `OrdersPage.module.css`, `FilterBar.tsx`, `FilterBar.module.css`, `Kanban.tsx`, `Kanban.module.css`, `OrderCard.tsx`, `OrderCard.module.css`, `TypePill.tsx`, `TypePill.module.css`, `OrdersNotices.tsx`
- Modify: `apps/panel/src/router.tsx`
- Test: `apps/panel/test/orders-page.test.tsx`

**Interfaces:**
- Consumes: hooks da Task 11; `useRestaurant` (Task 9); `useSessionUser` (Task 5); `useNow`, `useOnline`, `formatElapsed`, `formatSecondsAgo`, `formatAge` (Task 2); `NetworkError` (Task 3); regras e apresentação (Task 10); `Notice` (Task 6).
- Produces: `OrdersPage` (renderiza `<Outlet />` para o drawer da Task 14), `Kanban({ orders, loading, now, onOpen })`, `OrderCard({ order, now, onOpen })`, `TypePill({ order })`, `FilterBar({ filters, onChange, tables, syncLabel })`, `DeliveryAlert`, `OfflineNotice({ updatedAt, now, onRetry })`, `EmptyOrders`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/orders-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "../src/api/types.ts";
import { OrdersPage } from "../src/features/orders/OrdersPage.tsx";
import { orderCode } from "../src/lib/orderCode.ts";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOrder, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;

function listHandler(orders: Order[]): MockHandler {
  return { method: "GET", path: LIST, body: { data: orders, limit: 100, offset: 0, total: orders.length } };
}

const noTables: MockHandler = {
  method: "GET",
  path: `/restaurants/${RESTAURANT_ID}/tables`,
  body: { data: [], limit: 100, offset: 0, total: 0 },
};

const routes = [
  {
    path: "/pedidos",
    element: <OrdersPage />,
    children: [{ path: ":orderId", element: <LocationProbe /> }],
  },
];

function card(order: Order) {
  return screen.getByRole("article", { name: `Pedido ${orderCode(order.id)}` });
}

describe("OrdersPage", () => {
  it("distribui os pedidos nas colunas pela ação que cada um pede", async () => {
    signIn();
    const pending = makeOrder({ status: "pending" });
    const preparing = makeOrder({ status: "preparing", type: "takeaway", deliveryAddress: null });
    const out = makeOrder({ status: "out_for_delivery" });
    const cancelled = makeOrder({ status: "cancelled" });
    mockApi([listHandler([pending, preparing, out, cancelled]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");

    const novos = await screen.findByRole("region", { name: "Novos" });
    expect(within(novos).getByRole("article", { name: `Pedido ${orderCode(pending.id)}` })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Em preparo" })).getByRole("article", {
        name: `Pedido ${orderCode(preparing.id)}`,
      }),
    ).toBeTruthy();
    const prontos = screen.getByRole("region", { name: "Prontos" });
    expect(within(prontos).getByText("Entrega · Saiu para entrega")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Finalizados" })).getByRole("article", {
        name: `Pedido ${orderCode(cancelled.id)}`,
      }),
    ).toBeTruthy();
    expect(within(card(pending)).getByText("R$ 101,00")).toBeTruthy();
  });

  it("coluna vazia diz o que significa", async () => {
    signIn();
    mockApi([listHandler([makeOrder({ status: "pending" })]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");
    const preparo = await screen.findByRole("region", { name: "Em preparo" });
    expect(await within(preparo).findByText("A cozinha está livre.")).toBeTruthy();
  });

  it("dia sem pedido tranquiliza em vez de parecer quebrado", async () => {
    signIn();
    mockApi([listHandler([]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");
    expect(await screen.findByText("Nenhum pedido ainda hoje")).toBeTruthy();
    expect(
      screen.getByText(
        "A tela se atualiza sozinha e avisa com som quando o primeiro chegar. Não é preciso recarregar.",
      ),
    ).toBeTruthy();
  });

  it("intervalo de datas desliga o período, na tela e na requisição", async () => {
    signIn();
    const api = mockApi([listHandler([]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos?from=2026-09-12&to=2026-09-17");
    expect(await screen.findByText("12/09 – 17/09 · limpar")).toBeTruthy();
    expect(
      screen.getByText("Intervalo de datas ativo — o filtro por período fica desligado. Os dois não se combinam."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hoje" }).getAttribute("aria-pressed")).toBe("false");
    const listCall = api.calls.find((call) => call.path === LIST);
    expect(listCall?.query).toMatchObject({ from: "2026-09-12", to: "2026-09-17" });
    expect(listCall?.query.period).toBeUndefined();
  });

  it("trocar o período refaz a busca", async () => {
    signIn();
    const api = mockApi([listHandler([]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");
    fireEvent.click(await screen.findByRole("button", { name: "Ontem" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === LIST && call.query.period === "yesterday")).toBe(true),
    );
  });

  it("clicar no cartão abre o detalhe, preservando os filtros", async () => {
    signIn();
    const order = makeOrder({ status: "completed" });
    mockApi([listHandler([order]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos?period=yesterday");
    fireEvent.click(await screen.findByRole("article", { name: `Pedido ${orderCode(order.id)}` }));
    expect((await screen.findByTestId("location")).textContent).toBe(`/pedidos/${order.id}?period=yesterday`);
  });

  it("entrega por bairro sem bairro vira alerta persistente", async () => {
    signIn();
    mockApi([
      listHandler([]),
      noTables,
      { method: "GET", path: `/restaurants/${RESTAURANT_ID}/delivery-neighborhoods`, body: { neighborhoods: [] } },
      ...panelHandlers({ restaurant: { isDelivery: true, deliveryFeeMode: "neighborhood" } }),
    ]);
    renderInPanel(routes, "/pedidos");
    expect(await screen.findByText("Entrega por bairro sem nenhum bairro cadastrado")).toBeTruthy();
    expect(
      screen.getByText(
        "Não é frete grátis: a loja não consegue calcular o frete e vai recusar pedidos de entrega. Cadastre os bairros ou mude para taxa fixa.",
      ),
    ).toBeTruthy();
  });

  it("sem internet, avisa que a lista pode estar velha", async () => {
    signIn();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mockApi([listHandler([]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");
    expect(await screen.findByText("Sem internet")).toBeTruthy();
  });

  it("filtro de mesa só aparece quando a loja tem mesas", async () => {
    signIn();
    mockApi([
      listHandler([]),
      {
        method: "GET",
        path: `/restaurants/${RESTAURANT_ID}/tables`,
        body: {
          data: [{ id: "t7", restaurantId: RESTAURANT_ID, label: "Mesa 7", hash: "h", qrUrl: "u" }],
          limit: 100,
          offset: 0,
          total: 1,
        },
      },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    const select = await screen.findByLabelText("Mesa");
    expect(within(select).getByText("Mesa 7")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- orders-page`
Expected: FAIL — `OrdersPage.tsx` não existe.

- [ ] **Step 3: `TypePill`**

`apps/panel/src/features/orders/TypePill.module.css`:

```css
.pill {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 9px;
  border: 1px solid var(--mc-line);
  border-radius: 999px;
  color: var(--mc-ink2);
  font-size: 12px;
  font-weight: 600;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
}

.delivery {
  background: var(--mc-accent);
}

.takeaway {
  background: var(--mc-pickup);
}

.dine_in {
  background: var(--mc-warn-strong);
}
```

`apps/panel/src/features/orders/TypePill.tsx`:

```tsx
import type { Order } from "../../api/types.ts";
import { stageLabel, typeLabel } from "./presentation.ts";
import classes from "./TypePill.module.css";

/** Modalidade (e, na coluna Prontos, o estágio): é ela que decide o vocabulário. */
export function TypePill({ order }: { order: Pick<Order, "type" | "status"> }) {
  const stage = stageLabel(order.status);
  return (
    <span className={classes.pill}>
      <span className={`${classes.dot} ${classes[order.type]}`} aria-hidden="true" />
      {stage ? `${typeLabel(order.type)} · ${stage}` : typeLabel(order.type)}
    </span>
  );
}
```

- [ ] **Step 4: `OrderCard` e `Kanban`**

`apps/panel/src/features/orders/OrderCard.module.css`:

```css
.card {
  display: grid;
  gap: 8px;
  padding: 14px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-left: 3px solid var(--mc-line);
  border-radius: 6px;
  cursor: pointer;
}

.card:hover {
  border-top-color: var(--mc-line-hi);
  border-right-color: var(--mc-line-hi);
  border-bottom-color: var(--mc-line-hi);
}

.state_pending {
  border-color: var(--mc-warn-line);
  border-left-color: var(--mc-warn-strong);
}

.state_confirmed,
.state_preparing {
  border-left-color: var(--mc-line-hi);
}

.state_out_for_delivery,
.state_ready_for_pickup {
  border-left-color: var(--mc-accent);
}

.state_cancelled {
  border-left-color: var(--mc-danger-line);
}

.state_completed {
  border-left-color: var(--mc-line);
}

.topRow {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
}

.code {
  font-weight: 700;
  color: var(--mc-ink3);
}

.time {
  font-weight: 600;
  color: var(--mc-ink3);
}

.timeWarn {
  color: var(--mc-warn);
}

.name {
  overflow: hidden;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.moneyRow {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.payment {
  font-size: 12.5px;
  color: var(--mc-ink2);
}

.total {
  font-size: 18px;
  font-weight: 700;
}

.actions {
  display: flex;
  gap: 8px;
}
```

`apps/panel/src/features/orders/OrderCard.tsx`:

```tsx
import type { Order } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import { orderCode } from "../../lib/orderCode.ts";
import { formatElapsed } from "../../lib/time.ts";
import classes from "./OrderCard.module.css";
import { displayName } from "./orderRules.ts";
import { isUrgent, paymentLabel } from "./presentation.ts";
import { TypePill } from "./TypePill.tsx";

export function OrderCard({
  order,
  now,
  onOpen,
}: {
  order: Order;
  now: number;
  onOpen: (orderId: string) => void;
}) {
  const code = orderCode(order.id);
  return (
    <article
      className={`${classes.card} ${classes[`state_${order.status}`]}`}
      aria-label={`Pedido ${code}`}
      tabIndex={0}
      onClick={() => onOpen(order.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(order.id);
      }}
    >
      <div className={classes.topRow}>
        <span className={`${classes.code} n`}>{code}</span>
        <span className={`${classes.time} ${isUrgent(order, now) ? classes.timeWarn : ""} n`}>
          {formatElapsed(order.createdAt, now)}
        </span>
      </div>
      <strong className={classes.name}>{displayName(order)}</strong>
      <TypePill order={order} />
      <div className={classes.moneyRow}>
        <span className={classes.payment}>{paymentLabel(order)}</span>
        <span className={`${classes.total} n`}>{formatCents(order.totalInCents)}</span>
      </div>
    </article>
  );
}
```

`apps/panel/src/features/orders/Kanban.module.css`:

```css
.board {
  display: grid;
  grid-template-columns: repeat(4, minmax(268px, 1fr));
  gap: 12px;
  align-items: start;
  overflow-x: auto;
  padding: 0 20px 20px;
}

.column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-height: calc(100vh - 210px);
  background: var(--mc-surface2);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--mc-line);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.dot_new {
  background: var(--mc-warn-strong);
}

.dot_preparing {
  background: var(--mc-ink3);
}

.dot_ready {
  background: var(--mc-accent);
}

.dot_done {
  background: var(--mc-line-hi);
}

.title {
  flex: 1 1 auto;
  margin: 0;
  font-size: 13.5px;
  font-weight: 700;
}

.count {
  min-width: 24px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--mc-surface3);
  color: var(--mc-ink2);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.countWarn {
  background: var(--mc-warn-soft);
  color: var(--mc-warn);
}

.body {
  display: grid;
  gap: 10px;
  padding: 10px;
  overflow-y: auto;
}

.empty {
  margin: 16px 0;
  font-size: 13px;
  color: var(--mc-ink3);
  text-align: center;
}

.skeleton {
  display: grid;
  gap: 8px;
  padding: 14px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 6px;
}

.bar {
  border-radius: 4px;
  background: var(--mc-surface3);
}
```

`apps/panel/src/features/orders/Kanban.tsx`:

```tsx
import type { Order } from "../../api/types.ts";
import classes from "./Kanban.module.css";
import { OrderCard } from "./OrderCard.tsx";
import { COLUMNS, groupByColumn } from "./orderRules.ts";

/** Esqueleto SEM animação: três barras de 11/15/11 px (handoff). */
function CardSkeleton() {
  return (
    <div className={classes.skeleton} aria-hidden="true">
      <span className={classes.bar} style={{ height: 11, width: "45%" }} />
      <span className={classes.bar} style={{ height: 15, width: "75%" }} />
      <span className={classes.bar} style={{ height: 11, width: "60%" }} />
    </div>
  );
}

export function Kanban({
  orders,
  loading,
  now,
  onOpen,
}: {
  orders: readonly Order[];
  loading: boolean;
  now: number;
  onOpen: (orderId: string) => void;
}) {
  const groups = groupByColumn(orders);
  return (
    <div className={classes.board}>
      {COLUMNS.map((column) => {
        const items = groups[column.id];
        const warn = column.id === "new" && items.length > 0;
        return (
          <section key={column.id} className={classes.column} aria-label={column.title}>
            <header className={classes.header}>
              <span className={`${classes.dot} ${classes[`dot_${column.id}`]}`} aria-hidden="true" />
              <h2 className={classes.title}>{column.title}</h2>
              <span className={`${classes.count} ${warn ? classes.countWarn : ""} n`}>
                {loading ? "—" : items.length}
              </span>
            </header>
            <div className={classes.body}>
              {loading ? (
                <>
                  <CardSkeleton />
                  <CardSkeleton />
                </>
              ) : items.length === 0 ? (
                <p className={classes.empty}>{column.empty}</p>
              ) : (
                items.map((order) => <OrderCard key={order.id} order={order} now={now} onOpen={onOpen} />)
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Barra de filtros**

`apps/panel/src/features/orders/FilterBar.module.css`:

```css
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 14px;
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

.dashed {
  height: 36px;
  padding: 0 12px;
  border: 1px dashed var(--mc-line-hi);
  border-radius: 6px;
  background: transparent;
  color: var(--mc-ink2);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.dashedActive {
  border-style: solid;
  border-color: var(--mc-accent-line);
  background: var(--mc-accent-soft);
  color: var(--mc-accent-hi);
}

.tableActive {
  background: var(--mc-accent-soft);
  border-color: var(--mc-accent-line);
}

.rangeForm {
  display: grid;
  gap: 10px;
  min-width: 220px;
}

.right {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.sync {
  font-size: 12.5px;
  color: var(--mc-ink3);
}

.rangeNote {
  margin: -6px 20px 12px;
  font-size: 12.5px;
  color: var(--mc-ink3);
}
```

`apps/panel/src/features/orders/FilterBar.tsx`:

```tsx
import { Button, NativeSelect, Popover, TextInput } from "@mantine/core";
import { useState } from "react";
import type { Table } from "../../api/types.ts";
import classes from "./FilterBar.module.css";
import {
  formatRangeLabel,
  type OrderFilters,
  PERIODS,
  withPeriod,
  withRange,
} from "./orderFilters.ts";

export function FilterBar({
  filters,
  onChange,
  tables,
  syncLabel,
}: {
  filters: OrderFilters;
  onChange: (next: OrderFilters) => void;
  tables: readonly Table[];
  syncLabel: string;
}) {
  const [rangeOpen, setRangeOpen] = useState(false);
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const rangeLabel =
    filters.from !== null && filters.to !== null ? formatRangeLabel(filters.from, filters.to) : null;

  return (
    <>
      <div className={classes.bar}>
        <div className={classes.segmented} role="group" aria-label="Período">
          {PERIODS.map((period) => (
            <button
              key={period.value}
              type="button"
              className={classes.segment}
              aria-pressed={filters.period === period.value}
              onClick={() => onChange(withPeriod(filters, period.value))}
            >
              {period.label}
            </button>
          ))}
        </div>

        {rangeLabel !== null ? (
          <button
            type="button"
            className={`${classes.dashed} ${classes.dashedActive}`}
            onClick={() => onChange(withPeriod(filters, "today"))}
          >
            {rangeLabel} · limpar
          </button>
        ) : (
          <Popover opened={rangeOpen} onChange={setRangeOpen} position="bottom-start">
            <Popover.Target>
              <button type="button" className={classes.dashed} onClick={() => setRangeOpen((open) => !open)}>
                Intervalo de datas
              </button>
            </Popover.Target>
            <Popover.Dropdown>
              <div className={classes.rangeForm}>
                <TextInput type="date" label="De" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
                <TextInput type="date" label="Até" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
                <Button
                  disabled={from === "" || to === "" || from > to}
                  onClick={() => {
                    onChange(withRange(filters, from, to));
                    setRangeOpen(false);
                  }}
                >
                  Aplicar
                </Button>
              </div>
            </Popover.Dropdown>
          </Popover>
        )}

        {tables.length > 0 && (
          <NativeSelect
            aria-label="Mesa"
            classNames={{ input: filters.tableId !== null ? classes.tableActive : undefined }}
            value={filters.tableId ?? ""}
            onChange={(event) => onChange({ ...filters, tableId: event.currentTarget.value || null })}
            data={[
              { value: "", label: "Todas as mesas" },
              ...tables.map((table) => ({ value: table.id, label: table.label })),
            ]}
          />
        )}

        <div className={classes.right}>
          <span className={`${classes.sync} n`}>{syncLabel}</span>
          <NativeSelect
            aria-label="Ordenação"
            value={filters.sort}
            onChange={(event) =>
              onChange({ ...filters, sort: event.currentTarget.value === "value" ? "value" : "recent" })
            }
            data={[
              { value: "recent", label: "Mais recentes" },
              { value: "value", label: "Maior valor" },
            ]}
          />
        </div>
      </div>
      {rangeLabel !== null && (
        <p className={classes.rangeNote}>
          Intervalo de datas ativo — o filtro por período fica desligado. Os dois não se combinam.
        </p>
      )}
    </>
  );
}
```

- [ ] **Step 6: Avisos da tela**

`apps/panel/src/features/orders/OrdersPage.module.css`:

```css
.page {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.notice {
  margin: 16px 20px 0;
}

.noticeRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.empty {
  display: grid;
  gap: 6px;
  justify-items: start;
  margin: 0 20px 20px;
  padding: 32px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.emptyTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.emptyBody {
  margin: 0;
  max-width: 60ch;
  color: var(--mc-ink2);
}
```

`apps/panel/src/features/orders/OrdersNotices.tsx`:

```tsx
import { Button } from "@mantine/core";
import { formatAge } from "../../lib/time.ts";
import { Notice } from "../../ui/Notice.tsx";
import classes from "./OrdersPage.module.css";

export function DeliveryAlert() {
  // O botão "Configurar entrega" do handoff entra com a tela de Entrega (parte 2).
  return (
    <div className={classes.notice}>
      <Notice tone="warn" title="Entrega por bairro sem nenhum bairro cadastrado">
        Não é frete grátis: a loja não consegue calcular o frete e vai recusar pedidos de entrega.
        Cadastre os bairros ou mude para taxa fixa.
      </Notice>
    </div>
  );
}

export function OfflineNotice({
  updatedAt,
  now,
  onRetry,
}: {
  updatedAt: number;
  now: number;
  onRetry: () => void;
}) {
  const age = updatedAt > 0 ? `A lista abaixo é de ${formatAge((now - updatedAt) / 1000)} atrás e pode estar desatualizada.` : "A lista ainda não carregou.";
  return (
    <div className={classes.notice}>
      <Notice tone="warn" title="Sem internet">
        <div className={classes.noticeRow}>
          <span>
            {age} Aceitar e despachar ficam bloqueados até a conexão voltar — assim nada é aceito duas
            vezes.
          </span>
          <Button variant="default" onClick={onRetry}>
            Tentar de novo
          </Button>
        </div>
      </Notice>
    </div>
  );
}

export function EmptyOrders() {
  return (
    <div className={classes.empty}>
      <p className={classes.emptyTitle}>Nenhum pedido ainda hoje</p>
      <p className={classes.emptyBody}>
        A tela se atualiza sozinha e avisa com som quando o primeiro chegar. Não é preciso recarregar.
      </p>
    </div>
  );
}
```

- [ ] **Step 7: `OrdersPage`**

`apps/panel/src/features/orders/OrdersPage.tsx`:

```tsx
import { Outlet, useLocation, useNavigate } from "react-router";
import { NetworkError } from "../../api/client.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { formatSecondsAgo } from "../../lib/time.ts";
import { useNow } from "../../lib/useNow.ts";
import { useOnline } from "../../lib/useOnline.ts";
import { useRestaurant } from "../restaurant/useRestaurant.ts";
import { FilterBar } from "./FilterBar.tsx";
import { Kanban } from "./Kanban.tsx";
import { isRange, useOrderFilters } from "./orderFilters.ts";
import { DeliveryAlert, EmptyOrders, OfflineNotice } from "./OrdersNotices.tsx";
import classes from "./OrdersPage.module.css";
import { useDeliveryAlert, useOrders, useTables } from "./useOrders.ts";

export function OrdersPage() {
  const me = useSessionUser();
  const restaurant = useRestaurant(me.restaurantId);
  const [filters, setFilters] = useOrderFilters();
  const orders = useOrders(me.restaurantId, filters);
  const tables = useTables(me.restaurantId);
  const deliveryAlert = useDeliveryAlert(me.restaurantId, restaurant.data);
  const online = useOnline();
  const now = useNow();
  const navigate = useNavigate();
  const location = useLocation();

  const offline = !online || orders.error instanceof NetworkError;
  const list = orders.data ?? [];
  const showEmpty =
    !orders.isPending &&
    list.length === 0 &&
    filters.period === "today" &&
    !isRange(filters) &&
    filters.tableId === null;

  const openOrder = (orderId: string) =>
    navigate({ pathname: `/pedidos/${orderId}`, search: location.search });

  return (
    <div className={classes.page}>
      {offline && (
        <OfflineNotice updatedAt={orders.dataUpdatedAt} now={now} onRetry={() => void orders.refetch()} />
      )}
      {deliveryAlert && <DeliveryAlert />}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        tables={tables.data ?? []}
        syncLabel={
          orders.isPending
            ? "Carregando pedidos…"
            : `Atualiza sozinho · ${formatSecondsAgo(orders.dataUpdatedAt, now)}`
        }
      />
      {showEmpty ? (
        <EmptyOrders />
      ) : (
        <Kanban orders={list} loading={orders.isPending} now={now} onOpen={openOrder} />
      )}
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 8: Rota**

Em `apps/panel/src/router.tsx`, importe `OrdersPage` e troque o placeholder de `/pedidos`:

```tsx
import { OrdersPage } from "./features/orders/OrdersPage.tsx";
```

```tsx
              { path: "/pedidos", handle: { title: "Pedidos" }, element: <OrdersPage /> },
```

Se `Placeholder` ficar sem uso no `router.tsx`, apague a função.

- [ ] **Step 9: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ adiciona o kanban de pedidos com filtros e avisos"
```

---

### Task 13: Ações do pedido e confirmações

**Files:**
- Create: `apps/panel/src/ui/ConfirmDialog.tsx`, `ConfirmDialog.module.css`, `buttons.module.css`, `apps/panel/src/features/orders/orderActionFlow.tsx`
- Modify: `apps/panel/src/features/orders/OrderCard.tsx`, `apps/panel/src/features/orders/OrdersPage.tsx`
- Test: `apps/panel/test/order-actions.test.tsx`

**Interfaces:**
- Consumes: `transitionOrder` (Task 11); `acceptCopy`, `cancelCopy`, `primaryAction` (Task 10); `ConfirmCopy` (Task 10).
- Produces:
  - `ConfirmDialog({ copy: ConfirmCopy | null; busy?: boolean; onConfirm; onClose })`
  - `buttons.module.css` → `.danger`, `.dangerText`
  - `OrderActionProvider({ restaurantId, disabled, children })`, `useOrderAction(): { request(order, transition); busyOrderId: string | null; disabled: boolean }`

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/order-actions.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "../src/api/types.ts";
import { OrdersPage } from "../src/features/orders/OrdersPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOrder, makeOrderDetail, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;
const ID = "a3f9c2d1-0000-4000-8000-000000000001";

function listHandler(orders: Order[], once = false): MockHandler {
  return { method: "GET", path: LIST, once, body: { data: orders, limit: 100, offset: 0, total: orders.length } };
}

const noTables: MockHandler = {
  method: "GET",
  path: `/restaurants/${RESTAURANT_ID}/tables`,
  body: { data: [], limit: 100, offset: 0, total: 0 },
};

const routes = [
  { path: "/pedidos", element: <OrdersPage />, children: [{ path: ":orderId", element: <LocationProbe /> }] },
  { path: "/produtos", element: <LocationProbe /> },
];

function cardOf(code: string) {
  return screen.findByRole("article", { name: `Pedido ${code}` });
}

describe("ações do pedido", () => {
  it("recusar pedido novo pede confirmação com o texto de recusa, e não abre o detalhe", async () => {
    signIn();
    const api = mockApi([
      { method: "POST", path: `${LIST}/${ID}/cancel`, body: makeOrderDetail({ id: ID, status: "cancelled" }) },
      listHandler([makeOrder({ id: ID, status: "pending" })]),
      noTables,
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    fireEvent.click(within(await cardOf("#A3F9")).getByRole("button", { name: "Recusar" }));
    const dialog = await screen.findByRole("dialog", { name: "Recusar o pedido #A3F9?" });
    expect(
      within(dialog).getByText("O pedido sai da lista. O estoque não tinha sido baixado, então nada muda nele."),
    ).toBeTruthy();
    expect(screen.queryByTestId("location")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Recusar pedido" }));
    await waitFor(() => expect(api.calls.some((call) => call.path === `${LIST}/${ID}/cancel`)).toBe(true));
  });

  it("aceitar confirma e encadeia o preparo; se o preparo falhar, 'Começar preparo' é a rede", async () => {
    signIn();
    const api = mockApi([
      { method: "POST", path: `${LIST}/${ID}/confirm`, body: makeOrderDetail({ id: ID, status: "confirmed" }) },
      { method: "POST", path: `${LIST}/${ID}/start-preparing`, status: 409, body: { message: "Transição inválida" } },
      listHandler([makeOrder({ id: ID, status: "pending" })], true),
      listHandler([makeOrder({ id: ID, status: "confirmed" })]),
      noTables,
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    fireEvent.click(within(await cardOf("#A3F9")).getByRole("button", { name: "Aceitar" }));
    const dialog = await screen.findByRole("dialog", { name: "Aceitar o pedido #A3F9?" });
    expect(within(dialog).getByText("Não existe desconfirmar. Depois de aceito, só cabe cancelar.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Aceitar pedido" }));

    const preparo = screen.getByRole("region", { name: "Em preparo" });
    expect(await within(preparo).findByRole("button", { name: "Começar preparo" })).toBeTruthy();
    expect(api.calls.map((call) => call.path)).toEqual(
      expect.arrayContaining([`${LIST}/${ID}/confirm`, `${LIST}/${ID}/start-preparing`]),
    );
  });

  it("estoque acabou ao aceitar: explica e oferece repor ou recusar", async () => {
    signIn();
    mockApi([
      {
        method: "POST",
        path: `${LIST}/${ID}/confirm`,
        status: 409,
        body: { message: 'Estoque insuficiente de "Pizza Grande": 3 pedidos, 2 disponíveis' },
      },
      listHandler([makeOrder({ id: ID, status: "pending" })]),
      noTables,
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    fireEvent.click(within(await cardOf("#A3F9")).getByRole("button", { name: "Aceitar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Aceitar pedido" }));
    const dialog = await screen.findByRole("dialog", { name: "Estoque acabou ao aceitar" });
    expect(
      within(dialog).getByText(
        'Estoque insuficiente de "Pizza Grande": 3 pedidos, 2 disponíveis. O pedido não foi aceito e o estoque não mudou. Reponha o estoque ou recuse explicando ao cliente.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Recusar pedido" }));
    expect(await screen.findByRole("dialog", { name: "Recusar o pedido #A3F9?" })).toBeTruthy();
  });

  it("despachar não pede confirmação", async () => {
    signIn();
    const api = mockApi([
      { method: "POST", path: `${LIST}/${ID}/dispatch`, body: makeOrderDetail({ id: ID, status: "out_for_delivery" }) },
      listHandler([makeOrder({ id: ID, status: "preparing", type: "delivery" })]),
      noTables,
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    fireEvent.click(within(await cardOf("#A3F9")).getByRole("button", { name: "Despachar" }));
    await waitFor(() => expect(api.calls.some((call) => call.path === `${LIST}/${ID}/dispatch`)).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sem internet, as ações ficam travadas", async () => {
    signIn();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mockApi([listHandler([makeOrder({ id: ID, status: "pending" })]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");
    const accept = within(await cardOf("#A3F9")).getByRole("button", { name: "Aceitar" });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- order-actions`
Expected: FAIL — o cartão não tem botões ("Unable to find role button name Recusar").

- [ ] **Step 3: Botões e modal de confirmação**

`apps/panel/src/ui/buttons.module.css`:

```css
/* Destrutivo em fundo suave: o vermelho é reservado a isso (handoff). */
.danger,
.danger:hover {
  background: var(--mc-danger-soft);
  border: 1px solid var(--mc-danger-line);
  color: var(--mc-danger);
}

.dangerText,
.dangerText:hover {
  color: var(--mc-danger);
}

.dangerText:hover {
  background: var(--mc-danger-soft);
}
```

`apps/panel/src/ui/ConfirmDialog.module.css`:

```css
.overlay {
  background: var(--mc-overlay);
}

.title {
  font-size: 18px;
  font-weight: 700;
}

.body {
  display: grid;
  gap: 12px;
}

.text {
  margin: 0;
  font-size: 14px;
  color: var(--mc-ink2);
}

.warn {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--mc-warn-soft);
  color: var(--mc-warn);
  font-size: 13.5px;
  font-weight: 700;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
```

`apps/panel/src/ui/ConfirmDialog.tsx`:

```tsx
import { Button, Modal } from "@mantine/core";
import buttons from "./buttons.module.css";
import classes from "./ConfirmDialog.module.css";
import type { ConfirmCopy } from "./confirmCopy.ts";

export function ConfirmDialog({
  copy,
  busy = false,
  onConfirm,
  onClose,
}: {
  copy: ConfirmCopy | null;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={copy !== null}
      onClose={onClose}
      title={copy?.title}
      centered
      size={460}
      radius="md"
      classNames={{ title: classes.title, overlay: classes.overlay }}
    >
      {copy && (
        <div className={classes.body}>
          <p className={classes.text}>{copy.body}</p>
          {copy.warn && <p className={classes.warn}>{copy.warn}</p>}
          <div className={classes.actions}>
            <Button variant="default" h={40} disabled={busy} onClick={onClose}>
              Voltar
            </Button>
            <Button
              h={40}
              className={copy.tone === "danger" ? buttons.danger : undefined}
              loading={busy}
              onClick={onConfirm}
            >
              {copy.cta}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: O fluxo das ações**

`apps/panel/src/features/orders/orderActionFlow.tsx`:

```tsx
import { Button, Modal } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError, describeError } from "../../api/client.ts";
import { transitionOrder } from "../../api/orders.ts";
import type { Order, OrderTransition } from "../../api/types.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import dialog from "../../ui/ConfirmDialog.module.css";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";
import { acceptCopy, cancelCopy } from "./orderRules.ts";

type ActionRequest = { order: Order; transition: OrderTransition };
type Failure = { order: Order; message: string; stock: boolean };

type OrderActionValue = {
  request: (order: Order, transition: OrderTransition) => void;
  busyOrderId: string | null;
  disabled: boolean;
};

const OrderActionContext = createContext<OrderActionValue | null>(null);

export function useOrderAction(): OrderActionValue {
  const value = useContext(OrderActionContext);
  if (value === null) throw new Error("useOrderAction fora do OrderActionProvider");
  return value;
}

// A API não devolve código de erro, só mensagem (pt-BR, escrita pelo serviço
// de pedidos). O texto é o único jeito de separar "o estoque acabou" de "outro
// aparelho já mexeu neste pedido" — se a mensagem mudar na API, o diálogo de
// estoque vira o de erro genérico, sem quebrar nada.
const STOCK_MESSAGE = /^Estoque insuficiente/;

/**
 * Um lugar só para aceitar, avançar e cancelar — o cartão e o drawer pedem
 * por aqui. Aceitar e cancelar sempre confirmam; o resto é um clique.
 */
export function OrderActionProvider({
  restaurantId,
  disabled,
  children,
}: {
  restaurantId: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<ActionRequest | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ order, transition }: ActionRequest) => {
      if (transition !== "accept") {
        await transitionOrder(restaurantId, order.id, transition);
        return;
      }
      // O handoff tem UM clique entre Novo e Em preparo; a API tem duas etapas.
      await transitionOrder(restaurantId, order.id, "accept");
      try {
        await transitionOrder(restaurantId, order.id, "start-preparing");
      } catch {
        // Fica `confirmed`, na coluna Em preparo, com "Começar preparo" como rede.
      }
    },
    onSuccess: () => setConfirming(null),
    onError: (error, { order, transition }) => {
      setConfirming(null);
      const stock =
        transition === "accept" &&
        error instanceof ApiError &&
        error.status === 409 &&
        STOCK_MESSAGE.test(error.message);
      setFailure({ order, message: describeError(error), stock });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });

  const request = (order: Order, transition: OrderTransition) => {
    if (disabled || mutation.isPending) return;
    setFailure(null);
    if (transition === "accept" || transition === "cancel") setConfirming({ order, transition });
    else mutation.mutate({ order, transition });
  };

  const copy: ConfirmCopy | null =
    confirming === null
      ? null
      : confirming.transition === "accept"
        ? acceptCopy(confirming.order)
        : cancelCopy(confirming.order);

  const busyOrderId = mutation.isPending ? (mutation.variables?.order.id ?? null) : null;

  return (
    <OrderActionContext.Provider value={{ request, busyOrderId, disabled }}>
      {children}
      <ConfirmDialog
        copy={copy}
        busy={mutation.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming !== null) mutation.mutate(confirming);
        }}
      />
      <Modal
        opened={failure !== null}
        onClose={() => setFailure(null)}
        title={failure?.stock ? "Estoque acabou ao aceitar" : "Não foi possível concluir"}
        centered
        size={460}
        radius="md"
        classNames={{ title: dialog.title, overlay: dialog.overlay }}
      >
        {failure && (
          <div className={dialog.body}>
            <p className={dialog.text}>
              {failure.stock
                ? `${failure.message}. O pedido não foi aceito e o estoque não mudou. Reponha o estoque ou recuse explicando ao cliente.`
                : failure.message}
            </p>
            <div className={dialog.actions}>
              {failure.stock ? (
                <>
                  <Button
                    variant="default"
                    h={40}
                    onClick={() => {
                      setFailure(null);
                      navigate("/produtos");
                    }}
                  >
                    Repor estoque
                  </Button>
                  <Button
                    h={40}
                    className={buttons.danger}
                    onClick={() => {
                      const order = failure.order;
                      setFailure(null);
                      setConfirming({ order, transition: "cancel" });
                    }}
                  >
                    Recusar pedido
                  </Button>
                </>
              ) : (
                <Button variant="default" h={40} onClick={() => setFailure(null)}>
                  Fechar
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </OrderActionContext.Provider>
  );
}
```

- [ ] **Step 5: Botões no cartão**

Em `apps/panel/src/features/orders/OrderCard.tsx`, acrescente estes imports e troque o import de `./orderRules.ts` pelo abaixo:

```tsx
import { Button } from "@mantine/core";
import { useOrderAction } from "./orderActionFlow.tsx";
import { displayName, primaryAction } from "./orderRules.ts";
```

Acrescente o componente abaixo antes de `OrderCard`:

```tsx
/** Os botões param a propagação: aceitar não pode abrir o drawer. */
function CardActions({ order }: { order: Order }) {
  const { request, busyOrderId, disabled } = useOrderAction();
  const action = primaryAction(order);
  if (action === null) return null;
  const busy = busyOrderId === order.id;
  const isNew = order.status === "pending";
  return (
    <div
      className={classes.actions}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Button
        fullWidth
        h={38}
        variant={isNew ? "filled" : "default"}
        disabled={disabled}
        loading={busy}
        onClick={() => request(order, action.transition)}
      >
        {action.cardLabel}
      </Button>
      {isNew && (
        <Button variant="default" h={38} disabled={disabled || busy} onClick={() => request(order, "cancel")}>
          Recusar
        </Button>
      )}
    </div>
  );
}
```

e, dentro do `<article>`, depois da `moneyRow`:

```tsx
      <CardActions order={order} />
```

- [ ] **Step 6: Provider na página**

Em `apps/panel/src/features/orders/OrdersPage.tsx`, importe:

```tsx
import { OrderActionProvider } from "./orderActionFlow.tsx";
```

e troque o `return` por (o provider envolve também o `<Outlet />`, para o drawer usar o mesmo fluxo):

```tsx
  return (
    <OrderActionProvider restaurantId={me.restaurantId} disabled={offline}>
      <div className={classes.page}>
        {offline && (
          <OfflineNotice updatedAt={orders.dataUpdatedAt} now={now} onRetry={() => void orders.refetch()} />
        )}
        {deliveryAlert && <DeliveryAlert />}
        <FilterBar
          filters={filters}
          onChange={setFilters}
          tables={tables.data ?? []}
          syncLabel={
            orders.isPending
              ? "Carregando pedidos…"
              : `Atualiza sozinho · ${formatSecondsAgo(orders.dataUpdatedAt, now)}`
          }
        />
        {showEmpty ? (
          <EmptyOrders />
        ) : (
          <Kanban orders={list} loading={orders.isPending} now={now} onOpen={openOrder} />
        )}
        <Outlet />
      </div>
    </OrderActionProvider>
  );
```

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS (incluindo `orders-page.test.tsx`, que continua valendo com os botões novos).

- [ ] **Step 8: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ aceita, avança e cancela pedidos com confirmação"
```

---

### Task 14: Drawer de detalhe do pedido

**Files:**
- Create: `apps/panel/src/features/orders/OrderDrawer.tsx`, `OrderDrawer.module.css`
- Modify: `apps/panel/src/router.tsx`
- Test: `apps/panel/test/order-drawer.test.tsx`

**Interfaces:**
- Consumes: `useOrder` (Task 11); `useOrderAction` (Task 13); regras e apresentação (Task 10); `TypePill` (Task 12); `useRestaurant` (Task 9).
- Produces: `OrderDrawer` (rota filha `/pedidos/:orderId`).

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/order-drawer.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OrderDetail } from "../src/api/types.ts";
import { OrderDrawer } from "../src/features/orders/OrderDrawer.tsx";
import { OrdersPage } from "../src/features/orders/OrdersPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOrderDetail, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;
const ID = "a3f9c2d1-0000-4000-8000-000000000001";

const routes = [
  { path: "/pedidos", element: <OrdersPage />, children: [{ path: ":orderId", element: <OrderDrawer /> }] },
];

function setup(detail: OrderDetail) {
  signIn();
  const handlers: MockHandler[] = [
    { method: "GET", path: `${LIST}/${detail.id}`, body: detail },
    { method: "GET", path: LIST, body: { data: [], limit: 100, offset: 0, total: 0 } },
    { method: "GET", path: `/restaurants/${RESTAURANT_ID}/tables`, body: { data: [], limit: 100, offset: 0, total: 0 } },
    ...panelHandlers(),
  ];
  mockApi(handlers);
  return renderInPanel(routes, `/pedidos/${detail.id}`);
}

async function drawer() {
  return screen.findByRole("dialog", { name: "Detalhe do pedido" });
}

describe("OrderDrawer", () => {
  it("a conta fecha: itens + frete = total", async () => {
    setup(makeOrderDetail({ id: ID, totalInCents: 10100, deliveryFeeInCents: 900, paymentMethod: "cash", changeForInCents: 15000 }));
    const view = await drawer();
    expect(await within(view).findByText("Pizza Grande")).toBeTruthy();
    expect(within(view).getByText("Sabores: Calabresa, Portuguesa")).toBeTruthy();
    expect(within(view).getByText("Borda: Catupiry")).toBeTruthy();
    expect(within(view).getByText("R$ 80,00")).toBeTruthy(); // 2 × R$ 40,00
    expect(within(view).getByText("R$ 92,00")).toBeTruthy(); // Itens
    expect(within(view).getByText("Frete")).toBeTruthy();
    expect(within(view).getByText("R$ 9,00")).toBeTruthy();
    expect(within(view).getByText("R$ 101,00")).toBeTruthy();
    expect(within(view).getByText("Dinheiro · troco para R$ 150,00")).toBeTruthy();
  });

  it("frete grátis e a combinar têm textos próprios", async () => {
    setup(makeOrderDetail({ id: ID, deliveryFeeInCents: 0 }));
    expect(await within(await drawer()).findByText("Entrega grátis")).toBeTruthy();
  });

  it("frete a combinar", async () => {
    setup(makeOrderDetail({ id: ID, deliveryFeeInCents: null }));
    expect(await within(await drawer()).findByText("Frete a combinar")).toBeTruthy();
  });

  it("salão sem mesa (adesivo antigo) diz isso", async () => {
    setup(makeOrderDetail({ id: ID, type: "dine_in", deliveryAddress: null, deliveryFeeInCents: null, table: null }));
    expect(await within(await drawer()).findByText(/Salão · sem mesa/)).toBeTruthy();
  });

  it("em preparo, cancelar devolve o estoque — e o texto diz isso", async () => {
    setup(makeOrderDetail({ id: ID, status: "preparing" }));
    fireEvent.click(await within(await drawer()).findByRole("button", { name: "Cancelar pedido" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancelar o pedido #A3F9?" });
    expect(within(dialog).getByRole("button", { name: "Cancelar e devolver estoque" })).toBeTruthy();
  });

  it("depois de pronto, cancelar NÃO devolve — e o texto avisa", async () => {
    setup(makeOrderDetail({ id: ID, status: "ready_for_pickup", type: "takeaway", deliveryAddress: null, deliveryFeeInCents: null }));
    fireEvent.click(await within(await drawer()).findByRole("button", { name: "Cancelar (sem devolver estoque)" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancelar sem devolver o estoque?" });
    expect(within(dialog).getByText("O estoque NÃO será devolvido.")).toBeTruthy();
  });

  it("pedido encerrado não oferece ação impossível", async () => {
    setup(makeOrderDetail({ id: ID, status: "completed", updatedAt: "2026-09-19T23:10:00.000Z" }));
    const view = await drawer();
    expect(await within(view).findByText("Pedido concluído às 20:10. Não há mais ação possível.")).toBeTruthy();
    expect(within(view).queryByRole("button", { name: /Cancelar|Concluir|Aceitar/ })).toBeNull();
  });

  it("andamento mostra a hora de chegada e '—' no futuro", async () => {
    setup(makeOrderDetail({ id: ID, status: "pending" }));
    const view = await drawer();
    // findBy: a hora sai no fuso da loja, que chega com o restaurante
    expect(await within(view).findByText("19:58")).toBeTruthy();
    expect(within(view).getAllByText("—")).toHaveLength(3);
  });

  it("fechar volta para o kanban", async () => {
    const { router } = setup(makeOrderDetail({ id: ID }));
    fireEvent.click(await within(await drawer()).findByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/pedidos"));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- order-drawer`
Expected: FAIL — `OrderDrawer.tsx` não existe.

- [ ] **Step 3: Implementar**

`apps/panel/src/features/orders/OrderDrawer.module.css`:

```css
.drawer {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.header {
  display: grid;
  gap: 4px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--mc-line);
}

.headTop {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--mc-ink3);
}

.code {
  font-weight: 700;
}

.close {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  margin-left: auto;
  border: 1px solid var(--mc-line);
  border-radius: 6px;
  background: var(--mc-surface);
  color: var(--mc-ink2);
  cursor: pointer;
}

.close:hover {
  background: var(--mc-surface3);
}

.name {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

.contact {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-ink2);
}

.body {
  flex: 1 1 auto;
  overflow-y: auto;
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 16px 18px;
}

.items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--mc-line);
}

.qty,
.itemName,
.price {
  font-size: 15px;
}

.qty {
  font-weight: 700;
}

.itemName,
.price {
  font-weight: 600;
}

.options {
  display: block;
  font-size: 13px;
  color: var(--mc-ink2);
}

.totals {
  display: grid;
  gap: 6px;
  margin: 0;
}

.totals div {
  display: flex;
  justify-content: space-between;
}

.totals dt,
.totals dd {
  margin: 0;
}

.total {
  padding-top: 8px;
  border-top: 1px solid var(--mc-line-hi);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.payment {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-ink2);
}

.progress {
  display: grid;
  gap: 8px;
  padding: 14px;
  background: var(--mc-surface2);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.steps {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
}

.stepDot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--mc-line-hi);
}

.step_done .stepDot {
  background: var(--mc-accent);
}

.step_current .stepDot {
  background: var(--mc-warn-strong);
}

.step_current {
  font-weight: 700;
}

.stepTime {
  margin-left: auto;
  color: var(--mc-ink3);
}

.footer {
  display: grid;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid var(--mc-line);
}

.footRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.note {
  font-size: 12.5px;
  color: var(--mc-ink3);
}

.closed {
  margin: 0;
  padding: 12px 14px;
  background: var(--mc-surface2);
  border: 1px solid var(--mc-line);
  border-radius: 6px;
  color: var(--mc-ink2);
}

.missing {
  padding: 18px;
  color: var(--mc-ink2);
}

/* Escondido só visualmente: continua dando nome ao diálogo. */
.srHeader {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
```

`apps/panel/src/features/orders/OrderDrawer.tsx`:

```tsx
import { Button, Drawer } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useLocation, useNavigate, useParams } from "react-router";
import { ApiError, describeError } from "../../api/client.ts";
import type { OrderDetail } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { formatCents } from "../../lib/money.ts";
import { orderCode } from "../../lib/orderCode.ts";
import { formatElapsed } from "../../lib/time.ts";
import { useNow } from "../../lib/useNow.ts";
import buttons from "../../ui/buttons.module.css";
import { useRestaurant } from "../restaurant/useRestaurant.ts";
import classes from "./OrderDrawer.module.css";
import { useOrderAction } from "./orderActionFlow.tsx";
import { cancelKind, cancelLabel, closedMessage, primaryAction, progressSteps } from "./orderRules.ts";
import { formatPhone, freightLine, groupOptions, itemsSubtotal, paymentLabel, whereLabel } from "./presentation.ts";
import { TypePill } from "./TypePill.tsx";
import { useOrder } from "./useOrders.ts";

function OrderDetailView({
  order,
  now,
  timeZone,
  onClose,
}: {
  order: OrderDetail;
  now: number;
  timeZone: string | undefined;
  onClose: () => void;
}) {
  const { request, busyOrderId, disabled } = useOrderAction();
  const action = primaryAction(order);
  const kind = cancelKind(order.status);
  const freight = freightLine(order);
  const closed = closedMessage(order, timeZone);
  const busy = busyOrderId === order.id;

  return (
    <div className={classes.drawer}>
      <header className={classes.header}>
        <div className={classes.headTop}>
          <span className={`${classes.code} n`}>{orderCode(order.id)}</span>
          <TypePill order={order} />
          <span className="n">{formatElapsed(order.createdAt, now)}</span>
          <button type="button" className={classes.close} aria-label="Fechar" onClick={onClose}>
            <IconX size={18} />
          </button>
        </div>
        <h2 className={classes.name}>{order.customer.name}</h2>
        <p className={classes.contact}>
          <span className="n">{formatPhone(order.customer.phone)}</span> · {whereLabel(order)}
        </p>
      </header>

      <div className={classes.body}>
        <ul className={classes.items}>
          {order.items.map((item) => (
            <li key={item.id} className={classes.item}>
              <span className={`${classes.qty} n`}>{item.quantity}×</span>
              <div>
                <span className={classes.itemName}>{item.name}</span>
                {/* Sem "+R$" por opção: o pedido não guarda a regra do grupo, e
                    em "mais caro"/"média" o preço da opção não é parcela da
                    soma (spec). O valor da linha já inclui as opções. */}
                {groupOptions(item.options).map((group) => (
                  <span key={group.groupName} className={classes.options}>
                    {group.groupName}: {group.text}
                  </span>
                ))}
              </div>
              <span className={`${classes.price} n`}>{formatCents(item.unitPriceInCents * item.quantity)}</span>
            </li>
          ))}
        </ul>

        <dl className={classes.totals}>
          <div>
            <dt>Itens</dt>
            <dd className="n">{formatCents(itemsSubtotal(order))}</dd>
          </div>
          {freight && (
            <div>
              <dt>{freight.label}</dt>
              <dd className="n">{freight.value}</dd>
            </div>
          )}
          <div className={classes.total}>
            <dt>Total</dt>
            <dd className="n">{formatCents(order.totalInCents)}</dd>
          </div>
        </dl>
        <p className={classes.payment}>{paymentLabel(order)}</p>

        <section className={classes.progress}>
          <span className="eyebrow">Andamento</span>
          <ol className={classes.steps}>
            {progressSteps(order, timeZone).map((step) => (
              <li key={step.label} className={`${classes.step} ${classes[`step_${step.state}`]}`}>
                <span className={classes.stepDot} aria-hidden="true" />
                <span>{step.label}</span>
                <span className={`${classes.stepTime} n`}>
                  {step.time ?? (step.state === "future" ? "—" : "")}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <footer className={classes.footer}>
        {closed !== null ? (
          <p className={classes.closed}>{closed}</p>
        ) : (
          <>
            {action && (
              <Button fullWidth h={46} disabled={disabled} loading={busy} onClick={() => request(order, action.transition)}>
                {action.label}
              </Button>
            )}
            <div className={classes.footRow}>
              <span className={classes.note}>{action?.note}</span>
              {kind && (
                <Button
                  variant="default"
                  className={buttons.danger}
                  disabled={disabled || busy}
                  onClick={() => request(order, "cancel")}
                >
                  {cancelLabel(kind)}
                </Button>
              )}
            </div>
          </>
        )}
      </footer>
    </div>
  );
}

/**
 * Sem overlay e sem prender o foco: o kanban continua legível e clicável ao
 * lado, de propósito (handoff).
 */
export function OrderDrawer() {
  const { orderId = "" } = useParams();
  const me = useSessionUser();
  const restaurant = useRestaurant(me.restaurantId);
  const order = useOrder(me.restaurantId, orderId);
  const now = useNow();
  const navigate = useNavigate();
  const location = useLocation();
  const close = () => navigate({ pathname: "/pedidos", search: location.search });

  return (
    <Drawer
      opened
      onClose={close}
      position="right"
      size={472}
      padding={0}
      withOverlay={false}
      withCloseButton={false}
      lockScroll={false}
      trapFocus={false}
      closeOnClickOutside={false}
      // O título dá nome acessível ao diálogo; o cabeçalho visível é o nosso.
      title="Detalhe do pedido"
      classNames={{ header: classes.srHeader }}
    >
      {order.isPending ? (
        <p className={classes.missing}>Carregando pedido…</p>
      ) : order.isError ? (
        <p className={classes.missing}>
          {order.error instanceof ApiError && order.error.status === 404
            ? "Pedido não encontrado."
            : describeError(order.error)}
        </p>
      ) : (
        <OrderDetailView order={order.data} now={now} timeZone={restaurant.data?.timezone} onClose={close} />
      )}
    </Drawer>
  );
}
```

> O `title` do Drawer vira o `aria-labelledby` do `role="dialog"` — é o que o teste procura com `getByRole("dialog", { name: "Detalhe do pedido" })`. O cabeçalho do Mantine fica visualmente escondido (`.srHeader`), porque o cabeçalho de verdade é o do `OrderDetailView`. Não troque o teste para outro seletor.

- [ ] **Step 4: Rota filha**

Em `apps/panel/src/router.tsx`:

```tsx
import { OrderDrawer } from "./features/orders/OrderDrawer.tsx";
```

```tsx
              {
                path: "/pedidos",
                handle: { title: "Pedidos" },
                element: <OrdersPage />,
                children: [{ path: ":orderId", element: <OrderDrawer /> }],
              },
```

- [ ] **Step 5: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ adiciona o detalhe do pedido com a conta e o andamento"
```

---

### Task 15: Pedido novo se anuncia sozinho — bipe, título da aba e contador no rail

**Files:**
- Create: `apps/panel/src/lib/audio.ts`, `apps/panel/src/features/orders/newOrders.ts`, `apps/panel/src/features/orders/useNewOrderAlert.ts`
- Modify: `apps/panel/src/api/orders.ts`, `apps/panel/src/layout/PanelLayout.tsx`, `apps/panel/src/layout/Rail.tsx`, `apps/panel/src/layout/Rail.module.css`, `apps/panel/test/fixtures.ts`
- Test: `apps/panel/test/newOrders.test.ts`, `apps/panel/test/new-order-alert.test.tsx`

**Interfaces:**
- Consumes: `fetchAllPages`, `apiRequest` (Task 3); `ORDERS_POLL_MS` (Task 9); `Rail`, `PanelLayout` (Task 9).
- Produces:
  - `listPendingOrders(restaurantId): Promise<Order[]>` (todos os `pending`, de qualquer data)
  - `detectNewPending(seen: ReadonlySet<string> | null, orders): { fresh: string[]; seen: Set<string> }`
  - `hasUserGesture(): boolean`, `unlockAudio(): Promise<boolean>`, `playBeep(): Promise<boolean>`
  - `useNewOrderAlert(restaurantId): { pendingCount: number; soundBlocked: boolean; enableSound: () => void }` — chave `["orders", "pending", restaurantId]`
  - `Rail({ restaurant, me, pendingCount, soundBlocked, onEnableSound })`
  - `panelHandlers({ pending? })` passa a responder os pendentes

- [ ] **Step 1: `panelHandlers` responde os pendentes**

Em `apps/panel/test/fixtures.ts`, troque `panelHandlers` por (o handler de pendentes vem PRIMEIRO, porque casa pela querystring):

```ts
export function panelHandlers(
  options: {
    me?: Partial<Me>;
    restaurant?: Partial<Restaurant>;
    summary?: Partial<OrdersSummary>;
    pending?: Order[];
  } = {},
): MockHandler[] {
  const pending = options.pending ?? [];
  return [
    {
      method: "GET",
      path: `/restaurants/${RESTAURANT_ID}/orders`,
      query: { status: "pending" },
      body: { data: pending, limit: 100, offset: 0, total: pending.length },
    },
    { method: "GET", path: "/auth/me", body: makeMe(options.me) },
    { method: "GET", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant(options.restaurant) },
    {
      method: "GET",
      path: `/restaurants/${RESTAURANT_ID}/orders/summary`,
      body: makeSummary(options.summary),
    },
  ];
}
```

- [ ] **Step 2: Escrever os testes que falham**

`apps/panel/test/newOrders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectNewPending } from "../src/features/orders/newOrders.ts";
import { makeOrder } from "./fixtures.ts";

describe("detectNewPending", () => {
  it("a primeira carga não é 'novo' — só estabelece o que já se viu", () => {
    const a = makeOrder();
    const result = detectNewPending(null, [a]);
    expect(result.fresh).toEqual([]);
    expect([...result.seen]).toEqual([a.id]);
  });

  it("anuncia só o que não tinha sido visto", () => {
    const a = makeOrder();
    const b = makeOrder();
    const first = detectNewPending(null, [a]);
    const second = detectNewPending(first.seen, [a, b]);
    expect(second.fresh).toEqual([b.id]);
  });

  it("pedido que saiu e voltou à lista não toca de novo", () => {
    const a = makeOrder();
    const first = detectNewPending(null, [a]);
    const gone = detectNewPending(first.seen, []);
    expect(detectNewPending(gone.seen, [a]).fresh).toEqual([]);
  });
});
```

`apps/panel/test/new-order-alert.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireVerified } from "../src/auth/guards.tsx";
import { PanelLayout } from "../src/layout/PanelLayout.tsx";
import { playBeep, unlockAudio } from "../src/lib/audio.ts";
import { mockApi } from "./api-mock.ts";
import { makeOrder, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderRoutes } from "./render.tsx";

vi.mock("../src/lib/audio.ts", () => ({
  playBeep: vi.fn(async () => true),
  unlockAudio: vi.fn(async () => true),
  hasUserGesture: vi.fn(() => false),
}));

const routes = [
  {
    element: <RequireVerified />,
    children: [
      {
        element: <PanelLayout />,
        children: [{ path: "/pedidos", handle: { title: "Pedidos" }, element: <p>conteúdo</p> }],
      },
    ],
  },
];

describe("aviso de pedido novo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("conta os novos no rail e no título da aba", async () => {
    signIn();
    mockApi(panelHandlers({ pending: [makeOrder(), makeOrder()] }));
    renderRoutes(routes, "/pedidos");
    const link = await screen.findByRole("link", { name: /Pedidos/ });
    await waitFor(() => expect(link.textContent).toContain("2"));
    expect(document.title).toBe("(2) Pedidos · MenuClick");
  });

  it("pedido que chega depois da primeira carga toca o bipe; a primeira carga não", async () => {
    signIn();
    const api = mockApi([
      {
        method: "GET",
        path: `/restaurants/${RESTAURANT_ID}/orders`,
        query: { status: "pending" },
        once: true,
        body: { data: [], limit: 100, offset: 0, total: 0 },
      },
      ...panelHandlers({ pending: [makeOrder()] }),
    ]);
    const { queryClient } = renderRoutes(routes, "/pedidos");
    await waitFor(() =>
      expect(api.calls.filter((call) => call.query.status === "pending")).toHaveLength(1),
    );
    expect(playBeep).not.toHaveBeenCalled();
    await queryClient.invalidateQueries({ queryKey: ["orders", "pending"] });
    await waitFor(() => expect(playBeep).toHaveBeenCalledOnce());
  });

  it("sem gesto na página, oferece ativar o som", async () => {
    signIn();
    mockApi(panelHandlers());
    renderRoutes(routes, "/pedidos");
    fireEvent.click(await screen.findByRole("button", { name: "Som desligado · Ativar som" }));
    await waitFor(() => expect(unlockAudio).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Som desligado · Ativar som" })).toBeNull());
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- newOrders new-order-alert`
Expected: FAIL — `newOrders.ts` e `audio.ts` não existem.

- [ ] **Step 4: Pendentes na API**

Acrescente ao fim de `apps/panel/src/api/orders.ts`:

```ts
/**
 * Todos os `pending`, de qualquer data (sem período, a API não filtra por
 * data). É o que o aviso de pedido novo vigia — independente do filtro que o
 * kanban estiver mostrando, e de qual tela do painel estiver aberta.
 */
export function listPendingOrders(restaurantId: string): Promise<Order[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<Order>>(`/restaurants/${restaurantId}/orders`, {
      query: { status: "pending", sort: "createdAt", order: "asc", limit: 100, offset },
    }),
  );
}
```

- [ ] **Step 5: Som e detecção**

`apps/panel/src/lib/audio.ts`:

```ts
let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  context ??= new AudioContext();
  return context;
}

async function ensureRunning(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === "running") return true;
  try {
    await ctx.resume();
  } catch {
    return false;
  }
  // relido depois do await: o TS manteria o estreitamento de antes
  return (ctx.state as AudioContextState) === "running";
}

/** O navegador só libera áudio depois de um gesto do usuário na página. */
export function hasUserGesture(): boolean {
  // tipado à parte: nem toda versão do lib.dom do TypeScript declara userActivation
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation;
  return activation?.hasBeenActive ?? false;
}

/** Chamar DENTRO de um clique: é o gesto que destrava o áudio. */
export async function unlockAudio(): Promise<boolean> {
  const ctx = audioContext();
  return ctx === null ? false : ensureRunning(ctx);
}

/** Bipe curto (880 Hz, 250 ms), gerado na hora — sem arquivo de som. */
export async function playBeep(): Promise<boolean> {
  const ctx = audioContext();
  if (ctx === null || !(await ensureRunning(ctx))) return false;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.value = 0.2;
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.25);
  return true;
}
```

`apps/panel/src/features/orders/newOrders.ts`:

```ts
import type { Order } from "../../api/types.ts";

/**
 * Quais pendentes são novidade. `seen === null` é a primeira carga: nada
 * toca (senão o painel apitaria a cada F5), só se registra o que já existia.
 * O conjunto só cresce — pedido que sai e volta não toca duas vezes.
 */
export function detectNewPending(
  seen: ReadonlySet<string> | null,
  orders: readonly Order[],
): { fresh: string[]; seen: Set<string> } {
  const next = new Set(seen ?? []);
  const fresh: string[] = [];
  for (const order of orders) {
    if (next.has(order.id)) continue;
    next.add(order.id);
    if (seen !== null) fresh.push(order.id);
  }
  return { fresh, seen: next };
}
```

`apps/panel/src/features/orders/useNewOrderAlert.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { listPendingOrders } from "../../api/orders.ts";
import { hasUserGesture, playBeep, unlockAudio } from "../../lib/audio.ts";
import { detectNewPending } from "./newOrders.ts";
import { ORDERS_POLL_MS } from "./polling.ts";

/**
 * "Um pedido novo tem que se anunciar sozinho — ninguém vai apertar F5."
 * Mora na casca do painel, então toca em qualquer tela, com qualquer filtro.
 */
export function useNewOrderAlert(restaurantId: string) {
  const pending = useQuery({
    queryKey: ["orders", "pending", restaurantId],
    queryFn: () => listPendingOrders(restaurantId),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
  });
  const seen = useRef<Set<string> | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(() => !hasUserGesture());

  // defensivo: só conta o que é pendente mesmo. Memoizado para o efeito
  // abaixo rodar quando os dados mudam, não a cada render.
  const orders = useMemo(
    () => pending.data?.filter((order) => order.status === "pending"),
    [pending.data],
  );
  const pendingCount = orders?.length ?? 0;

  useEffect(() => {
    if (orders === undefined) return;
    const result = detectNewPending(seen.current, orders);
    seen.current = result.seen;
    if (result.fresh.length > 0) {
      void playBeep().then((played) => setSoundBlocked(!played));
    }
  }, [orders]);

  useEffect(() => {
    document.title = pendingCount > 0 ? `(${pendingCount}) Pedidos · MenuClick` : "MenuClick · Painel da loja";
  }, [pendingCount]);

  const enableSound = () => {
    void unlockAudio().then((unlocked) => setSoundBlocked(!unlocked));
  };

  return { pendingCount, soundBlocked, enableSound };
}
```

- [ ] **Step 6: Rail e casca**

Em `apps/panel/src/layout/Rail.module.css`, acrescente:

```css
.badge {
  min-width: 22px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--mc-surface3);
  color: var(--mc-ink2);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.badgeWarn {
  background: var(--mc-warn-soft);
  color: var(--mc-warn);
}

.sound {
  justify-self: start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--mc-warn);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
```

Em `apps/panel/src/layout/Rail.tsx`, troque a assinatura e o conteúdo por:

```tsx
export function Rail({
  restaurant,
  me,
  pendingCount,
  soundBlocked,
  onEnableSound,
}: {
  restaurant: Restaurant | undefined;
  me: Me;
  pendingCount: number;
  soundBlocked: boolean;
  onEnableSound: () => void;
}) {
  const paused = restaurant?.acceptingOrders === false;
  return (
    <nav className={classes.rail} aria-label="Navegação do painel">
      <div className={classes.top}>
        <strong className={classes.store}>{restaurant?.name ?? ""}</strong>
        <span className={classes.status}>
          <span className={classes.dot} aria-hidden="true" />
          {paused ? "Pausada agora" : "Aceitando pedidos"}
        </span>
        {soundBlocked && (
          <button type="button" className={classes.sound} onClick={onEnableSound}>
            Som desligado · Ativar som
          </button>
        )}
      </div>
      <div className={classes.nav}>
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className={classes.group}>
            <span className={classes.groupTitle}>{group.title}</span>
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} className={navClass}>
                {item.label}
                {item.to === "/pedidos" && (
                  <span className={`${classes.badge} ${pendingCount > 0 ? classes.badgeWarn : ""} n`}>
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className={classes.footer}>
        <UserMenu me={me} />
      </div>
    </nav>
  );
}
```

Em `apps/panel/src/layout/PanelLayout.tsx`, importe o hook e passe os valores ao rail:

```tsx
import { useNewOrderAlert } from "../features/orders/useNewOrderAlert.ts";
```

```tsx
  const alert = useNewOrderAlert(me.restaurantId);
```

```tsx
      <Rail
        restaurant={restaurant.data}
        me={me}
        pendingCount={alert.pendingCount}
        soundBlocked={alert.soundBlocked}
        onEnableSound={alert.enableSound}
      />
```

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS (o `layout.test.tsx` continua passando com o handler de pendentes).

- [ ] **Step 8: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ anuncia pedido novo com bipe, título da aba e contador"
```

---

### Task 16: Seções do cardápio

**Files:**
- Create: `apps/panel/src/api/categories.ts`, `apps/panel/src/lib/moveItem.ts`, `apps/panel/src/features/categories/reorder.ts`, `apps/panel/src/features/categories/CategoriesPage.tsx`, `CategoriesPage.module.css`
- Modify: `apps/panel/src/router.tsx`, `apps/panel/src/layout/Rail.tsx`
- Test: `apps/panel/test/reorder.test.ts`, `apps/panel/test/categories-page.test.tsx`

**Interfaces:**
- Consumes: `apiRequest`, `fetchAllPages` (Task 3); `ConfirmDialog`, `buttons.module.css` (Task 13); `Notice` (Task 6).
- Produces:
  - `listAllCategories(restaurantId): Promise<Category[]>` (ordenadas por `position`, empate pelo nome), `createCategory(restaurantId, name)`, `renameCategory(restaurantId, id, name)`, `moveCategory(restaurantId, id, position)`, `deleteCategory(restaurantId, id)`, `countProductsInCategory(restaurantId, categoryId): Promise<number>`
  - `moveItem<T>(items, from, to): T[]`
  - `positionUpdates(ordered): { id; position }[]`, `findDuplicate(name, categories, exceptId?): Category | undefined`
  - `CategoriesPage`, `countLabel(count)`

- [ ] **Step 1: Escrever os testes que falham**

`apps/panel/test/reorder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findDuplicate, positionUpdates } from "../src/features/categories/reorder.ts";
import { moveItem } from "../src/lib/moveItem.ts";
import { makeCategory } from "./fixtures.ts";

describe("reordenação de seções", () => {
  it("moveItem move sem mutar", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(items, 2, 3)).toEqual(["a", "b", "c"]);
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("manda PATCH só para quem mudou de posição", () => {
    const a = makeCategory({ id: "a", position: 0 });
    const b = makeCategory({ id: "b", position: 1 });
    const c = makeCategory({ id: "c", position: 2 });
    expect(positionUpdates([b, a, c])).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
    ]);
  });

  it("empate e buraco na posição: renumera tudo o que não bate com o índice", () => {
    // trocar só as duas posições empatadas em 3 não moveria nada
    const a = makeCategory({ id: "a", position: 3 });
    const b = makeCategory({ id: "b", position: 3 });
    expect(positionUpdates([b, a])).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
    ]);
  });

  it("nome repetido não diferencia maiúsculas", () => {
    const list = [makeCategory({ id: "x", name: "Bebidas" })];
    expect(findDuplicate(" bebidas ", list)?.name).toBe("Bebidas");
    expect(findDuplicate("Bebidas", list, "x")).toBeUndefined();
    expect(findDuplicate("Sobremesas", list)).toBeUndefined();
  });
});
```

`apps/panel/test/categories-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoriesPage } from "../src/features/categories/CategoriesPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeCategory, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}/categories`;
const PRODUCTS = `/restaurants/${RESTAURANT_ID}/products`;

const pizzas = makeCategory({ id: "cat-1", name: "Pizzas", position: 0 });
const entradas = makeCategory({ id: "cat-2", name: "Entradas", position: 1 });
const bebidas = makeCategory({ id: "cat-3", name: "Bebidas", position: 2 });

function count(categoryId: string, total: number): MockHandler {
  return {
    method: "GET",
    path: PRODUCTS,
    query: { categoryId },
    body: { data: [], limit: 1, offset: 0, total },
  };
}

function setup(extra: MockHandler[] = []) {
  signIn();
  const api = mockApi([
    ...extra,
    { method: "GET", path: BASE, body: { data: [bebidas, pizzas, entradas], limit: 100, offset: 0, total: 3 } },
    count("cat-1", 3),
    count("cat-2", 1),
    count("cat-3", 0),
    ...panelHandlers(),
  ]);
  renderInPanel([{ path: "/secoes", element: <CategoriesPage /> }], "/secoes");
  return api;
}

function row(name: string) {
  return screen.getByRole("listitem", { name });
}

describe("CategoriesPage", () => {
  it("lista na ordem da refeição, com a contagem de produtos", async () => {
    setup();
    await screen.findByRole("listitem", { name: "Pizzas" });
    expect(screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Pizzas",
      "Entradas",
      "Bebidas",
    ]);
    expect(await within(row("Pizzas")).findByText("3 produtos")).toBeTruthy();
    expect(await within(row("Entradas")).findByText("1 produto")).toBeTruthy();
    expect(await within(row("Bebidas")).findByText("sem produtos")).toBeTruthy();
  });

  it("nome repetido, com outra caixa, nem chega à API", async () => {
    const api = setup();
    await screen.findByRole("listitem", { name: "Bebidas" });
    fireEvent.change(screen.getByLabelText("Nome da nova seção"), { target: { value: "bebidas" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(screen.getByText("Já existe uma seção com esse nome")).toBeTruthy();
    expect(
      screen.getByText('"Bebidas" já está cadastrada. O nome não diferencia maiúsculas: "bebidas" conta como repetido.'),
    ).toBeTruthy();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("adiciona seção nova", async () => {
    const api = setup([
      { method: "POST", path: BASE, status: 201, body: makeCategory({ id: "cat-4", name: "Sobremesas", position: 3 }) },
    ]);
    await screen.findByRole("listitem", { name: "Pizzas" });
    fireEvent.change(screen.getByLabelText("Nome da nova seção"), { target: { value: "Sobremesas" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Sobremesas" }),
    );
  });

  it("descer uma seção manda PATCH só para as duas que trocaram", async () => {
    const api = setup([
      { method: "PATCH", path: `${BASE}/cat-1`, body: { ...pizzas, position: 1 } },
      { method: "PATCH", path: `${BASE}/cat-2`, body: { ...entradas, position: 0 } },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Descer Pizzas" }));
    await waitFor(() => expect(api.calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    const patches = api.calls.filter((call) => call.method === "PATCH").map((call) => [call.path, call.body]);
    expect(patches).toEqual([
      [`${BASE}/cat-2`, { position: 0 }],
      [`${BASE}/cat-1`, { position: 1 }],
    ]);
  });

  it("remover diz o que NÃO acontece com os produtos", async () => {
    const api = setup([{ method: "DELETE", path: `${BASE}/cat-1`, status: 204 }]);
    fireEvent.click(within(await screen.findByRole("listitem", { name: "Pizzas" })).getByRole("button", { name: "Remover" }));
    const dialog = await screen.findByRole("dialog", { name: 'Remover a seção "Pizzas"?' });
    expect(
      within(dialog).getByText(
        'Os produtos dela não são apagados: passam para um grupo "Sem categoria" no fim do cardápio, e continuam à venda.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover seção" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- reorder categories-page`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: API e utilitários**

`apps/panel/src/api/categories.ts`:

```ts
import { apiRequest } from "./client.ts";
import { fetchAllPages } from "./pagination.ts";
import type { Category, Page, Product } from "./types.ts";

/** Ordem da refeição (`position`); empate desfeito pelo nome, como na API. */
export function sortCategories(categories: readonly Category[]): Category[] {
  return [...categories].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"),
  );
}

export async function listAllCategories(restaurantId: string): Promise<Category[]> {
  const all = await fetchAllPages((offset) =>
    apiRequest<Page<Category>>(`/restaurants/${restaurantId}/categories`, { query: { limit: 100, offset } }),
  );
  return sortCategories(all);
}

export function createCategory(restaurantId: string, name: string): Promise<Category> {
  return apiRequest<Category>(`/restaurants/${restaurantId}/categories`, { method: "POST", body: { name } });
}

export function renameCategory(restaurantId: string, id: string, name: string): Promise<Category> {
  return apiRequest<Category>(`/restaurants/${restaurantId}/categories/${id}`, {
    method: "PATCH",
    body: { name },
  });
}

export function moveCategory(restaurantId: string, id: string, position: number): Promise<Category> {
  return apiRequest<Category>(`/restaurants/${restaurantId}/categories/${id}`, {
    method: "PATCH",
    body: { position },
  });
}

export function deleteCategory(restaurantId: string, id: string): Promise<void> {
  return apiRequest<void>(`/restaurants/${restaurantId}/categories/${id}`, { method: "DELETE" });
}

/**
 * "N produtos" da seção. A categoria não traz contagem (pendência de backend
 * da spec): sai do `total` de uma listagem de produtos com `limit=1`.
 */
export async function countProductsInCategory(restaurantId: string, categoryId: string): Promise<number> {
  const page = await apiRequest<Page<Product>>(`/restaurants/${restaurantId}/products`, {
    query: { categoryId, limit: 1 },
  });
  return page.total;
}
```

`apps/panel/src/lib/moveItem.ts`:

```ts
/** Move um item de posição, sem mutar. Destino fora da lista: nada muda. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
```

`apps/panel/src/features/categories/reorder.ts`:

```ts
import type { Category } from "../../api/types.ts";

/**
 * Renumera pela ordem da lista e devolve só quem mudou. Trocar apenas as duas
 * posições não basta: com buraco ou empate (o empate é desfeito pelo nome),
 * trocar dois "3" não moveria nada.
 */
export function positionUpdates(
  ordered: readonly Pick<Category, "id" | "position">[],
): { id: string; position: number }[] {
  return ordered.flatMap((category, index) =>
    category.position === index ? [] : [{ id: category.id, position: index }],
  );
}

/** O índice único da API é sobre lower(name): "bebidas" colide com "Bebidas". */
export function findDuplicate(
  name: string,
  categories: readonly Category[],
  exceptId?: string,
): Category | undefined {
  const wanted = name.trim().toLocaleLowerCase("pt-BR");
  return categories.find(
    (category) => category.id !== exceptId && category.name.trim().toLocaleLowerCase("pt-BR") === wanted,
  );
}
```

- [ ] **Step 4: A tela**

`apps/panel/src/features/categories/CategoriesPage.module.css`:

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
  min-height: 56px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--mc-line);
}

.arrows {
  display: flex;
  gap: 4px;
}

.position {
  width: 20px;
  color: var(--mc-ink3);
  font-weight: 700;
  text-align: right;
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

.count {
  font-size: 12.5px;
  color: var(--mc-ink3);
}

.renameForm {
  flex: 1 1 auto;
  display: flex;
  gap: 8px;
}

.footer {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  background: var(--mc-surface2);
}

.footer > :first-child {
  flex: 1 1 auto;
}

.error {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-danger);
}
```

`apps/panel/src/features/categories/CategoriesPage.tsx`:

```tsx
import { ActionIcon, Button, TextInput } from "@mantine/core";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  countProductsInCategory,
  createCategory,
  deleteCategory,
  listAllCategories,
  moveCategory,
  renameCategory,
} from "../../api/categories.ts";
import { describeError } from "../../api/client.ts";
import type { Category } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { moveItem } from "../../lib/moveItem.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Notice } from "../../ui/Notice.tsx";
import classes from "./CategoriesPage.module.css";
import { findDuplicate, positionUpdates } from "./reorder.ts";

export function countLabel(count: number | undefined): string {
  if (count === undefined) return "…";
  if (count === 0) return "sem produtos";
  return count === 1 ? "1 produto" : `${count} produtos`;
}

export function CategoriesPage() {
  const { restaurantId } = useSessionUser();
  const queryClient = useQueryClient();
  const key = ["categories", restaurantId];
  const categories = useQuery({ queryKey: key, queryFn: () => listAllCategories(restaurantId) });
  const list = categories.data ?? [];
  const counts = useQueries({
    queries: list.map((category) => ({
      queryKey: ["categories", restaurantId, "count", category.id],
      queryFn: () => countProductsInCategory(restaurantId, category.id),
      staleTime: 30_000,
    })),
  });

  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Category | null>(null);
  const [duplicate, setDuplicate] = useState<{ existing: string; typed: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const fail = (cause: unknown) => setError(describeError(cause));

  const create = useMutation({
    mutationFn: (name: string) => createCategory(restaurantId, name),
    onSuccess: () => {
      setNewName("");
      void refresh();
    },
    onError: fail,
  });
  const rename = useMutation({
    mutationFn: (value: { id: string; name: string }) => renameCategory(restaurantId, value.id, value.name),
    onSuccess: () => {
      setEditing(null);
      void refresh();
    },
    onError: fail,
  });
  const reorder = useMutation({
    mutationFn: async (ordered: Category[]) => {
      for (const update of positionUpdates(ordered)) {
        await moveCategory(restaurantId, update.id, update.position);
      }
    },
    // a lista já aparece na ordem nova enquanto os PATCH correm
    onMutate: (ordered) =>
      queryClient.setQueryData(
        key,
        ordered.map((category, index) => ({ ...category, position: index })),
      ),
    onError: fail,
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCategory(restaurantId, id),
    onSuccess: () => {
      setRemoving(null);
      void refresh();
    },
    onError: (cause) => {
      setRemoving(null);
      fail(cause);
    },
  });

  /** Barra o nome repetido antes da API; o 409 dela fica como rede. */
  const acceptName = (name: string, exceptId?: string): boolean => {
    const existing = findDuplicate(name, list, exceptId);
    setDuplicate(existing ? { existing: existing.name, typed: name.trim() } : null);
    return existing === undefined;
  };

  const submitNew = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const name = newName.trim();
    if (name === "" || !acceptName(name)) return;
    create.mutate(name);
  };

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (editing === null) return;
    setError(null);
    const name = editing.name.trim();
    if (name === "" || !acceptName(name, editing.id)) return;
    rename.mutate({ id: editing.id, name });
  };

  return (
    <div className={classes.page}>
      <p className={classes.note}>
        A ordem é a ordem da refeição, não alfabética — e é exatamente o que o cliente vê no cardápio.
      </p>
      <section className={classes.card}>
        <ul className={classes.list}>
          {list.map((category, index) => (
            <li key={category.id} className={classes.row} aria-label={category.name}>
              <div className={classes.arrows}>
                <ActionIcon
                  variant="default"
                  size={30}
                  aria-label={`Subir ${category.name}`}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => reorder.mutate(moveItem(list, index, index - 1))}
                >
                  <IconArrowUp size={14} />
                </ActionIcon>
                <ActionIcon
                  variant="default"
                  size={30}
                  aria-label={`Descer ${category.name}`}
                  disabled={index === list.length - 1 || reorder.isPending}
                  onClick={() => reorder.mutate(moveItem(list, index, index + 1))}
                >
                  <IconArrowDown size={14} />
                </ActionIcon>
              </div>
              <span className={`${classes.position} n`}>{index + 1}</span>
              {editing?.id === category.id ? (
                <form className={classes.renameForm} onSubmit={submitRename}>
                  <TextInput
                    aria-label="Novo nome da seção"
                    value={editing.name}
                    onChange={(event) => setEditing({ id: category.id, name: event.currentTarget.value })}
                  />
                  <Button type="submit" loading={rename.isPending}>
                    Salvar
                  </Button>
                  <Button variant="default" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </form>
              ) : (
                <>
                  <div className={classes.info}>
                    <span className={classes.name}>{category.name}</span>
                    <span className={`${classes.count} n`}>{countLabel(counts[index]?.data)}</span>
                  </div>
                  <Button variant="subtle" onClick={() => setEditing({ id: category.id, name: category.name })}>
                    Renomear
                  </Button>
                  <Button variant="subtle" className={buttons.dangerText} onClick={() => setRemoving(category)}>
                    Remover
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form className={classes.footer} onSubmit={submitNew}>
          <TextInput
            aria-label="Nome da nova seção"
            placeholder="Nome da nova seção"
            value={newName}
            error={duplicate !== null}
            onChange={(event) => setNewName(event.currentTarget.value)}
          />
          <Button type="submit" loading={create.isPending}>
            Adicionar
          </Button>
        </form>
      </section>
      {duplicate && (
        <Notice tone="danger" title="Já existe uma seção com esse nome">
          {`"${duplicate.existing}" já está cadastrada. O nome não diferencia maiúsculas: "${duplicate.typed}" conta como repetido.`}
        </Notice>
      )}
      {error && (
        <p role="alert" className={classes.error}>
          {error}
        </p>
      )}
      <ConfirmDialog
        copy={
          removing && {
            title: `Remover a seção "${removing.name}"?`,
            body: 'Os produtos dela não são apagados: passam para um grupo "Sem categoria" no fim do cardápio, e continuam à venda.',
            cta: "Remover seção",
            tone: "danger",
          }
        }
        busy={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Rota e rail**

Em `apps/panel/src/router.tsx`, importe a página e acrescente a rota dentro de `PanelLayout`:

```tsx
import { CategoriesPage } from "./features/categories/CategoriesPage.tsx";
```

```tsx
              { path: "/secoes", handle: { title: "Seções do cardápio" }, element: <CategoriesPage /> },
```

Em `apps/panel/src/layout/Rail.tsx`, o grupo "Operação" passa a ser:

```tsx
  {
    title: "Operação",
    items: [
      { to: "/pedidos", label: "Pedidos" },
      { to: "/secoes", label: "Seções" },
    ],
  },
```

- [ ] **Step 6: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ adiciona seções do cardápio com ordem e contagem"
```

---

### Task 17: Lista de produtos

**Files:**
- Create: `apps/panel/src/api/products.ts`, `apps/panel/src/features/products/stock.ts`, `apps/panel/src/features/products/ProductsPage.tsx`, `ProductsPage.module.css`
- Modify: `apps/panel/src/router.tsx`, `apps/panel/src/layout/Rail.tsx`
- Test: `apps/panel/test/stock.test.ts`, `apps/panel/test/products-page.test.tsx`

**Interfaces:**
- Consumes: `listAllCategories` (Task 16); `formatCents` (Task 2).
- Produces:
  - `listProducts(restaurantId, query: { search?: string; categoryId?: string; limit: number; offset: number }): Promise<Page<Product>>`
  - `stockTone(stock): "danger" | "warn" | "normal"`, `stockText(stock): string`
  - `ProductsPage` (URL: `?search=`, `?category=`, `?page=`)

- [ ] **Step 1: Escrever os testes que falham**

`apps/panel/test/stock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stockText, stockTone } from "../src/features/products/stock.ts";

describe("estoque na grade", () => {
  it("vermelho esgotado, âmbar até 5", () => {
    expect(stockTone(0)).toBe("danger");
    expect(stockTone(5)).toBe("warn");
    expect(stockTone(6)).toBe("normal");
    expect(stockText(0)).toBe("esgotado");
    expect(stockText(12)).toBe("12");
  });
});
```

`apps/panel/test/products-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Product } from "../src/api/types.ts";
import { ProductsPage } from "../src/features/products/ProductsPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeCategory, makeProduct, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const PRODUCTS = `/restaurants/${RESTAURANT_ID}/products`;
const CATEGORIES = `/restaurants/${RESTAURANT_ID}/categories`;

function productsHandler(products: Product[], total = products.length): MockHandler {
  return { method: "GET", path: PRODUCTS, body: { data: products, limit: 20, offset: 0, total } };
}

function categoriesHandler(count = 1): MockHandler {
  const data = count === 0 ? [] : [makeCategory({ id: "cat-1", name: "Pizzas" })];
  return { method: "GET", path: CATEGORIES, body: { data, limit: 100, offset: 0, total: data.length } };
}

function setup(handlers: MockHandler[], path = "/produtos") {
  signIn();
  const api = mockApi([...handlers, ...panelHandlers()]);
  renderInPanel([{ path: "/produtos", element: <ProductsPage /> }], path);
  return api;
}

describe("ProductsPage", () => {
  it("mostra seção, preço, estoque e status — o estoque só aqui", async () => {
    setup([
      productsHandler([
        makeProduct({ id: "p1", name: "Pizza Grande", categoryId: "cat-1", priceInCents: 4590, stock: 12 }),
        makeProduct({ id: "p2", name: "Coca 2L", categoryId: undefined, priceInCents: 1200, stock: 0 }),
      ]),
      categoriesHandler(),
    ]);
    expect(await screen.findByText("Pizza Grande")).toBeTruthy();
    expect(await screen.findByText("Pizzas", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("R$ 45,90")).toBeTruthy();
    expect(screen.getByText("esgotado")).toBeTruthy();
    expect(screen.getByText("Esgotado")).toBeTruthy();
    expect(screen.getByText("Disponível")).toBeTruthy();
    expect(screen.getByText("2 de 2 produtos")).toBeTruthy();
    expect(
      screen.getByText("O estoque aparece só aqui. No cardápio público o cliente vê apenas disponível ou esgotado."),
    ).toBeTruthy();
  });

  it("a busca vai para a API depois de uma pausa na digitação", async () => {
    const api = setup([productsHandler([makeProduct()]), categoriesHandler()]);
    fireEvent.change(await screen.findByLabelText("Buscar por nome"), { target: { value: "pizza" } });
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === PRODUCTS && call.query.search === "pizza")).toBe(true),
    );
  });

  it("o chip da seção filtra pela seção", async () => {
    const api = setup([productsHandler([makeProduct()]), categoriesHandler()]);
    fireEvent.click(await screen.findByRole("button", { name: "Pizzas" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === PRODUCTS && call.query.categoryId === "cat-1")).toBe(true),
    );
  });

  it("paginação pede a próxima página", async () => {
    const api = setup([productsHandler([makeProduct()], 45), categoriesHandler()]);
    fireEvent.click(await screen.findByRole("button", { name: "Próxima" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === PRODUCTS && call.query.offset === "20")).toBe(true),
    );
  });

  it("cardápio vazio empurra para criar a primeira seção", async () => {
    setup([productsHandler([]), categoriesHandler(0)]);
    expect(await screen.findByText("Seu cardápio está vazio")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Criar a primeira seção" }).getAttribute("href")).toBe("/secoes");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- stock products-page`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: API e estoque**

`apps/panel/src/api/products.ts`:

```ts
import { apiRequest } from "./client.ts";
import type { Page, Product } from "./types.ts";

export type ProductListQuery = { search?: string; categoryId?: string; limit: number; offset: number };

export function listProducts(restaurantId: string, query: ProductListQuery): Promise<Page<Product>> {
  return apiRequest<Page<Product>>(`/restaurants/${restaurantId}/products`, { query });
}
```

`apps/panel/src/features/products/stock.ts`:

```ts
export function stockTone(stock: number): "danger" | "warn" | "normal" {
  if (stock === 0) return "danger";
  if (stock <= 5) return "warn";
  return "normal";
}

export function stockText(stock: number): string {
  return stock === 0 ? "esgotado" : String(stock);
}
```

- [ ] **Step 4: A tela**

`apps/panel/src/features/products/ProductsPage.module.css`:

```css
.page {
  display: grid;
  gap: 14px;
  padding: 18px 20px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.search {
  width: 260px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--mc-line);
  border-radius: 999px;
  background: var(--mc-surface);
  color: var(--mc-ink2);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.chip[aria-pressed="true"] {
  background: var(--mc-accent-soft);
  border-color: var(--mc-accent-line);
  color: var(--mc-accent-hi);
}

.new {
  margin-left: auto;
}

.table {
  overflow: hidden;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.head,
.row {
  display: grid;
  grid-template-columns: minmax(150px, 3fr) minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.1fr);
  align-items: center;
  gap: 12px;
  padding: 0 16px;
}

.head {
  min-height: 38px;
  background: var(--mc-surface2);
  border-bottom: 1px solid var(--mc-line);
}

.head span {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--mc-ink3);
}

.row {
  min-height: 44px;
  padding-top: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--mc-line);
  color: inherit;
  text-decoration: none;
}

.row:hover {
  background: var(--mc-surface2);
}

.product {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.thumb {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: 6px;
  background: var(--mc-surface3);
  object-fit: cover;
}

.names {
  min-width: 0;
  display: grid;
}

.name {
  font-size: 14px;
  font-weight: 600;
}

.description {
  overflow: hidden;
  font-size: 12.5px;
  color: var(--mc-ink3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.right {
  text-align: right;
  font-weight: 600;
}

.danger {
  color: var(--mc-danger);
}

.warn {
  color: var(--mc-warn);
}

.normal {
  color: var(--mc-ink);
}

.badge {
  justify-self: start;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.available {
  background: var(--mc-accent-soft);
  color: var(--mc-accent-hi);
}

.soldOut {
  background: var(--mc-danger-soft);
  color: var(--mc-danger);
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  font-size: 13px;
  color: var(--mc-ink3);
}

.pager {
  display: flex;
  gap: 8px;
}

.note {
  margin: 0;
  font-size: 12.5px;
  color: var(--mc-ink3);
}

.empty {
  display: grid;
  gap: 8px;
  justify-items: start;
  padding: 32px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 10px;
}

.emptyTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.emptyBody {
  margin: 0;
  max-width: 60ch;
  color: var(--mc-ink2);
}

.noResults {
  margin: 0;
  padding: 16px;
  color: var(--mc-ink3);
}
```

`apps/panel/src/features/products/ProductsPage.tsx`:

```tsx
import { Button, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { listAllCategories } from "../../api/categories.ts";
import { listProducts } from "../../api/products.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { formatCents } from "../../lib/money.ts";
import classes from "./ProductsPage.module.css";
import { stockText, stockTone } from "./stock.ts";

const PAGE_SIZE = 20;

function EmptyMenu() {
  return (
    <div className={classes.page}>
      <div className={classes.empty}>
        <p className={classes.emptyTitle}>Seu cardápio está vazio</p>
        <p className={classes.emptyBody}>
          Comece pelas seções — elas definem a ordem da refeição que o cliente vê. Depois cadastre os
          produtos dentro delas.
        </p>
        <Button component={Link} to="/secoes">
          Criar a primeira seção
        </Button>
      </div>
    </div>
  );
}

export function ProductsPage() {
  const { restaurantId } = useSessionUser();
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const categoryId = params.get("category") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [typed, setTyped] = useState(search);
  const [debounced] = useDebouncedValue(typed, 300);

  // a busca digitada vai para a URL (e dali para a API) depois da pausa
  useEffect(() => {
    const next = debounced.trim();
    if (next === search) return;
    const updated = new URLSearchParams(params);
    if (next) updated.set("search", next);
    else updated.delete("search");
    updated.delete("page");
    setParams(updated, { replace: true });
  }, [debounced, search, params, setParams]);

  const setParam = (name: "category" | "page", value: string | null) => {
    const updated = new URLSearchParams(params);
    if (value) updated.set(name, value);
    else updated.delete(name);
    if (name !== "page") updated.delete("page");
    setParams(updated);
  };

  const categories = useQuery({
    queryKey: ["categories", restaurantId],
    queryFn: () => listAllCategories(restaurantId),
  });
  const offset = (page - 1) * PAGE_SIZE;
  const products = useQuery({
    queryKey: ["products", restaurantId, "list", { search, categoryId, page }],
    queryFn: () =>
      listProducts(restaurantId, {
        search: search || undefined,
        categoryId: categoryId || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
  });

  const sectionName = new Map((categories.data ?? []).map((category) => [category.id, category.name]));
  const data = products.data;

  if (
    data !== undefined &&
    categories.data !== undefined &&
    data.total === 0 &&
    search === "" &&
    categoryId === "" &&
    categories.data.length === 0
  ) {
    return <EmptyMenu />;
  }

  const shownUpTo = data ? Math.min(offset + data.data.length, data.total) : 0;

  return (
    <div className={classes.page}>
      <div className={classes.toolbar}>
        <TextInput
          className={classes.search}
          aria-label="Buscar por nome"
          placeholder="Buscar por nome"
          value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
        />
        <div className={classes.chips} role="group" aria-label="Seção">
          <button
            type="button"
            className={classes.chip}
            aria-pressed={categoryId === ""}
            onClick={() => setParam("category", null)}
          >
            Todas
          </button>
          {(categories.data ?? []).map((category) => (
            <button
              key={category.id}
              type="button"
              className={classes.chip}
              aria-pressed={categoryId === category.id}
              onClick={() => setParam("category", category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
        <Button component={Link} to="/produtos/novo" className={classes.new}>
          Novo produto
        </Button>
      </div>

      <div className={classes.table}>
        <div className={classes.head}>
          <span>Produto</span>
          <span>Seção</span>
          <span className={classes.right}>Preço</span>
          <span className={classes.right}>Estoque</span>
          <span>Status</span>
        </div>
        {data !== undefined && data.data.length === 0 && (
          <p className={classes.noResults}>Nenhum produto encontrado.</p>
        )}
        {data?.data.map((product) => (
          <Link key={product.id} to={`/produtos/${product.id}`} className={classes.row}>
            <span className={classes.product}>
              {product.photoUrl ? (
                <img className={classes.thumb} src={product.photoUrl} alt="" />
              ) : (
                <span className={classes.thumb} aria-hidden="true" />
              )}
              <span className={classes.names}>
                <span className={classes.name}>{product.name}</span>
                {product.description && <span className={classes.description}>{product.description}</span>}
              </span>
            </span>
            <span>{product.categoryId ? (sectionName.get(product.categoryId) ?? "—") : "—"}</span>
            <span className={`${classes.right} n`}>{formatCents(product.priceInCents)}</span>
            <span className={`${classes.right} ${classes[stockTone(product.stock)]} n`}>
              {stockText(product.stock)}
            </span>
            <span className={`${classes.badge} ${product.stock > 0 ? classes.available : classes.soldOut}`}>
              {product.stock > 0 ? "Disponível" : "Esgotado"}
            </span>
          </Link>
        ))}
        <div className={classes.footer}>
          <span className="n">{data ? `${shownUpTo} de ${data.total} produtos` : ""}</span>
          <div className={classes.pager}>
            <Button variant="default" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>
              Anterior
            </Button>
            <Button
              variant="default"
              disabled={data === undefined || offset + PAGE_SIZE >= data.total}
              onClick={() => setParam("page", String(page + 1))}
            >
              Próxima
            </Button>
          </div>
        </div>
      </div>
      <p className={classes.note}>
        O estoque aparece só aqui. No cardápio público o cliente vê apenas disponível ou esgotado.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Rota e rail**

Em `apps/panel/src/router.tsx`:

```tsx
import { ProductsPage } from "./features/products/ProductsPage.tsx";
```

```tsx
              { path: "/produtos", handle: { title: "Produtos" }, element: <ProductsPage /> },
```

Em `apps/panel/src/layout/Rail.tsx`, o grupo "Operação" fica na ordem do handoff:

```tsx
    items: [
      { to: "/pedidos", label: "Pedidos" },
      { to: "/produtos", label: "Produtos" },
      { to: "/secoes", label: "Seções" },
    ],
```

- [ ] **Step 6: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ adiciona a lista de produtos com busca e estoque"
```

---

### Task 18: Criar e editar produto

**Files:**
- Create: `apps/panel/src/api/optionGroups.ts`, `apps/panel/src/features/products/productForm.ts`, `priceRules.ts`, `ProductFormPage.tsx`, `ProductFormPage.module.css`
- Modify: `apps/panel/src/api/products.ts`, `apps/panel/src/router.tsx`
- Test: `apps/panel/test/productForm.test.ts`, `apps/panel/test/product-form.test.tsx`

**Interfaces:**
- Consumes: `parseReaisToCents`, `centsToInput` (Task 2); `moveItem` (Task 16); `listAllCategories` (Task 16).
- Produces:
  - `getProduct`, `createProduct(restaurantId, body: CreateProductBody)`, `updateProduct(restaurantId, id, body: UpdateProductBody)`, `setProductOptionGroups(restaurantId, id, optionGroupIds)`; `listAllOptionGroups(restaurantId): Promise<OptionGroup[]>`
  - `type ProductForm`, `EMPTY_FORM`, `fromProduct(product)`, `type ValidProduct`, `validateProductForm(form)`, `toCreateBody(value)`, `toUpdateBody(value)`, `sameIds(a, b)`, `isDirty(current, initial)`
  - `PRICE_RULES: Record<PriceRule, { name; help; example }>`
  - `ProductFormPage` (`/produtos/novo` e `/produtos/:productId`)

- [ ] **Step 1: Escrever os testes que falham**

`apps/panel/test/productForm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM,
  fromProduct,
  isDirty,
  sameIds,
  toCreateBody,
  toUpdateBody,
  validateProductForm,
} from "../src/features/products/productForm.ts";
import { makeProduct } from "./fixtures.ts";

const valid = { ...EMPTY_FORM, name: " Pizza Grande ", price: "45,90", stock: "12", categoryId: "cat-1" };

describe("formulário de produto", () => {
  it("valida e converte o preço por string", () => {
    const result = validateProductForm(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Pizza Grande",
        description: "",
        priceInCents: 4590,
        stock: 12,
        categoryId: "cat-1",
        photoUrl: null,
        optionGroupIds: [],
      },
    });
  });

  it("recusa com mensagem que a pessoa entende", () => {
    expect(validateProductForm({ ...valid, name: "  " })).toEqual({ ok: false, error: "Informe o nome do produto." });
    expect(validateProductForm({ ...valid, price: "45,999" })).toEqual({
      ok: false,
      error: "Informe o preço no formato 12,50.",
    });
    expect(validateProductForm({ ...valid, stock: "-1" })).toEqual({
      ok: false,
      error: "O estoque é um número inteiro, zero ou mais.",
    });
    expect(validateProductForm({ ...valid, photoUrl: "foto.jpg" })).toEqual({
      ok: false,
      error: "Cole um endereço completo de imagem, começando com https://.",
    });
  });

  it("criação omite o que ficou vazio", () => {
    const result = validateProductForm({ ...valid, categoryId: "" });
    if (!result.ok) throw new Error("devia ser válido");
    expect(toCreateBody(result.value)).toEqual({ name: "Pizza Grande", priceInCents: 4590, stock: 12 });
  });

  it("edição manda categoryId null para tirar da seção", () => {
    const result = validateProductForm({ ...valid, categoryId: "", description: "Massa fina" });
    if (!result.ok) throw new Error("devia ser válido");
    expect(toUpdateBody(result.value)).toEqual({
      name: "Pizza Grande",
      priceInCents: 4590,
      stock: 12,
      categoryId: null,
      description: "Massa fina",
    });
  });

  it("carrega um produto existente para edição", () => {
    expect(fromProduct(makeProduct({ priceInCents: 4590, stock: 12, optionGroupIds: ["g1"] }))).toMatchObject({
      price: "45,90",
      stock: "12",
      categoryId: "cat-1",
      optionGroupIds: ["g1"],
    });
  });

  it("ordem dos grupos importa", () => {
    expect(sameIds(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameIds(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("detecta alteração", () => {
    expect(isDirty(EMPTY_FORM, EMPTY_FORM)).toBe(false);
    expect(isDirty({ ...EMPTY_FORM, name: "x" }, EMPTY_FORM)).toBe(true);
  });
});
```

`apps/panel/test/product-form.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductFormPage } from "../src/features/products/ProductFormPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeCategory, makeOptionGroup, makeProduct, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;

const reference: MockHandler[] = [
  {
    method: "GET",
    path: `${BASE}/categories`,
    body: { data: [makeCategory({ id: "cat-1", name: "Pizzas" })], limit: 100, offset: 0, total: 1 },
  },
  {
    method: "GET",
    path: `${BASE}/option-groups`,
    body: {
      data: [
        makeOptionGroup({ id: "grp-1", name: "Sabores", priceRule: "highest", minOptions: 1, maxOptions: 2 }),
        makeOptionGroup({ id: "grp-2", name: "Borda", priceRule: "sum", minOptions: 0, maxOptions: 1 }),
      ],
      limit: 100,
      offset: 0,
      total: 2,
    },
  },
];

const routes = [
  { path: "/produtos/novo", element: <ProductFormPage /> },
  { path: "/produtos/:productId", element: <ProductFormPage /> },
  { path: "/produtos", element: <LocationProbe /> },
];

function setup(handlers: MockHandler[], path: string) {
  signIn();
  const api = mockApi([...handlers, ...reference, ...panelHandlers()]);
  renderInPanel(routes, path);
  return api;
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("ProductFormPage", () => {
  it("cria o produto e depois grava os grupos na ordem escolhida", async () => {
    const api = setup(
      [
        { method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) },
        { method: "PUT", path: `${BASE}/products/prod-9/option-groups`, body: { optionGroups: [] } },
      ],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    type("Estoque", "12");
    await screen.findByRole("option", { name: "Pizzas" });
    type("Seção", "cat-1");
    await screen.findByRole("option", { name: "Sabores" });
    type("Adicionar grupo já cadastrado", "grp-1");
    type("Adicionar grupo já cadastrado", "grp-2");
    expect(screen.getByText("Mais caro")).toBeTruthy();
    expect(screen.getByText("Margherita R$ 62 + Calabresa R$ 72 → R$ 72,00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Subir Borda" }));
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect((await screen.findByTestId("location")).textContent).toBe("/produtos");
    expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "Pizza Grande",
      priceInCents: 4590,
      stock: 12,
      categoryId: "cat-1",
    });
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({ optionGroupIds: ["grp-2", "grp-1"] });
  });

  it("editar sem mexer nos grupos não regrava os grupos; 'Sem seção' manda null", async () => {
    const api = setup(
      [
        {
          method: "GET",
          path: `${BASE}/products/prod-1`,
          body: makeProduct({ id: "prod-1", optionGroupIds: ["grp-1"] }),
        },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
      ],
      "/produtos/prod-1",
    );
    expect(((await screen.findByLabelText("Preço (R$)")) as HTMLInputElement).value).toBe("45,90");
    type("Seção", "");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await screen.findByTestId("location");
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      categoryId: null,
      priceInCents: 4590,
    });
    expect(api.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("grupos que falham não escondem que o produto foi salvo", async () => {
    setup(
      [
        {
          method: "GET",
          path: `${BASE}/products/prod-1`,
          body: makeProduct({ id: "prod-1", optionGroupIds: ["grp-1"] }),
        },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
        {
          method: "PUT",
          path: `${BASE}/products/prod-1/option-groups`,
          status: 400,
          body: { message: "Grupo de opções inexistente" },
        },
      ],
      "/produtos/prod-1",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remover Sabores" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(
      await screen.findByText("O produto foi salvo, mas os grupos de opções não: Grupo de opções inexistente"),
    ).toBeTruthy();
  });

  it("preço inválido não chega à API", async () => {
    const api = setup([], "/produtos/novo");
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza");
    type("Preço (R$)", "45,999");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(screen.getByText("Informe o preço no formato 12,50.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test -- productForm product-form`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: API**

Acrescente ao fim de `apps/panel/src/api/products.ts` (e `OptionGroup` ao import de tipos):

```ts
export type CreateProductBody = {
  name: string;
  priceInCents: number;
  stock: number;
  categoryId?: string;
  description?: string;
  photoUrl?: string;
};

/**
 * `categoryId: null` tira da seção (a API usa `nullable`, F12). `photoUrl`
 * não tem como ser apagada — o campo é `format: uri` e não aceita null —, então
 * só vai quando preenchida (pendência de backend).
 */
export type UpdateProductBody = {
  name: string;
  priceInCents: number;
  stock: number;
  categoryId: string | null;
  description: string;
  photoUrl?: string;
};

export function getProduct(restaurantId: string, id: string): Promise<Product> {
  return apiRequest<Product>(`/restaurants/${restaurantId}/products/${id}`);
}

export function createProduct(restaurantId: string, body: CreateProductBody): Promise<Product> {
  return apiRequest<Product>(`/restaurants/${restaurantId}/products`, { method: "POST", body });
}

export function updateProduct(restaurantId: string, id: string, body: UpdateProductBody): Promise<Product> {
  return apiRequest<Product>(`/restaurants/${restaurantId}/products/${id}`, { method: "PATCH", body });
}

/** A ORDEM do array é a ordem em que o cliente vê os grupos. */
export function setProductOptionGroups(
  restaurantId: string,
  id: string,
  optionGroupIds: string[],
): Promise<{ optionGroups: OptionGroup[] }> {
  return apiRequest<{ optionGroups: OptionGroup[] }>(
    `/restaurants/${restaurantId}/products/${id}/option-groups`,
    { method: "PUT", body: { optionGroupIds } },
  );
}
```

`apps/panel/src/api/optionGroups.ts`:

```ts
import { apiRequest } from "./client.ts";
import { fetchAllPages } from "./pagination.ts";
import type { OptionGroup, Page } from "./types.ts";

export function listAllOptionGroups(restaurantId: string): Promise<OptionGroup[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<OptionGroup>>(`/restaurants/${restaurantId}/option-groups`, {
      query: { limit: 100, offset },
    }),
  );
}
```

- [ ] **Step 4: Regras do formulário e das regras de preço**

`apps/panel/src/features/products/priceRules.ts`:

```ts
import type { PriceRule } from "../../api/types.ts";

/**
 * Texto FIXO do handoff, com exemplo em reais. De propósito não é um cálculo
 * com as opções reais: o front não duplica a regra de `unitPrice()` da API.
 */
export const PRICE_RULES: Record<PriceRule, { name: string; help: string; example: string }> = {
  sum: {
    name: "Somar",
    help: "soma o preço de tudo que foi escolhido",
    example: "Bacon +R$ 6,00 e Ovo +R$ 3,00 → R$ 9,00",
  },
  highest: {
    name: "Mais caro",
    help: "cobra só a opção mais cara das escolhidas",
    example: "Margherita R$ 62 + Calabresa R$ 72 → R$ 72,00",
  },
  average: {
    name: "Média",
    help: "cobra a média das opções escolhidas",
    example: "Margherita R$ 62 + Calabresa R$ 72 → R$ 67,00",
  },
};
```

`apps/panel/src/features/products/productForm.ts`:

```ts
import type { CreateProductBody, UpdateProductBody } from "../../api/products.ts";
import type { Product } from "../../api/types.ts";
import { centsToInput, parseReaisToCents } from "../../lib/money.ts";

/** O que a pessoa digita: tudo texto, até ser validado. */
export type ProductForm = {
  name: string;
  description: string;
  price: string;
  stock: string;
  categoryId: string;
  photoUrl: string;
  optionGroupIds: string[];
};

export const EMPTY_FORM: ProductForm = {
  name: "",
  description: "",
  price: "",
  stock: "0",
  categoryId: "",
  photoUrl: "",
  optionGroupIds: [],
};

export function fromProduct(product: Product): ProductForm {
  return {
    name: product.name,
    description: product.description ?? "",
    price: centsToInput(product.priceInCents),
    stock: String(product.stock),
    categoryId: product.categoryId ?? "",
    photoUrl: product.photoUrl ?? "",
    optionGroupIds: [...product.optionGroupIds],
  };
}

export type ValidProduct = {
  name: string;
  description: string;
  priceInCents: number;
  stock: number;
  categoryId: string | null;
  photoUrl: string | null;
  optionGroupIds: string[];
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateProductForm(
  form: ProductForm,
): { ok: true; value: ValidProduct } | { ok: false; error: string } {
  const name = form.name.trim();
  if (name === "") return { ok: false, error: "Informe o nome do produto." };
  const priceInCents = parseReaisToCents(form.price);
  if (priceInCents === null) return { ok: false, error: "Informe o preço no formato 12,50." };
  const stock = form.stock.trim();
  if (!/^\d+$/.test(stock)) return { ok: false, error: "O estoque é um número inteiro, zero ou mais." };
  const photoUrl = form.photoUrl.trim();
  if (photoUrl !== "" && !isHttpUrl(photoUrl)) {
    return { ok: false, error: "Cole um endereço completo de imagem, começando com https://." };
  }
  return {
    ok: true,
    value: {
      name,
      description: form.description.trim(),
      priceInCents,
      stock: Number(stock),
      categoryId: form.categoryId === "" ? null : form.categoryId,
      photoUrl: photoUrl === "" ? null : photoUrl,
      optionGroupIds: form.optionGroupIds,
    },
  };
}

export function toCreateBody(value: ValidProduct): CreateProductBody {
  return {
    name: value.name,
    priceInCents: value.priceInCents,
    stock: value.stock,
    ...(value.categoryId !== null ? { categoryId: value.categoryId } : {}),
    ...(value.description !== "" ? { description: value.description } : {}),
    ...(value.photoUrl !== null ? { photoUrl: value.photoUrl } : {}),
  };
}

export function toUpdateBody(value: ValidProduct): UpdateProductBody {
  return {
    name: value.name,
    priceInCents: value.priceInCents,
    stock: value.stock,
    categoryId: value.categoryId,
    description: value.description,
    ...(value.photoUrl !== null ? { photoUrl: value.photoUrl } : {}),
  };
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function isDirty(current: ProductForm, initial: ProductForm): boolean {
  return JSON.stringify(current) !== JSON.stringify(initial);
}
```

- [ ] **Step 5: A tela**

`apps/panel/src/features/products/ProductFormPage.module.css`:

```css
.page {
  display: grid;
  gap: 14px;
  max-width: 1180px;
  padding: 18px 20px 90px;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--mc-accent);
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
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

.note {
  margin: 0;
  font-size: 12.5px;
  color: var(--mc-ink3);
}

.priceRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 12px;
}

.group {
  display: flex;
  gap: 10px;
  padding: 12px;
  background: var(--mc-surface2);
  border: 1px solid var(--mc-line);
  border-radius: 6px;
}

.arrows {
  display: grid;
  gap: 4px;
  align-content: start;
}

.groupMain {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 4px;
}

.groupName {
  font-weight: 700;
}

.range {
  font-size: 12.5px;
  color: var(--mc-ink3);
}

.rule {
  margin: 0;
  font-size: 13px;
  color: var(--mc-ink2);
}

.example {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--mc-surface3);
  font-size: 12.5px;
}

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

.error {
  margin: 0;
  font-size: 13.5px;
  color: var(--mc-danger);
}

.loading {
  padding: 18px 20px;
  color: var(--mc-ink2);
}

@media (max-width: 960px) {
  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

`apps/panel/src/features/products/ProductFormPage.tsx`:

```tsx
import { ActionIcon, Button, NativeSelect, Textarea, TextInput } from "@mantine/core";
import { IconArrowDown, IconArrowLeft, IconArrowUp } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { listAllCategories } from "../../api/categories.ts";
import { describeError } from "../../api/client.ts";
import { listAllOptionGroups } from "../../api/optionGroups.ts";
import { createProduct, getProduct, setProductOptionGroups, updateProduct } from "../../api/products.ts";
import type { Category, OptionGroup, Product } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { moveItem } from "../../lib/moveItem.ts";
import buttons from "../../ui/buttons.module.css";
import { PRICE_RULES } from "./priceRules.ts";
import classes from "./ProductFormPage.module.css";
import {
  EMPTY_FORM,
  fromProduct,
  isDirty,
  type ProductForm,
  sameIds,
  toCreateBody,
  toUpdateBody,
  validateProductForm,
  type ValidProduct,
} from "./productForm.ts";

/** O produto foi salvo; só o PUT dos grupos falhou. */
class GroupsNotSaved extends Error {
  readonly productId: string;

  constructor(productId: string, message: string) {
    super(message);
    this.name = "GroupsNotSaved";
    this.productId = productId;
  }
}

function ProductEditor({
  restaurantId,
  product,
  categories,
  groups,
}: {
  restaurantId: string;
  product: Product | undefined;
  categories: readonly Category[];
  groups: readonly OptionGroup[];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const initial = product ? fromProduct(product) : EMPTY_FORM;
  const [form, setForm] = useState<ProductForm>(initial);
  const [error, setError] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  );
  const update = (patch: Partial<ProductForm>) => setForm((current) => ({ ...current, ...patch }));

  const save = useMutation({
    mutationFn: async (value: ValidProduct) => {
      const saved = product
        ? await updateProduct(restaurantId, product.id, toUpdateBody(value))
        : await createProduct(restaurantId, toCreateBody(value));
      // Duas chamadas: se a segunda falhar, o produto JÁ está salvo — e o
      // erro precisa dizer isso, senão a pessoa salva de novo e duplica.
      if (!sameIds(product?.optionGroupIds ?? [], value.optionGroupIds)) {
        try {
          await setProductOptionGroups(restaurantId, saved.id, value.optionGroupIds);
        } catch (cause) {
          throw new GroupsNotSaved(saved.id, describeError(cause));
        }
      }
      return saved;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products", restaurantId] });
      navigate("/produtos");
    },
    onError: (cause) => {
      if (!(cause instanceof GroupsNotSaved)) {
        setError(describeError(cause));
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["products", restaurantId] });
      const notice = `O produto foi salvo, mas os grupos de opções não: ${cause.message}`;
      if (product) setError(notice);
      // produto recém-criado: a tela passa a ser a de edição, senão salvar de
      // novo criaria um segundo produto
      else navigate(`/produtos/${cause.productId}`, { replace: true, state: { notice } });
    },
  });

  const submit = () => {
    const result = validateProductForm(form);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    save.mutate(result.value);
  };

  const available = groups.filter((group) => !form.optionGroupIds.includes(group.id));

  return (
    <>
      <div className={classes.page}>
        <Link to="/produtos" className={classes.back}>
          <IconArrowLeft size={14} /> Produtos
        </Link>
        <div className={classes.columns}>
          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Dados do produto</h2>
            <TextInput label="Nome" value={form.name} onChange={(e) => update({ name: e.currentTarget.value })} />
            <Textarea
              label="Descrição"
              rows={3}
              placeholder="Massa fina, 8 fatias. Escolha até 2 sabores."
              value={form.description}
              onChange={(e) => update({ description: e.currentTarget.value })}
            />
            <div className={classes.priceRow}>
              <TextInput
                label="Preço (R$)"
                placeholder="0,00"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => update({ price: e.currentTarget.value })}
              />
              <TextInput
                label="Estoque"
                inputMode="numeric"
                value={form.stock}
                onChange={(e) => update({ stock: e.currentTarget.value })}
              />
              <NativeSelect
                label="Seção"
                value={form.categoryId}
                onChange={(e) => update({ categoryId: e.currentTarget.value })}
                data={[
                  { value: "", label: "Sem seção" },
                  ...categories.map((category) => ({ value: category.id, label: category.name })),
                ]}
              />
            </div>
            <TextInput
              label="URL da foto"
              placeholder="https://"
              description="Ainda não há upload de imagem: cole o endereço de uma foto já publicada."
              value={form.photoUrl}
              onChange={(e) => update({ photoUrl: e.currentTarget.value })}
            />
          </section>

          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Grupos de opções</h2>
            <p className={classes.note}>
              A ordem aqui é a ordem que o cliente vê. Os grupos pertencem à loja — crie e edite em Grupos
              de opções.
            </p>
            {form.optionGroupIds.map((id, index) => {
              const group = groups.find((candidate) => candidate.id === id);
              if (group === undefined) return null;
              const rule = PRICE_RULES[group.priceRule];
              return (
                <div key={id} className={classes.group}>
                  <div className={classes.arrows}>
                    <ActionIcon
                      variant="default"
                      size={26}
                      aria-label={`Subir ${group.name}`}
                      disabled={index === 0}
                      onClick={() => update({ optionGroupIds: moveItem(form.optionGroupIds, index, index - 1) })}
                    >
                      <IconArrowUp size={12} />
                    </ActionIcon>
                    <ActionIcon
                      variant="default"
                      size={26}
                      aria-label={`Descer ${group.name}`}
                      disabled={index === form.optionGroupIds.length - 1}
                      onClick={() => update({ optionGroupIds: moveItem(form.optionGroupIds, index, index + 1) })}
                    >
                      <IconArrowDown size={12} />
                    </ActionIcon>
                  </div>
                  <div className={classes.groupMain}>
                    <span>
                      <span className={classes.groupName}>{group.name}</span>{" "}
                      <span className={`${classes.range} n`}>
                        escolhe {group.minOptions} a {group.maxOptions}
                      </span>
                    </span>
                    <p className={classes.rule}>
                      <strong>{rule.name}</strong> — {rule.help}
                    </p>
                    <p className={classes.example}>{rule.example}</p>
                  </div>
                  <Button
                    variant="subtle"
                    className={buttons.dangerText}
                    aria-label={`Remover ${group.name}`}
                    onClick={() =>
                      update({ optionGroupIds: form.optionGroupIds.filter((groupId) => groupId !== id) })
                    }
                  >
                    Remover
                  </Button>
                </div>
              );
            })}
            {available.length > 0 && (
              <NativeSelect
                aria-label="Adicionar grupo já cadastrado"
                value=""
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  if (id !== "") update({ optionGroupIds: [...form.optionGroupIds, id] });
                }}
                data={[
                  { value: "", label: "Adicionar grupo já cadastrado" },
                  ...available.map((group) => ({ value: group.id, label: group.name })),
                ]}
              />
            )}
          </section>
        </div>
        {error && (
          <p role="alert" className={classes.error}>
            {error}
          </p>
        )}
      </div>
      <div className={classes.saveBar}>
        {isDirty(form, initial) && <span className={classes.dirty}>Alterações não salvas</span>}
        <Button component={Link} to="/produtos" variant="default">
          Cancelar
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          Salvar produto
        </Button>
      </div>
    </>
  );
}

export function ProductFormPage() {
  const { productId } = useParams();
  const { restaurantId } = useSessionUser();
  const product = useQuery({
    queryKey: ["products", restaurantId, "detail", productId],
    queryFn: () => getProduct(restaurantId, productId as string),
    enabled: productId !== undefined,
  });
  const categories = useQuery({
    queryKey: ["categories", restaurantId],
    queryFn: () => listAllCategories(restaurantId),
  });
  const groups = useQuery({
    queryKey: ["option-groups", restaurantId],
    queryFn: () => listAllOptionGroups(restaurantId),
  });

  if (productId !== undefined && product.isPending) {
    return <p className={classes.loading}>Carregando produto…</p>;
  }
  if (productId !== undefined && product.isError) {
    return <p className={classes.loading}>{describeError(product.error)}</p>;
  }
  // `key` recria o editor quando o produto muda: o estado do formulário nasce
  // dos dados, sem setState num efeito.
  return (
    <ProductEditor
      key={productId ?? "novo"}
      restaurantId={restaurantId}
      product={product.data}
      categories={categories.data ?? []}
      groups={groups.data ?? []}
    />
  );
}
```

> O `Button` "Remover" de cada grupo usa `aria-label={`Remover ${group.name}`}` para o teste distinguir os grupos; o texto visível continua "Remover".

- [ ] **Step 6: Rotas**

Em `apps/panel/src/router.tsx`:

```tsx
import { ProductFormPage } from "./features/products/ProductFormPage.tsx";
```

```tsx
              { path: "/produtos/novo", handle: { title: "Novo produto" }, element: <ProductFormPage /> },
              { path: "/produtos/:productId", handle: { title: "Editar produto" }, element: <ProductFormPage /> },
```

- [ ] **Step 7: Rodar e ver passar**

Run: `unset -f node npm npx pnpm nvm 2>/dev/null; pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: todos PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ cria e edita produto com os grupos de opções em ordem"
```

---

### Task 19: Documentação e verificação final

**Files:**
- Create: `apps/panel/.env.example`
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md`

- [ ] **Step 1: `.env.example` do painel**

`apps/panel/.env.example`:

```bash
# Copie para .env.local — o Vite carrega sozinho as variáveis VITE_*.

# Base da API. No dev, o default `/api` passa pelo proxy do Vite (vite.config.ts)
# até http://localhost:3333, sem precisar de CORS_ORIGINS. Em produção, aponte
# para onde a API estiver — hospedagem do painel ainda é decisão aberta.
# VITE_API_URL=/api

# Link do "Falar com o suporte" na tela de bloqueio de e-mail. Sem ele, o botão
# não aparece (a tela continua explicando as duas saídas).
# VITE_SUPPORT_URL=https://wa.me/5511999999999
```

- [ ] **Step 2: `CLAUDE.md`**

1. No parágrafo "O que é", troque `Está em fase inicial: hoje existe só a API (` por `Está em fase inicial: existem a API e o painel da loja (\`apps/panel\`, parte 1 — acesso, pedidos e cardápio). A API tem (`.

2. Em "Comandos", depois da linha do `openapi:generate`, acrescente:

```bash
pnpm --filter @menuclick/panel dev            # painel em http://localhost:5173 (proxy /api → :3333)
pnpm --filter @menuclick/panel test           # testes do painel (jsdom, sem banco)
pnpm --filter @menuclick/panel build          # type-check + vite build
```

3. Antes de `### Monorepo`, acrescente a seção:

```markdown
### Painel da loja (`apps/panel`)

SPA em Vite + React 19 + Mantine 9 + React Router 8 + TanStack Query 5 — **o painel não tem SSR**: está inteiro atrás de login e o token Bearer mora no navegador. Spec: `docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md`; handoff de design (tokens, medidas e **copy final**) em `docs/design/painel-da-loja/`.

- **A copy do handoff é literal.** Os desvios estão na tabela "Onde este desenho diverge do handoff" da spec — mudar um texto fora dela é decisão, não ajuste.
- **Cor só por `var(--mc-*)`**, injetada pelo `cssVariablesResolver` a partir de `src/theme/tokens.ts` (o único arquivo com hex). Sem sombra, sem transição, sem animação.
- **Toda chamada passa por `apiRequest`** (`src/api/client.ts`): ele põe o Bearer, só declara `Content-Type` quando há corpo (o Fastify recusa JSON vazio com 400) e trata 401 com sessão como sessão expirada.
- **Tudo que é pedido tem chave de query começando em `"orders"`**, para uma invalidação cobrir lista, detalhe, pendentes e resumo. O header e o futuro Resumo leem a MESMA query de resumo.
- **Polling de 10 s continua com a aba em segundo plano** (`refetchIntervalInBackground`): o painel passa o dia atrás de outras janelas. O aviso de pedido novo (bipe, título da aba, contador) vigia os `pending` de qualquer data, na casca — toca em qualquer tela.
- **A lista de pedidos pagina até o fim** (`fetchAllPages`): com "mais recentes" num dia cheio, um pedido aberto antigo sumiria do kanban.
- **"Aceitar" encadeia `confirm` + `start-preparing`**; se o segundo falhar, o pedido fica `confirmed` com "Começar preparo" como rede. Cancelar tem **três** textos (recusar / devolve / não devolve estoque), regra em `features/orders/orderRules.ts`.
- ⚠️ **Token em `localStorage` é provisório** (pendência de integração); as rotas `/recuperar-senha` e `/verificar-email` casam com os defaults de `PASSWORD_RESET_URL` e `EMAIL_VERIFICATION_URL`. O `MENU_BASE_URL` default também aponta para `:5173` — até o cardápio do cliente existir, o QR de uma mesa abriria o painel.
- **Testes:** Vitest + Testing Library + jsdom, `fetch` mockado por `test/api-mock.ts`, Mantine com `env="test"`. Não há `jest-dom`.
```

- [ ] **Step 3: Estado da spec**

Em `docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md`, troque `**Estado:** aprovado, não implementado (branch \`feat/painel-da-loja\`)` por `**Estado:** implementado (branch \`feat/painel-da-loja\`)`.

- [ ] **Step 4: Verificação completa**

Run:

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm lint
pnpm build
pnpm --filter @menuclick/panel test
```

Expected: lint limpo; `turbo build` passa nos dois apps; todos os testes do painel PASS.

A API não mudou neste plano, mas a suíte dela continua no CI. Se o Postgres estiver de pé: `pnpm --filter @menuclick/api test` — Expected: PASS.

- [ ] **Step 5: Conferência manual contra a API real**

Com o Postgres de pé e a API migrada e semeada (`pnpm --filter @menuclick/api migrate:up && pnpm --filter @menuclick/api db:seed`):

```bash
unset -f node npm npx pnpm nvm 2>/dev/null
pnpm dev
```

Abra `http://localhost:5173` e confira, anotando o que divergir:

1. Login com `dono@tokyoramen.com.br` / `senha-de-exemplo-123`. ⚠️ Num banco **novo** a loja do seed pode estar **não verificada** (o backfill da migration só alcança o que já existia quando ela rodou): o painel cai no bloqueio. Clique em "Não recebi, reenviar", copie o link que o driver de console escreve no log da API e abra-o — é o fluxo de verificação inteiro, de graça.
2. Pedidos: o pedido pendente do seed aparece em Novos, com contador âmbar no rail e `(1) Pedidos · MenuClick` na aba. Aceite: o modal tem o texto de irreversibilidade; o pedido vai para Em preparo.
3. Drawer: itens, "Itens"/frete/total fecham a conta; Andamento com a hora de chegada.
4. Pausa no header: a faixa aparece; recarregue — continua pausada.
5. Seções: reordene com ↑↓, tente criar uma com nome repetido em outra caixa.
6. Produtos: busque, filtre por seção, edite um preço (`45,90`) e confira na lista.
7. Tema escuro pelo menu da conta.

- [ ] **Step 6: Commit da documentação**

```bash
git add CLAUDE.md apps/panel/.env.example docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md
git commit -m "docs(panel): 📝 documenta o painel da loja no claude.md"
```
