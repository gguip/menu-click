# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

MenuClick — plataforma de cardápio digital, QR code e delivery para restaurantes (estilo Goomer). Monorepo Turborepo + pnpm. Está em fase inicial: hoje existe só a API com um health check. O produto é construído **incrementalmente, começando simples** — não adicione dependências, camadas ou apps que não foram pedidos.

## Comandos

Rodar da raiz (Turborepo orquestra os workspaces). pnpm é gerenciado por corepack (versão fixada em `packageManager`).

```bash
pnpm install                       # instala tudo no monorepo
pnpm dev                           # sobe todos os apps em watch (API em http://localhost:3333)
pnpm build                         # type-check de todos os pacotes (tsc --noEmit)
pnpm start                         # sobe os apps em modo produção

pnpm --filter @menuclick/api dev   # roda um script só num pacote
curl http://localhost:3333/health  # smoke test da API
```

A API respeita `PORT` (default 3333) e `HOST` (default 0.0.0.0).

**Ainda não há test runner nem linter configurados** — é intencional (só TS + Fastify). Se precisar rodar/adicionar testes, confirme antes de trazer uma lib nova.

## Arquitetura

### Runtime: TypeScript nativo do Node (o ponto mais importante)

Não há bundler, `tsx`, `ts-node` nem passo de emit. O Node executa `.ts` diretamente via **type stripping** (`node src/server.ts`). Consequências que valem para todo código novo:

- **Requer Node >= 23.6** (fixado em `engines`; dev machine usa Node 24).
- **Imports locais precisam da extensão `.ts`** — ex.: `import { healthRoutes } from "./routes/health.ts"`. Sem a extensão o Node não resolve.
- **Só sintaxe "apagável"** é permitida (enforçado por `erasableSyntaxOnly` no tsconfig): **sem** `enum`, **sem** `namespace` com valor em runtime, **sem** parameter properties no construtor. Imports de tipo usam `import type` (`verbatimModuleSyntax` está ligado).
- **Não existe `dist/`.** O script `build` é `tsc --noEmit` — serve só como type-check. Produção roda o `.ts` direto (`start` = `node src/server.ts`).
- **Deps CJS com `export default`** (ex.: `ajv`, `ajv-formats`) quebram o `import default` no type-check sob `NodeNext` + `verbatimModuleSyntax` (`This expression is not constructable`). Carregue via `createRequire(import.meta.url)` e tipe pelo módulo: `const Ajv = nodeRequire("ajv") as typeof import("ajv")["default"]`. Ver `apps/api/src/routes/restaurants.ts`.

### Estrutura do server (Fastify)

`apps/api/src/server.ts` é o entrypoint: cria a instância Fastify (com logger), registra os plugins de rota via `app.register(...)`, e faz o `listen`. Rotas ficam em `apps/api/src/routes/` como **plugins async** — funções `async (app: FastifyInstance) => { app.get(...) }`. **Para adicionar uma rota:** crie o arquivo em `routes/`, exporte a função de plugin, e registre-a em `server.ts` (lembrando da extensão `.ts` no import).

### Monorepo

Turborepo (`turbo.json`) + pnpm workspaces (`pnpm-workspace.yaml`: `apps/*` + `packages/*`). `packages/` existe mas está vazio (reservado para libs compartilhadas). As tasks `dev`/`start` são `persistent` e sem cache; `build` depende de `^build` (builds das dependências primeiro).

## Convenções

- Código de domínio/identificadores em inglês; textos e mensagens voltadas ao usuário em pt-BR.
- Mantenha as dependências mínimas — o dono do projeto prefere só o que foi pedido explicitamente.

## Regras

Regras detalhadas ficam em `.claude/rules/` e são carregadas automaticamente pelos imports abaixo. Ao trabalhar na API, **siga as regras do Fastify**; ao commitar, **siga o padrão de commits**.

@.claude/rules/fastify.md
@.claude/rules/commits.md
