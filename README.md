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
│     ├─ migrations/         # migrations em SQL puro (node-pg-migrate)
│     ├─ test/               # testes de integração (vitest + app.inject)
│     └─ src/
│        ├─ server.ts        # listen (chama o buildApp)
│        ├─ app.ts           # monta o app: plugins, rotas e error handler
│        ├─ errors.ts        # erros de negócio (NotFoundError, ConflictError)
│        ├─ db/
│        │  ├─ pool.ts       # pool de conexões do Postgres + withTransaction
│        │  ├─ migrate.ts    # runner das migrations (pnpm migrate:up/down)
│        │  ├─ seed.sql      # dados de exemplo
│        │  └─ seed.ts       # aplica o seed (pnpm db:seed)
│        ├─ domain/          # tipos do domínio (sem runtime): restaurant, product,
│        │                    # customer, order, pagination
│        ├─ repositories/    # só SQL: restaurants, restaurant-users, sessions,
│        │                    # products, customers, orders
│        ├─ services/        # só regra: auth, restaurants, menu, products, orders
│        └─ routes/          # só HTTP (schema, params, status code)
│           ├─ health.ts     # GET /health
│           ├─ schemas.ts    # schemas compartilhados (erro, paginação, endereço)
│           ├─ authenticate.ts      # hook que fecha tudo por padrão
│           ├─ auth.ts              # cadastro, login, logout, /me
│           ├─ menu.ts              # cardápio PÚBLICO por slug (o QR code)
│           ├─ restaurants.ts        # CRUD de restaurantes
│           ├─ products.ts           # CRUD de produtos do restaurante
│           └─ orders.ts             # pedidos: criar, listar, confirmar, cancelar
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
pnpm --filter @menuclick/api migrate:up

# (opcional) popula 2 restaurantes com dono, 9 produtos, 1 cliente e 2 pedidos
pnpm --filter @menuclick/api db:seed

# sobe a API em modo dev (com --watch / hot reload)
pnpm dev
```

A API sobe em `http://localhost:3333`.

Se não tiver um Postgres à mão, sobe um em um comando:

```bash
docker run -d --name capstone-db \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=capstone \
  -p 5432:5432 postgres:16
```

### Variáveis de ambiente

Ficam em `apps/api/.env` e são carregadas pelo próprio Node (`--env-file-if-exists`), sem dotenv.

| Variável                    | Default     | O que é                                              |
| --------------------------- | ----------- | ---------------------------------------------------- |
| `DATABASE_URL`              | —           | URL completa do Postgres; tem prioridade sobre `DB_*` |
| `DB_HOST` / `DB_PORT`       | `localhost` / `5432` | Host e porta do banco                       |
| `DB_USER` / `DB_PASSWORD`   | `postgres` / `postgres` | Credenciais                              |
| `DB_NAME`                   | `capstone`  | Nome do banco (o de teste é `capstone_test`)         |
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
| `pnpm lint`   | Roda o ESLint em todo o monorepo                 |

Específicos da API (rode com `pnpm --filter @menuclick/api <script>`):

| Script           | O que faz                                                       |
| ---------------- | --------------------------------------------------------------- |
| `migrate:up`     | Aplica as migrations pendentes                                   |
| `migrate:down`   | Desfaz a última migration                                        |
| `migrate:create` | Cria um arquivo de migration SQL novo (com timestamp e template) |
| `db:seed`        | Popula dados de exemplo — idempotente, não duplica               |
| `test`           | Suíte de integração no Vitest (precisa do Postgres de pé)        |

### Migrations

