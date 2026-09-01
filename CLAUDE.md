# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

MenuClick — plataforma de cardápio digital, QR code e delivery para restaurantes (estilo Goomer). Monorepo Turborepo + pnpm. Está em fase inicial: hoje existe só a API (autenticação por sessão, cardápio público por slug agrupado em seções, CRUD de restaurantes, de categorias e de produtos no Postgres, busca no cardápio, controle de estoque e o fluxo de pedidos em três modalidades — salão, retirada e entrega — cada uma com sua trilha de status — e acompanhamento em tempo real por WebSocket). O produto é construído **incrementalmente, começando simples** — não adicione dependências, camadas ou apps que não foram pedidos.

## Comandos

Rodar da raiz (Turborepo orquestra os workspaces). pnpm é gerenciado por corepack (versão fixada em `packageManager`).

```bash
pnpm install                       # instala tudo no monorepo
pnpm dev                           # sobe todos os apps em watch (API em http://localhost:3333)
pnpm build                         # type-check de todos os pacotes (tsc --noEmit)
pnpm start                         # sobe os apps em modo produção
pnpm lint                          # eslint em todo o monorepo

pnpm --filter @menuclick/api dev   # roda um script só num pacote
curl http://localhost:3333/health  # smoke test da API

pnpm --filter @menuclick/api migrate:up       # aplica as migrations pendentes
pnpm --filter @menuclick/api migrate:down     # desfaz a última migration
pnpm --filter @menuclick/api migrate:create X # cria uma migration SQL nova
pnpm --filter @menuclick/api db:seed          # popula dados de exemplo (idempotente)
pnpm --filter @menuclick/api openapi:generate # regera o openapi.json versionado
pnpm --filter @menuclick/api test             # suíte de integração (precisa do Postgres de pé)
```

A API respeita `PORT` (default 3333) e `HOST` (default 0.0.0.0), e conecta no Postgres via `DATABASE_URL` **ou** `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` (+ `DB_POOL_MAX`). Os scripts do pacote carregam `apps/api/.env` com `node --env-file-if-exists=.env` — **não use dotenv**. Copie `apps/api/.env.example` para começar.

Testes rodam no **Vitest** e o lint no **ESLint** (config mínima na raiz, `eslint.config.js`). O CI (`.github/workflows/ci.yml`) roda os três — lint, type-check e testes — contra um Postgres de serviço.

```bash
pnpm lint                                     # eslint em todo o monorepo
pnpm --filter @menuclick/api test             # suíte de integração (vitest run)
pnpm --filter @menuclick/api exec vitest run test/products.stock.test.ts   # um arquivo só
```

**Cada teste sai de um IP próprio.** O `buildTestApp()` de `test/helpers.ts` embrulha o `inject` para isso: 143 testes vindo de 127.0.0.1 contariam como um cliente só e estourariam o rate limit. O efeito colateral é bom — a suíte roda contra os valores **reais** de `limits.ts`, não contra limites afrouxados para os testes passarem. Quem quer exercitar o limite (`rate-limit.test.ts`) repete o IP de propósito.

Os testes são de **integração de verdade**: sobem o app com `buildApp()` + `app.inject()` (F21) e batem num banco Postgres real, `capstone_test`, criado e migrado sozinho pelo `globalSetup` (`test/global-setup.ts`). O `setup.ts` dá `truncate` nas tabelas depois de cada teste, e `fileParallelism: false` evita que um arquivo apague dado de outro. Não há mock de banco — se o Postgres não estiver de pé, a suíte não roda.

Fora Vitest e ESLint, a regra de dependência mínima continua valendo: confirme antes de trazer lib nova.

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

O domínio (restaurantes, usuários, categorias, produtos, clientes e pedidos) é dividido em três camadas, e cada uma só conhece a de baixo:

- **`src/routes/` (controller)** — só HTTP: JSON Schema de entrada/saída, ler `params`/`body`, chamar o serviço e escolher o status code do caminho feliz. **Nunca escreve SQL nem importa `pool`/repositório.**
- **`src/services/`** — a regra de negócio: "produto só existe dentro de restaurante vivo", o congelamento de preço no pedido, a transação da confirmação, a cascata do soft delete. Não conhece Fastify (nada de `request`/`reply`) e não escreve SQL. Quando a operação não pode acontecer, **lança erro tipado** de `src/errors.ts` (`NotFoundError`, `ConflictError`).
- **`src/repositories/`** — só acesso a dados: as queries parametrizadas, os tipos de linha (`snake_case`) e o mapper para o formato camelCase. Sem regra de negócio: "não achei" volta como `null`/`false`. Cada função recebe um `Queryable` opcional no fim (pool por padrão, ou o `client` quando o serviço abriu uma transação).

