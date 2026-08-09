# MenuClick

Plataforma de **cardápio digital, QR code e delivery para restaurantes** (estilo Goomer).

Monorepo gerenciado com [Turborepo](https://turborepo.dev) + [pnpm](https://pnpm.io).

> 📚 **Projeto de estudo** — desenvolvido para fins de aprendizado (monorepo com Turborepo, Fastify e TypeScript rodando nativamente no Node), sem objetivo comercial.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **API:** [Fastify](https://fastify.dev) + TypeScript (rodando nativamente no Node 24, sem `tsx`/`ts-node`)

## Estrutura

```
MenuClick/
├─ apps/
│  └─ api/            # API HTTP (Fastify + TypeScript)
│     └─ src/
│        ├─ server.ts        # criação do app + listen
│        └─ routes/health.ts # GET /health
├─ packages/          # libs compartilhadas (em breve)
├─ turbo.json         # tasks do Turborepo
└─ pnpm-workspace.yaml
```

## Requisitos

- **Node.js >= 23.6** (usamos o suporte nativo a TypeScript do Node; recomendado Node 24 LTS)
- **pnpm** (habilitado via `corepack enable`)

## Como rodar

```bash
# instala as dependências de todo o monorepo
pnpm install

# sobe a API em modo dev (com --watch / hot reload)
pnpm dev
```

A API sobe em `http://localhost:3333`.

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

## Próximos passos

- [ ] `packages/` compartilhados (tipos, config)
- [ ] Domínio: restaurantes, cardápio (categorias/produtos), pedidos
- [ ] App do cliente (cardápio via QR code) e painel admin
# menu-click
# menu-click