O schema é versionado com [node-pg-migrate](https://github.com/salsita/node-pg-migrate), em **SQL puro** (sem DSL, sem ORM). Cada arquivo em `apps/api/migrations/` tem as seções `-- Up Migration` e `-- Down Migration`; o que já rodou fica registrado na tabela `pgmigrations`.

Para mudar o schema, **nunca edite uma migration que já rodou** — crie uma nova:

```bash
pnpm --filter @menuclick/api migrate:create adiciona-categorias
```

> Se você já tem um banco com as tabelas criadas antes das migrations existirem, não rode `migrate:up` nele: faça o *baseline* inserindo o nome da migration inicial na tabela `pgmigrations` (ver `.claude/rules/database.md`, D19).

## Listagens paginadas

`GET /restaurants`, `GET /restaurants/:restaurantId/products` e `GET /restaurants/:restaurantId/orders` respondem um envelope, não um array:

```bash
curl "http://localhost:3333/restaurants?limit=2&offset=0"
```

```json
{
  "data": [ { "id": "...", "name": "Tokyo Ramen House" }, { "...": "..." } ],
  "limit": 2,
  "offset": 0,
  "total": 137
}
```

`limit` vai de 1 a 100 (default 20) e `offset` é >= 0 (default 0). Valor fora da faixa responde **400** em vez de ser ajustado em silêncio — um `limit=500` atendido como 100 mentiria sobre o que foi devolvido. `total` conta só os registros vivos (soft delete não entra).

## Duas superfícies

A API atende dois públicos, e a diferença é a coisa mais importante a entender antes de mexer nela:

| Quem | O que pode | Como |
| --- | --- | --- |
| Quem escaneia o QR code | ler o cardápio, fazer pedido | sem conta, sem token |
| O restaurante | todo o resto | `Authorization: Bearer <token>` |

**Toda rota exige sessão por padrão.** Ser pública é uma declaração explícita na rota, e a lista completa é curta: `GET /health`, `GET /menu/:slug`, `GET /menu/:slug/products`, `POST /auth/register`, `POST /auth/login` e `POST /restaurants/:restaurantId/orders`.

A lista está invertida de propósito: rota nova nasce fechada. Se o autor esquecer de pensar no assunto, o erro é um 401 que aparece no primeiro teste — não um vazamento silencioso.

Pedir um restaurante que não é o da sua sessão responde **404**, não 403: "proibido" confirmaria que ele existe.

## Autenticação

```bash
# cadastrar (cria o restaurante e o primeiro usuário, numa transação)
curl -X POST http://localhost:3333/auth/register \
  -H 'content-type: application/json' \
  -d '{
        "restaurant": { "name": "Tokyo Ramen House", "cuisineType": "Japonesa",
                        "address": { "street": "Av. Paulista", "number": "2300",
                                     "neighborhood": "Bela Vista", "city": "São Paulo",
                                     "state": "SP", "zipCode": "01310-300" },
                        "isDelivery": true, "isQrcode": true },
        "user": { "name": "Dono", "email": "dono@tokyoramen.com.br",
                  "password": "senha-de-exemplo-123" }
      }'

# entrar (o seed já deixa dono@tokyoramen.com.br / senha-de-exemplo-123 pronto)
TOKEN=$(curl -s -X POST http://localhost:3333/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"dono@tokyoramen.com.br","password":"senha-de-exemplo-123"}' \
  | jq -r .token)

curl -H "authorization: Bearer $TOKEN" http://localhost:3333/auth/me
curl -X POST -H "authorization: Bearer $TOKEN" http://localhost:3333/auth/logout
```

A sessão é opaca e mora no banco (não é JWT): custa uma consulta por requisição, e em troca revogar é apagar uma linha. O banco guarda o **hash** do token, nunca o token; a senha vai em bcrypt.

## Cardápio público (o QR code)

O QR code aponta para o `slug`, não para o UUID:

```bash
curl http://localhost:3333/menu/tokyo-ramen-house
curl "http://localhost:3333/menu/tokyo-ramen-house/products?limit=10"
```

O cardápio público **não devolve `stock`** — quantas unidades o restaurante tem é informação dele. O que sai é `available: true|false`.

O slug é gerado do nome (sem acento) ou enviado no cadastro, e **não muda por PATCH**: alterar a URL pública quebraria QR code já impresso.

## Pedidos

Um pedido nasce `pending`, e daí vai para `confirmed` ou `cancelled`. Não há `DELETE`: pedido não se apaga, se cancela.

```bash
# criar — PÚBLICO: quem escaneia o QR pede sem ter conta
# (endereço de entrega é opcional: sem ele, é pedido de mesa)
curl -X POST http://localhost:3333/restaurants/$RID/orders \
  -H 'content-type: application/json' \
  -d '{
        "customer": { "name": "Ana Souza", "phone": "11999990000" },
        "items": [ { "productId": "'$PID'", "quantity": 2 } ]
      }'

# listar — do RESTAURANTE (a lista traz nome e telefone dos clientes)
curl -H "authorization: Bearer $TOKEN" \
  "http://localhost:3333/restaurants/$RID/orders?status=pending&limit=10"

# confirmar — é aqui que o estoque é debitado (409 se faltar)
curl -X POST -H "authorization: Bearer $TOKEN" \
  http://localhost:3333/restaurants/$RID/orders/$OID/confirm

# cancelar (só pedido pendente)
curl -X POST -H "authorization: Bearer $TOKEN" \
  http://localhost:3333/restaurants/$RID/orders/$OID/cancel
```

O que o pedido garante:

- **Preço congelado.** Cada item guarda uma cópia de `name` e `priceInCents` do produto no momento do pedido. Reajustar o cardápio depois não muda o valor de um pedido já feito — e o endereço de entrega é cópia pelo mesmo motivo.
- **Total calculado no servidor.** `totalInCents` não existe no corpo da requisição; mandar não adianta.
- **Cliente identificado pelo telefone.** Não há login: o mesmo telefone reaproveita o cliente (e atualiza o nome).
- **Pedido é histórico, não catálogo.** Remover um cliente ou um restaurante não apaga os pedidos deles.

## Estoque

Todo produto tem `stock` (inteiro, default 0). Ele é devolvido em toda resposta de produto, aceito no `POST` (estoque inicial) e no `PATCH` (reposição):

```bash
# cria já com estoque
curl -X POST http://localhost:3333/restaurants/$RID/products \
  -H 'content-type: application/json' \
  -d '{"name":"Ramen Shoyu","category":"Pratos principais","priceInCents":4890,"stock":20}'

# repõe
curl -X PATCH http://localhost:3333/restaurants/$RID/products/$PID \
  -H 'content-type: application/json' -d '{"stock":50}'
```

**A única coisa que tira unidade do estoque é a confirmação de pedido.** Ela roda numa transação que trava primeiro o pedido (para duas confirmações do mesmo pedido não debitarem duas vezes) e depois os produtos, em ordem fixa de id (para pedidos diferentes que disputam o mesmo item se serializarem). Todos os itens são conferidos antes de qualquer débito.

O efeito colateral aceito: **pedido pendente não é reserva.** Dois pedidos podem existir para a última unidade — o primeiro a confirmar leva, o segundo recebe 409. `test/orders-confirm.test.ts` cobre os dois casos.

## Limites de exposição

Nenhum destes números é o default do Fastify — todos estão em `apps/api/src/limits.ts`, com o porquê ao lado:

| | Valor | Por quê |
| --- | --- | --- |
| `bodyLimit` | 128 KB | o maior corpo real (cadastro, pedido grande) não passa de dezenas de KB |
| `keepAliveTimeout` | 72s | tem que ser **maior** que o do proxy à frente, senão dá 502 intermitente |
| `connectionTimeout` | 10s | conexão que abre e não fala nada não fica presa de graça |
| Rate limit geral | 100/min por IP | cobre cardápio público e criação de pedido |
| Rate limit do login | **5/min por IP** | rota anônima e cara: bcrypt custa centenas de ms de propósito |

O contador do rate limit é em memória, **por processo**: com duas instâncias, o limite efetivo dobra. Trocar por Redis é decisão de infra.

### Duas variáveis que precisam de atenção no deploy

**`TRUST_PROXY`** decide se a app confia no `X-Forwarded-For`. Ligue **apenas** se houver mesmo um proxy à frente:

- `false` atrás de um proxy → todo cliente aparece com o IP do proxy, e o limite por IP vira um teto compartilhado por todo mundo.
- `true` com a app exposta direto → qualquer um forja o header e escolhe o próprio IP.

**`CORS_ORIGINS`** é a lista de origens que podem chamar a API de dentro de um navegador, separada por vírgula. **Vazio = ninguém.** Deixe assim até o front existir: falhar fechado quebra o front de forma visível, enquanto liberar demais não dá sintoma nenhum.

## Soft delete

**Nada é apagado do banco.** Toda tabela tem uma coluna `deleted_at timestamptz`: `NULL` = registro vivo, preenchido = removido. O `DELETE` da API responde `204` normalmente, mas por baixo faz `update ... set deleted_at = now()` — o registro some da API (vira 404 em tudo) e continua no banco.

Apagar um restaurante marca os produtos dele junto, na mesma transação. Restaurar é `update ... set deleted_at = null` no SQL (não há rota para isso).

As regras completas para escrever SQL novo — filtro obrigatório, índices parciais, unicidade parcial, como migrar o schema — estão em [`.claude/rules/database.md`](.claude/rules/database.md).

## Próximos passos

- [ ] Recuperação de senha e papéis dentro do restaurante (dono vs. garçom)
- [ ] Cancelar pedido já confirmado, devolvendo estoque (hoje `confirmed` é terminal)
- [ ] Domínio: categorias de cardápio (hoje `category` é texto livre no produto)
- [ ] Histórico do cliente (`GET /customers/:id/orders`) e CRUD próprio de clientes
- [ ] `packages/` compartilhados (tipos, config) — quando o front existir
- [ ] App do cliente (cardápio via QR code) e painel admin — a API já está pronta para os dois
- [ ] Contador de rate limit compartilhado (Redis), quando houver mais de uma instância
# menu-click
# menu-click