`src/domain/` guarda só os **tipos** compartilhados pelas três camadas (mais o `isUuid` e a lista `ORDER_STATUSES`, os dois únicos valores em runtime).

Nem todo domínio ganha serviço: **não existe `services/customers.ts`**, porque resolver o cliente é uma chamada ao repositório sem regra própria — uma camada de repasse não ganharia nada.

Os validadores de entrada das rotas (o estrito para o corpo, o coercitivo para a URL) ficam em `routes/validators.ts` e entram no plugin com `installRouteValidators(app)` — chamado **dentro** do plugin, não no `buildApp()`, para o encapsulamento do Fastify continuar isolando-os das rotas irmãs (F2).

### Listagens paginadas

Todas as listagens (`GET /restaurants`, `.../products`, `.../categories`, `.../orders` e o cardápio público) respondem um **envelope**, nunca um array cru:

```json
{ "data": [ ... ], "limit": 20, "offset": 0, "total": 137 }
```

`limit` (1–100, default 20) e `offset` (>= 0, default 0) vêm da querystring e são preenchidos pelo `useDefaults` do Ajv — o handler sempre recebe os dois resolvidos. Fora da faixa é **400**, não um ajuste silencioso. O schema e o helper do envelope são compartilhados em `routes/schemas.ts` (`paginationQuerystringSchema`, `pageResponseSchema`); os tipos (`Pagination`, `Page<T>`) estão em `domain/pagination.ts`.

O repositório devolve `{ rows, total }` e é o **serviço** que monta o `Page<T>` — o repositório não conhece o formato da resposta. `total` conta só registros vivos e sai de uma segunda query: `count(*) over ()` traria tudo numa ida só, mas devolve zero linhas quando a página está vazia, e aí um `offset` além do fim reportaria `total: 0`.

### 🔒 Duas superfícies: a pública e a do restaurante

A API atende **duas audiências**, e a diferença entre elas é a coisa mais importante a respeitar em código novo:

| Quem | O que pode | Como |
| --- | --- | --- |
| Cliente do QR code | ler o cardápio, criar pedido | sem conta, sem token |
| Restaurante | todo o resto | `Authorization: Bearer <token>` |

**A lista está invertida de propósito: um hook `onRequest` na raiz (`routes/authenticate.ts`) exige sessão em tudo, e a rota pública se declara com `config: { public: true }`.** Rota nova nasce fechada. Com opt-in rota a rota, esquecer uma linha exporia a rota em silêncio; com opt-out, o mesmo esquecimento a fecha e o sintoma aparece no primeiro teste — os dois erros não custam a mesma coisa.

Público hoje, e nada além disso: `GET /health`, `GET /menu/:slug`, `GET /menu/:slug/products`, `POST /auth/register`, `POST /auth/login` e `POST /restaurants/:restaurantId/orders`.

**Autorização também mora no hook.** Ele compara o `:restaurantId` da URL com o da sessão e responde **404** na divergência — 403 confirmaria que aquele restaurante existe. Por isso **toda rota escopada em restaurante precisa chamar o parâmetro de `restaurantId`**: uma rota que o chamasse de `id` ficaria autenticada mas **não** escopada, e uma sessão passaria por cima de outro restaurante. É o tipo de erro que não aparece em teste de caminho feliz.

`test/authorization.test.ts` testa a garantia, não as rotas de hoje: lê a árvore de rotas do próprio Fastify e exige 401 de tudo que não esteja na lista de públicas escrita à mão. Rota nova só passa exigindo sessão ou entrando conscientemente nessa lista.

### Autenticação

