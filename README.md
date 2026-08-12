# MenuClick

Plataforma de **cardápio digital, QR code e delivery para restaurantes** (estilo Goomer).

Monorepo gerenciado com [Turborepo](https://turborepo.dev) + [pnpm](https://pnpm.io).

> 📚 **Projeto de estudo** — desenvolvido para fins de aprendizado (monorepo com Turborepo, Fastify e TypeScript rodando nativamente no Node), sem objetivo comercial.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **API:** [Fastify](https://fastify.dev) + TypeScript (rodando nativamente no Node 24, sem `tsx`/`ts-node`)
- **Banco:** PostgreSQL com o driver [`pg`](https://node-postgres.com) (SQL na mão, sem ORM)

## Estrutura

```
MenuClick/
├─ apps/
│  └─ api/            # API HTTP (Fastify + TypeScript)
│     ├─ .env.example        # variáveis de ambiente (copie para .env)
│     └─ src/
│        ├─ server.ts        # criação do app + listen
│        ├─ db/
│        │  ├─ pool.ts       # pool de conexões do Postgres
│        │  ├─ schema.sql    # DDL das tabelas (restaurants, products)
│        │  └─ setup.ts      # aplica e confere o schema.sql (pnpm db:setup)
│        └─ routes/
│           ├─ health.ts     # GET /health
│           └─ restaurants.ts # CRUD de restaurantes e produtos
├─ packages/          # libs compartilhadas (em breve)
├─ turbo.json         # tasks do Turborepo
└─ pnpm-workspace.yaml
```

## Requisitos

- **Node.js >= 23.6** (usamos o suporte nativo a TypeScript do Node; recomendado Node 24 LTS)
- **pnpm** (habilitado via `corepack enable`)
- **PostgreSQL >= 13** rodando localmente (ou em Docker)

## Como rodar

```bash
# instala as dependências de todo o monorepo
pnpm install

# configura o acesso ao banco (ajuste host/usuário/senha se precisar)
cp apps/api/.env.example apps/api/.env

# cria as tabelas
pnpm --filter @menuclick/api db:setup

# sobe a API em modo dev (com --watch / hot reload)
pnpm dev
```

A API sobe em `http://localhost:3333`.

Se não tiver um Postgres à mão, sobe um em um comando:

```bash
docker run -d --name menuclick-db \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=menuclick \
  -p 5432:5432 postgres:16
```

### Variáveis de ambiente

Ficam em `apps/api/.env` e são carregadas pelo próprio Node (`--env-file-if-exists`), sem dotenv.

| Variável                    | Default     | O que é                                              |
| --------------------------- | ----------- | ---------------------------------------------------- |
| `DATABASE_URL`              | —           | URL completa do Postgres; tem prioridade sobre `DB_*` |
| `DB_HOST` / `DB_PORT`       | `localhost` / `5432` | Host e porta do banco                       |
| `DB_USER` / `DB_PASSWORD`   | `postgres` / `postgres` | Credenciais                              |
| `DB_NAME`                   | `menuclick` | Nome do banco                                        |
| `DB_POOL_MAX`               | `10`        | Máximo de conexões no pool                           |
| `PORT` / `HOST`             | `3333` / `0.0.0.0` | Onde a API escuta                             |

### Testar o health check

```bash
curl http://localhost:3333/health
```

Resposta esperada:

```json
{
  "status": "ok",
  "service": "menuclick-api",
  "uptime": 1.23,
  "timestamp": "2026-08-09T12:00:00.000Z"
}
```

## Scripts (raiz)

| Comando       | O que faz                                        |
| ------------- | ------------------------------------------------ |
| `pnpm dev`    | Roda a task `dev` de todos os apps via Turborepo |
| `pnpm build`  | Type-check de todos os pacotes (`tsc --noEmit`)  |
| `pnpm start`  | Sobe os apps em modo produção                    |

Específico da API: `pnpm --filter @menuclick/api db:setup` aplica `src/db/schema.sql` no banco e confere se as tabelas estão com as colunas esperadas (pode rodar quantas vezes quiser).

## Soft delete

**Nada é apagado do banco.** Toda tabela tem uma coluna `deleted_at timestamptz`: `NULL` = registro vivo, preenchido = removido. O `DELETE` da API responde `204` normalmente, mas por baixo faz `update ... set deleted_at = now()` — o registro some da API (vira 404 em tudo) e continua no banco.

Apagar um restaurante marca os produtos dele junto, na mesma transação. Restaurar é `update ... set deleted_at = null` no SQL (não há rota para isso).

As regras completas para escrever SQL novo — filtro obrigatório, índices parciais, unicidade parcial, como migrar o schema — estão em [`.claude/rules/database.md`](.claude/rules/database.md).

## Próximos passos

- [ ] `packages/` compartilhados (tipos, config)
- [ ] Domínio: categorias de cardápio e pedidos
- [ ] App do cliente (cardápio via QR code) e painel admin
# menu-click
# menu-click
