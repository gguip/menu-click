# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

MenuClick — plataforma de cardápio digital, QR code e delivery para restaurantes (estilo Goomer). Monorepo Turborepo + pnpm. Está em fase inicial: hoje existe só a API (health check, CRUD de restaurantes no Postgres e CRUD de produtos ainda em memória). O produto é construído **incrementalmente, começando simples** — não adicione dependências, camadas ou apps que não foram pedidos.

## Comandos

Rodar da raiz (Turborepo orquestra os workspaces). pnpm é gerenciado por corepack (versão fixada em `packageManager`).

```bash
pnpm install                       # instala tudo no monorepo
pnpm dev                           # sobe todos os apps em watch (API em http://localhost:3333)
pnpm build                         # type-check de todos os pacotes (tsc --noEmit)
pnpm start                         # sobe os apps em modo produção

pnpm --filter @menuclick/api dev   # roda um script só num pacote
curl http://localhost:3333/health  # smoke test da API

pnpm --filter @menuclick/api migrate:up       # aplica as migrations pendentes
pnpm --filter @menuclick/api migrate:down     # desfaz a última migration
pnpm --filter @menuclick/api migrate:create X # cria uma migration SQL nova
pnpm --filter @menuclick/api db:seed          # popula dados de exemplo (idempotente)
```

A API respeita `PORT` (default 3333) e `HOST` (default 0.0.0.0), e conecta no Postgres via `DATABASE_URL` **ou** `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` (+ `DB_POOL_MAX`). Os scripts do pacote carregam `apps/api/.env` com `node --env-file-if-exists=.env` — **não use dotenv**. Copie `apps/api/.env.example` para começar.

**Ainda não há test runner nem linter configurados** — é intencional (só TS + Fastify). Se precisar rodar/adicionar testes, confirme antes de trazer uma lib nova.

## Arquitetura

### Runtime: TypeScript nativo do Node (o ponto mais importante)

Não há bundler, `tsx`, `ts-node` nem passo de emit. O Node executa `.ts` diretamente via **type stripping** (`node src/server.ts`). Consequências que valem para todo código novo:

- **Requer Node >= 23.6** (fixado em `engines`; dev machine usa Node 24).
- **Imports locais precisam da extensão `.ts`** — ex.: `import { healthRoutes } from "./routes/health.ts"`. Sem a extensão o Node não resolve.
- **Só sintaxe "apagável"** é permitida (enforçado por `erasableSyntaxOnly` no tsconfig): **sem** `enum`, **sem** `namespace` com valor em runtime, **sem** parameter properties no construtor. Imports de tipo usam `import type` (`verbatimModuleSyntax` está ligado).
- **Não existe `dist/`.** O script `build` é `tsc --noEmit` — serve só como type-check. Produção roda o `.ts` direto (`start` = `node src/server.ts`).
- **Deps CJS com `export default`** (ex.: `ajv`, `ajv-formats`) quebram o `import default` no type-check sob `NodeNext` + `verbatimModuleSyntax` (`This expression is not constructable`). Carregue via `createRequire(import.meta.url)` e tipe pelo módulo: `const Ajv = nodeRequire("ajv") as typeof import("ajv")["default"]`. Ver `apps/api/src/routes/products.ts`.

### Estrutura do server (Fastify)

`apps/api/src/server.ts` é o entrypoint: chama o `buildApp()` de `app.ts` e faz o `listen`. É o `app.ts` que cria a instância Fastify (com logger), registra os plugins de rota via `app.register(...)` e instala o error handler central. Rotas ficam em `apps/api/src/routes/` como **plugins async** — funções `async (app: FastifyInstance) => { app.get(...) }`. **Para adicionar uma rota:** crie o arquivo em `routes/`, exporte a função de plugin, e registre-a no `buildApp()` (lembrando da extensão `.ts` no import).

### Três camadas: rota → serviço → repositório

O domínio (restaurantes e produtos) é dividido em três camadas, e cada uma só conhece a de baixo:

- **`src/routes/` (controller)** — só HTTP: JSON Schema de entrada/saída, ler `params`/`body`, chamar o serviço e escolher o status code do caminho feliz. **Nunca escreve SQL nem importa `pool`/repositório.**
- **`src/services/`** — a regra de negócio: "produto só existe dentro de restaurante vivo", a transação da compra, a cascata do soft delete. Não conhece Fastify (nada de `request`/`reply`) e não escreve SQL. Quando a operação não pode acontecer, **lança erro tipado** de `src/errors.ts` (`NotFoundError`, `ConflictError`).
- **`src/repositories/`** — só acesso a dados: as queries parametrizadas, os tipos de linha (`snake_case`) e o mapper para o formato camelCase. Sem regra de negócio: "não achei" volta como `null`/`false`. Cada função recebe um `Queryable` opcional no fim (pool por padrão, ou o `client` quando o serviço abriu uma transação).

`src/domain/` guarda só os **tipos** compartilhados pelas três camadas (e o `isUuid`), sem runtime.

**Erro de negócio nunca vira status code na rota.** O serviço lança `NotFoundError`/`ConflictError` e o `setErrorHandler()` do `app.ts` traduz para **404**/**409**, com o corpo `{ statusCode, error, message }`. Nenhuma rota monta corpo de erro na mão.

### Banco: Postgres via `pg` (sem ORM)

`apps/api/src/db/pool.ts` exporta um **`Pool` singleton** do driver `pg` (e o helper `withTransaction()`), configurado só por env (ver acima). Não há ORM, query builder nem plugin Fastify no meio: os **repositórios** (`src/repositories/`) importam `pool` direto e escrevem SQL na mão — e são o único lugar do código com SQL. Restaurantes e produtos já vivem no Postgres — não há mais nada em memória.

O `server.ts` fecha o pool no hook `onClose` e trata `SIGINT`/`SIGTERM` (F26). Requer **Postgres >= 13** (`gen_random_uuid()` nativo).

O schema é versionado com **`node-pg-migrate`**, em migrations de **SQL puro** dentro de `apps/api/migrations/` (`-- Up Migration` / `-- Down Migration`, controle na tabela `pgmigrations`). Dados de exemplo ficam em `src/db/seed.sql`.

🚨 **Este projeto usa soft delete: nada é apagado do banco.** Todo `DELETE` da API é um `update ... set deleted_at = now()`, e **toda** consulta filtra `deleted_at is null`. As regras completas (cascata transacional, índices parciais, como criar migration e como fazer baseline de banco existente) estão em `.claude/rules/database.md` — **leia antes de escrever qualquer SQL**.

### Monorepo

Turborepo (`turbo.json`) + pnpm workspaces (`pnpm-workspace.yaml`: `apps/*` + `packages/*`). `packages/` existe mas está vazio (reservado para libs compartilhadas). As tasks `dev`/`start` são `persistent` e sem cache; `build` depende de `^build` (builds das dependências primeiro).

## Convenções

- Código de domínio/identificadores em inglês; textos e mensagens voltadas ao usuário em pt-BR.
- Mantenha as dependências mínimas — o dono do projeto prefere só o que foi pedido explicitamente.

## Regras

Regras detalhadas ficam em `.claude/rules/` e são carregadas automaticamente pelos imports abaixo. Ao trabalhar na API, **siga as regras do Fastify**; ao escrever SQL, **siga as regras de banco** (soft delete é obrigatório) e as de **segurança** (todo valor do cliente vai como `$1`); ao commitar, **siga o padrão de commits**.

@.claude/rules/fastify.md
@.claude/rules/database.md
@.claude/rules/security.md
@.claude/rules/commits.md