- **Sessão opaca no banco**, não JWT (`sessions`). Custa uma consulta por requisição autenticada; em troca, revogar é apagar uma linha em vez de manter lista negra — que seria justamente o estado no banco que o JWT queria evitar.
- **O banco guarda o hash do token**, nunca o token. SHA-256 puro é o certo *aqui e só aqui*: o token são 256 bits sorteados, sem dicionário a que seja vulnerável. **Senha continua em bcrypt** — segredo escolhido por gente exige KDF caro.
- **O bcrypt ignora tudo depois do byte 72, em silêncio.** Verificado: duas senhas que só diferem do byte 73 em diante conferem como iguais, e 40 letras "ç" já são 80 bytes. Como `maxLength` do JSON Schema conta caracteres, a checagem é `Buffer.byteLength` no serviço, e falha com `ValidationError` (400).
- **Login errado responde sempre a mesma coisa, e leva sempre o mesmo tempo**: o bcrypt roda contra um hash descartável quando o e-mail não existe, senão o tempo de resposta viraria um oráculo de quais e-mails estão cadastrados.
- `BCRYPT_ROUNDS` existe só para a suíte baixar o custo para 4; o padrão é 12 e o valor é preso entre 4 e 15.

### Cardápio público e o slug

`slug` é o identificador público do restaurante — o que vai dentro do QR code, porque um UUID não é endereço que alguém digita ou imprime. É gerado do nome (com `String.normalize("NFD")` tirando o acento, sem dependência), pode vir explícito no cadastro, e **não é editável por PATCH**: mudar a URL pública quebra QR code já impresso.

Colisão tem duas políticas: slug **explícito** que colide é **409** (o cliente pediu aquele endereço exato), slug **derivado do nome** ganha sufixo aleatório e tenta de novo. A detecção é pelo índice único parcial, nunca por um `select` antes — entre checar e inserir cabe outra requisição.

⚠️ **Retry de insert dentro de transação precisa de savepoint.** No Postgres, um comando que falha aborta o bloco inteiro, e a query seguinte estoura `current transaction is aborted`. Foi um 500 real no cadastro (que cria restaurante e usuário na mesma transação) até cada tentativa ganhar o seu savepoint. Fora de transação o problema não existe, porque cada query já é a própria transação — ver `isTransactionClient()` em `db/pool.ts`.

As rotas de `/menu` têm `schema.response` próprio, mais enxuto que o das rotas de gestão. **`stock` não sai por ali** — quantas unidades o restaurante tem é informação dele; o cliente recebe `available: boolean`. É a diferença entre a superfície aberta e a fechada, e é o que impede uma coluna nova de vazar sozinha (S10).

### Categorias e o cardápio agrupado

A seção do cardápio ("Entradas", "Pratos", "Bebidas") é uma **entidade**, `categories`, com CRUD em `/restaurants/:restaurantId/categories`. Até a migration `link-products-to-categories` ela era o texto livre `products.category`, e o texto não resolvia três coisas: renomear uma seção era editar produto por produto, "Bebidas" e "bebidas" conviviam no mesmo cardápio, e não havia onde guardar a **ordem** das seções.

- **O nome é único por restaurante, e o índice é sobre `lower(name)`.** É a razão de a entidade existir; sem o `lower` ela não resolveria o problema que motivou a mudança. Nome repetido é **409**, nunca sufixo automático — é o oposto da política do `slug`, e de propósito: lá o nome derivado é palpite do servidor, aqui foi digitado por quem edita o cardápio.
- **A ordem é a `position` que o restaurante define, não a alfabética.** Cardápio segue a sequência da refeição; por nome, "Bebidas" abriria todos eles. Sem `position` na criação, a categoria vai para o fim (o cálculo acontece dentro do próprio `insert`). Empate é desfeito pelo nome, então duas criações simultâneas nascendo na mesma posição não quebram a ordem.
- **`products.category_id` é nulável, e produto sem seção é estado legítimo.** Ele aparece no cardápio, no grupo final "Sem categoria".

⚠️ **Apagar uma seção não apaga a comida.** A remoção marca a categoria e põe `category_id = null` nos produtos dela, na mesma transação (D3). A alternativa — recusar com 409 enquanto houver produto — obrigaria a recategorizar o cardápio inteiro à mão só para corrigir um nome digitado errado.

⚠️ **`categoryId` no produto é conferido contra o restaurante da rota** (`categoriesService.ensureExists`), e categoria de outro dono responde 404 (S19). Sem essa checagem o produto apareceria agrupado no cardápio de quem não o criou. No PATCH, `categoryId: null` tira o produto da seção — é o que diferencia "tira daquela seção" de "não mexe na categoria" (por isso o schema usa `nullable: true`, não `anyOf`, F12).

**O cardápio público vem agrupado, e quem pagina são as CATEGORIAS.** `GET /menu/:slug/products` responde `{ data: [{ id, name, products: [...] }], limit, offset, total }`. Paginar produtos partiria um grupo entre duas páginas, e aí o envelope deixaria de descrever o que devolveu. Consequências que valem para código novo:

- `total` conta **categorias**, não produtos.
- O grupo "Sem categoria" **não tem `id`**, não conta no `total`, e sai só na **última página** — em todas, ele se repetiria a cada rolagem.
- Os produtos de uma seção vêm **todos**, sem teto. É deliberado: a paginação existe para impedir que um *cliente* peça uma resposta sem fim, e o cliente não escolhe quantos produtos cabem numa seção — quem escolhe é o restaurante. Cortar em N esconderia prato do cardápio. O eixo continua sem limite, e é o único: medido no banco de dev (12.574 produtos numa seção), a resposta dá **1,9 MB**. Se isso virar problema, a saída é limitar o catálogo, não truncar a resposta.
- A listagem de **gestão** (`/restaurants/:restaurantId/products`) continua plana e paginada por produto: ela é a grade de edição, não a tela do cliente.

**A busca é `?search=` na listagem de gestão, e ela é o primeiro uso do S5.** `%` e `_` vindos do cliente são escapados antes de virar o padrão do `ilike` — não é injection (o termo continua indo como `$n`), mas sem escapar, procurar por "%" varre o cardápio inteiro em vez de achar o texto digitado. A busca **não** existe no cardápio público, e não por esquecimento: como ele vem inteiro numa resposta só, filtrar no servidor não economizaria nada que o cliente não faça localmente.

### Pedidos

O fluxo é `POST /restaurants/:restaurantId/orders` (nasce `pending`) → `.../orders/:orderId/confirm` **ou** `.../cancel`. Não há `DELETE`: pedido não se apaga, se cancela. `confirmed` é terminal — desfazer uma confirmação exigiria devolver estoque, e essa decisão de negócio ainda não foi tomada.

Três invariantes valem para todo código novo de pedido:

- **O pedido congela o que combinou.** `order_items` guarda **cópias** de `name` e `price_in_cents` do produto, e o endereço de entrega é cópia em colunas planas (nulas no pedido de mesa, tudo-ou-nada garantido por `check`). Reajustar o cardápio não muda pedido antigo, e nenhuma leitura de pedido junta `products`.
- **O total é calculado no servidor.** `totalInCents` nem existe no schema do corpo: aceitá-lo seria deixar quem paga escolher o preço.
- **Pedido não é catálogo, é histórico.** Remover cliente ou restaurante **não** cascateia para `orders` (a cascata do projeto vale para restaurante → produtos). Por isso o join com `customers` na leitura de pedido é o único do projeto que **não** filtra `deleted_at is null` — filtrar apagaria o passado junto com o cadastro.

Cliente é contato, não conta: sem login, o telefone é a identidade (índice único **parcial**), e o serviço resolve por `insert ... on conflict (phone) where deleted_at is null do update`, o que fecha a janela em que dois pedidos simultâneos do mesmo telefone criariam dois clientes.

Duas linhas do mesmo produto no corpo viram **uma** com a quantidade somada — é o que um carrinho faz, e apaga o caso em que a confirmação teria que travar e debitar o mesmo produto duas vezes na mesma transação.

### Modalidade do pedido

Todo pedido tem `type`: **`dine_in`** (QR na mesa), **`takeaway`** (retirada) ou **`delivery`**. Ela decide três coisas: por quais estados o pedido passa, se exige endereço, e — no futuro — se o cliente recebe token de acompanhamento.

⚠️ **A modalidade não se infere.** Até a migration `add-order-type-and-status` ela era deduzida do endereço (com `street` = entrega, sem = mesa). Retirada quebrou isso: também não tem endereço e não é mesa. Se você se pegar escrevendo `if (deliveryAddress)` para decidir qualquer coisa, é o campo `type` que você quer.

O endereço acompanha: **obrigatório em `delivery`, recusado nas outras duas** — no serviço (400, com mensagem) e no `check` do banco (a rede de segurança). O restaurante declara o que aceita em `isDelivery`/`isTakeaway`/`isQrcode`, e pedido de modalidade recusada é **409**.

### Máquina de status

```
delivery   pending → confirmed → preparing → out_for_delivery → completed
takeaway   pending → confirmed → preparing → ready_for_pickup → completed
dine_in    pending → confirmed → preparing →                    completed
                          cancelled, de qualquer estado não terminal
```

**As transições legais vivem num mapa só**, `TRANSITIONS` em `domain/order.ts`, e **toda** mudança de estado passa pelo `transitionTo()` de `services/orders.ts` — um lugar para travar o pedido, aplicar o mapa e decidir o efeito colateral. Rota nova de transição chama `transitionTo`, nunca grava status direto.

`completed` e não `delivered`: é o fim das três trilhas, e "entregue" obrigaria o painel a dizer isso de um prato servido na mesa. O banco guarda um estado; a palavra na tela vem da modalidade.

Transição ilegal é 409 com **duas mensagens diferentes**, de propósito: quando o estado não existe naquela trilha a mensagem culpa a modalidade, e não o estado atual. Dizer "não pode ir de `preparing` para `out_for_delivery`" num pedido de retirada esconderia a causa real.

### Estoque e a confirmação

`products.stock` é `not null default 0`. É **legível** em toda resposta de produto, **definível** no POST (estoque inicial) e **editável** no PATCH (reposição). Quem dá baixa é **só** a confirmação de pedido — um caminho único, para a disciplina de lock existir num lugar só.

A transação de `confirm` trava duas coisas, nessa ordem:

1. **o pedido** (`select status ... for update`), o que serializa confirmações simultâneas do mesmo pedido. Sem isso todas leem `pending` e todas debitam — o `update` de status sozinho não protege, porque cada transação já decidiu confirmar antes de escrever;
2. **os produtos** (`select ... order by id for update`), o que serializa pedidos diferentes disputando o mesmo item. O `order by id` fixa a ordem de travamento para não depender do plano de execução.

Todos os itens são conferidos **antes** de qualquer débito: o rollback resolveria de qualquer jeito, mas conferir antes deixa a regra explícita.

Consequência assumida de debitar só na confirmação: **pedido `pending` não é reserva.** Dois pedidos podem existir para a última unidade; o primeiro a confirmar leva, o segundo recebe 409.

**Cancelar devolve estoque — até a comida ficar pronta.** O corte é "o prato já existe": em `confirmed` e `preparing` as unidades voltam; em `out_for_delivery` e `ready_for_pickup`, não. A regra mora em `cancellingReturnsStock()` no domínio, e a devolução usa o mesmo `select ... for update` ordenado por id do débito — sem o lock na leitura do pedido, cancelamentos simultâneos devolvem as unidades várias vezes (verificado).

Não há `check (stock >= 0)` no banco **de propósito** (ver a migration `add-stock-to-products`): a constraint transformaria a race condition num erro do Postgres e esconderia o sintoma que o teste precisa enxergar.

🚨 **Teste de concorrência precisa aquecer o pool antes da corrida** (`warmPool()` em `test/orders-confirm.test.ts`). Com o pool frio, cada requisição espera o handshake de uma conexão nova, e isso é lento o bastante para a primeira transação inteira terminar antes de a segunda começar: o teste passa mesmo com o lock removido. Ao escrever um teste de corrida, **remova o lock e confirme que ele falha** — senão ele não está testando nada.

**Erro de negócio nunca vira status code na rota.** O serviço lança `NotFoundError`/`ConflictError` e o `setErrorHandler()` do `app.ts` traduz para **404**/**409**, com o corpo `{ statusCode, error, message }`. Nenhuma rota monta corpo de erro na mão.

### Documentação: OpenAPI derivado das rotas

O `openapi.json` é **gerado**, nunca editado à mão: sai dos mesmos `schema` que validam a requisição e serializam a resposta. Consequência prática — campo esquecido no `schema.response` some da documentação **e** da resposta ao mesmo tempo, então documentação errada é sintoma de contrato errado.

**Ao adicionar rota, declare `tags`, `summary`, `description` e `operationId` no `schema`.** Não é opcional: `test/openapi.test.ts` falha se faltar qualquer um. E depois rode `pnpm --filter @menuclick/api openapi:generate` — o arquivo é versionado, e outro teste compara o commitado com o gerado.

A marcação de "exige sessão" no documento **não se escreve**: um `transform` em `src/openapi.ts` a deriva do mesmo `config.public` que o hook de autenticação usa. Fonte única, senão a documentação mentiria sobre segurança no primeiro descuido.

O `/docs` (Swagger UI) só sobe quando `NODE_ENV` **não** é `production` — é um mapa completo da superfície da API. As rotas dele são criadas pelo plugin, então são marcadas como públicas em bloco por um `onRoute` num escopo próprio.

⚠️ **O `setErrorHandler()` é registrado antes de qualquer plugin, e precisa continuar assim.** Contexto encapsulado herda o error handler que existia quando ele foi criado; plugin registrado antes ficaria com o handler padrão do Fastify, que responde 500 com a mensagem interna no corpo (S11). Aconteceu com o `/docs`: um 401 saía como `500 {"message":"Autenticação obrigatória"}`.

### Acompanhamento em tempo real (WebSocket)

`GET /orders/:orderId/track?token=…` faz upgrade para WebSocket e transmite as mudanças de status do pedido. É a **única** rota WebSocket da API e é só de leitura — nada que o cliente mande pelo socket é interpretado.

**Quem acompanha é quem recebeu token, e só `takeaway` e `delivery` recebem.** Pedido de salão não ganha credencial na criação, então não existe com o que conectar. Isso é decisão de desenho: "quem está no salão não acompanha" é consequência do modelo, não um `if` que alguém possa remover.

O `trackingToken` sai **uma vez**, na resposta do `POST` que criou o pedido — nunca na listagem nem no detalhe, que são rotas do restaurante e entregariam a credencial de todos os clientes ao painel. O schema da criação é separado justamente por isso (S10). O banco guarda o **hash**, como em `sessions`; os dois usam `src/tokens.ts`.

Três regras para mexer aqui:

- ⚠️ **Publicar só DEPOIS do commit.** `transitionAndPublish()` chama `orderEvents.publish()` fora do `withTransaction` — de dentro dele, um rollback deixaria o cliente vendo um estado que não aconteceu.
- ⚠️ **A primeira mensagem é sempre `snapshot`.** Sem ela, uma conexão que caia no meio do preparo e volte fica em branco esperando um evento que pode não vir tão cedo. Há teste que falha se o snapshot sair.
- ⚠️ **Cancelar a inscrição no `close`.** O `subscribe` devolve a função de cancelamento; sem chamá-la, o emissor segura a referência do socket morto para sempre.

O roteamento é **por id de pedido** (o nome do evento é o id), e não um evento global com filtro: fosse um só, a separação viraria um `if` dentro de cada listener — e um `if` esquecido ali vaza o pedido de um cliente para todos os conectados. Há teste para isso.

A autorização roda em **`preHandler`, não `preValidation`**. Rota WebSocket passa pelos hooks antes do upgrade, mas `preValidation` roda **antes** da validação do schema — lá o `token` ainda pode ser `undefined`, e o hash dele estoura 500 em vez de responder 400. Os exemplos do plugin usam `preValidation` porque leem um header, que não passa por schema; credencial em querystring, não.

⚠️ **O emissor é do processo.** Com duas instâncias, o cliente conectado na A não recebe o evento publicado na B, e a falha é silenciosa — a tela só não atualiza. Mesma limitação do contador de rate limit, mesma solução (pub/sub no Redis).

**Teste de WebSocket não usa `app.inject()`** — ele não faz upgrade. `test/orders-tracking.test.ts` sobe o servidor em porta efêmera (`listen({ port: 0 })`) e conecta com um cliente real; é a exceção documentada ao F21. E o cliente de teste enfileira as mensagens desde antes do `open`: o servidor manda o `snapshot` assim que a conexão abre, e um listener registrado depois do `open` chega tarde demais.

### Limites de exposição

Todos os números vivem em `src/limits.ts`, cada um com o porquê ao lado, e **nenhum é o default** (F27/S16): `bodyLimit` 128 KB, `keepAliveTimeout` 72s (tem que ser **maior** que o do proxy à frente, senão vira 502 intermitente), `connectionTimeout` 10s, e os tetos de rate limit.

**Rate limit:** 100 req/min por IP no geral, **5 req/min no `/auth/login`**. A chave é só o IP — por e-mail protegeria uma conta de ataque distribuído, mas viraria uma forma de trancar o dono para fora. O contador é em memória, **por processo**: com duas instâncias, o limite efetivo dobra.

⚠️ **`TRUST_PROXY` precisa estar certo, e os dois erros custam caro.** `false` atrás de um proxy faz `request.ip` ser o IP do proxy para todo mundo, e o teto vira compartilhado entre todos os clientes juntos. `true` com a app exposta direto deixa qualquer um forjar o `X-Forwarded-For` e escolher o próprio IP. Default `false`.

⚠️ **O rate limit roda DEPOIS da autenticação**, e isso não é escolha nossa: o plugin instala a checagem como hook de rota, e hook de rota roda depois dos hooks de instância. Instalar um hook de instância por fora não resolve — o plugin marca a requisição e roda no máximo uma vez, então o hook global engoliria o limite específico do login. Na prática custa pouco: no login (rota pública) a autenticação devolve na primeira linha e o limitador roda antes do bcrypt, e em rota protegida a recusa sem token não custa consulta ao banco.

**CORS:** `CORS_ORIGINS` separado por vírgula; **vazio = nenhuma origem cruzada**. Sem `credentials`, porque a API usa header e não cookie.

⚠️ **O CORS é registrado ANTES do `installAuth()`.** O preflight `OPTIONS` não carrega `Authorization` — é anônimo por definição —, então o hook de negação por padrão responderia 401 e o navegador reportaria "erro de CORS", apontando para o lugar errado. Inverter a ordem quebra dois testes.

### Banco: Postgres via `pg` (sem ORM)

`apps/api/src/db/pool.ts` exporta um **`Pool` singleton** do driver `pg` (e o helper `withTransaction()`), configurado só por env (ver acima). Não há ORM, query builder nem plugin Fastify no meio: os **repositórios** (`src/repositories/`) importam `pool` direto e escrevem SQL na mão — e são o único lugar do código com SQL. Restaurantes, usuários, sessões, categorias, produtos, clientes e pedidos vivem no Postgres — não há mais nada em memória.

O `server.ts` fecha o pool no hook `onClose` e trata `SIGINT`/`SIGTERM` (F26). Requer **Postgres >= 13** (`gen_random_uuid()` nativo).

O schema é versionado com **`node-pg-migrate`**, em migrations de **SQL puro** dentro de `apps/api/migrations/` (`-- Up Migration` / `-- Down Migration`, controle na tabela `pgmigrations`). Dados de exemplo ficam em `src/db/seed.sql`.

🚨 **Este projeto usa soft delete: nada é apagado do banco.** Todo `DELETE` da API é um `update ... set deleted_at = now()`, e **toda** consulta filtra `deleted_at is null`. As regras completas (cascata transacional, índices parciais, como criar migration e como fazer baseline de banco existente) estão em `.claude/rules/database.md` — **leia antes de escrever qualquer SQL**.

### Monorepo

Turborepo (`turbo.json`) + pnpm workspaces (`pnpm-workspace.yaml`: `apps/*` + `packages/*`). `packages/` existe mas está vazio (reservado para libs compartilhadas). As tasks `dev`/`start` são `persistent` e sem cache; `build` depende de `^build` (builds das dependências primeiro).

## Convenções

- Código de domínio/identificadores em inglês; textos e mensagens voltadas ao usuário em pt-BR.
- Mantenha as dependências mínimas — o dono do projeto prefere só o que foi pedido explicitamente.
- Dependência com script de install exige decisão explícita no `pnpm-workspace.yaml` (`allowBuilds`). O pnpm trata "não decidido" como **erro**, não aviso: sem isso, todo `pnpm build`/`test`/`dev` para de rodar e o `--frozen-lockfile` do CI falha. O `bcrypt` está como `false` (usa o binário pré-compilado), que é a posição mais segura.

## Regras

Regras detalhadas ficam em `.claude/rules/` e são carregadas automaticamente pelos imports abaixo. Ao trabalhar na API, **siga as regras do Fastify**; ao escrever SQL, **siga as regras de banco** (soft delete é obrigatório) e as de **segurança** (todo valor do cliente vai como `$1`); ao commitar, **siga o padrão de commits**.

@.claude/rules/fastify.md
@.claude/rules/database.md
@.claude/rules/security.md
@.claude/rules/commits.md
