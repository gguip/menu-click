# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

MenuClick — plataforma de cardápio digital, QR code e delivery para restaurantes (estilo Goomer). Monorepo Turborepo + pnpm. Está em fase inicial: existem a API e o painel da loja (`apps/panel` — acesso, pedidos, cardápio com grupos de opções, e a configuração de modalidades, entrega, horário e dados da loja). A API tem (autenticação por sessão com papéis, troca de senha e verificação do e-mail do restaurante, cardápio público por slug agrupado em seções, CRUD de restaurantes, de categorias, de produtos e de grupos de opções no Postgres, busca no cardápio, resumo e filtros de período para o painel, controle de estoque e o fluxo de pedidos — com opções escolhidas — em três modalidades — salão, retirada e entrega — cada uma com sua trilha de status —, horário de funcionamento com pausa manual e forma de pagamento do pedido, taxa de entrega por bairro ou fixa com pedido mínimo, mesas do salão com QR code próprio, e acompanhamento em tempo real por WebSocket). O produto é construído **incrementalmente, começando simples** — não adicione dependências, camadas ou apps que não foram pedidos.

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

pnpm --filter @menuclick/panel dev            # painel em http://localhost:5173 (proxy /api → :3333)
pnpm --filter @menuclick/panel test           # testes do painel (jsdom, sem banco)
pnpm --filter @menuclick/panel build          # type-check + vite build
```

A API respeita `PORT` (default 3333) e `HOST` (default 0.0.0.0), e conecta no Postgres via `DATABASE_URL` **ou** `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` (+ `DB_POOL_MAX`). 🚨 **`MENU_BASE_URL` é obrigatória e não tem default — sem ela a API não sobe** (é a raiz da URL do cardápio, de onde sai o endereço dentro do QR code das mesas; ver a seção de mesas). Os scripts do pacote carregam `apps/api/.env` com `node --env-file-if-exists=.env` — **não use dotenv**. Copie `apps/api/.env.example` para começar.

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

Público hoje, e nada além disso:

| Rota | Como é protegida |
| --- | --- |
| `GET /health` | nada a proteger |
| `GET /menu/:slug` | o cardápio é o que o QR code abre |
| `GET /menu/:slug/products` | idem |
| `GET /menu/:slug/table/:hash` | traduz o QR da mesa para o rótulo; quem escaneou não tem conta |
| `POST /menu/:slug/delivery-quote` | cota o frete antes de existir carrinho |
| `POST /auth/register` | cria a primeira conta |
| `POST /auth/login` | teto próprio por IP (S25) |
| `POST /auth/forgot-password` | teto próprio por IP; responde igual para e-mail que existe e que não existe |
| `POST /auth/reset-password` | **pelo token de recuperação**, de uso único e uma hora de validade |
| `POST /auth/verify-email` | **pelo token de verificação**, de uso único e 24 horas de validade; teto próprio por IP |
| `POST /restaurants/:restaurantId/orders` | quem pede não tem conta |
| `GET /orders/:orderId` | **pelo `trackingToken`**, não por sessão — e o token confere contra aquele pedido |
| `GET /orders/:orderId/track` | idem, o canal de WebSocket |

⚠️ As duas últimas são públicas no sentido de "não exigem sessão", mas **não são
abertas**: quem não tem o `trackingToken` não lê pedido nenhum. Elas ficaram fora
desta lista por um tempo, embora sempre tenham estado nas duas listas que a
máquina lê (`test/authorization.test.ts` e `test/openapi.test.ts`) — e uma lista
escrita como "nada além disso" que esquece duas rotas é pior que não ter lista,
porque quem a lê acredita nela. O `POST /auth/verify-email` repetiu a história em
menor escala: entrou nas duas listas da máquina no mesmo commit que o criou, e só
chegou a esta tabela na documentação da feature.

**Autorização também mora no hook.** Ele compara o `:restaurantId` da URL com o da sessão e responde **404** na divergência — 403 confirmaria que aquele restaurante existe. Por isso **toda rota escopada em restaurante precisa chamar o parâmetro de `restaurantId`**: uma rota que o chamasse de `id` ficaria autenticada mas **não** escopada, e uma sessão passaria por cima de outro restaurante. É o tipo de erro que não aparece em teste de caminho feliz.

`test/authorization.test.ts` testa a garantia, não as rotas de hoje: lê a árvore de rotas do próprio Fastify e exige 401 de tudo que não esteja na lista de públicas escrita à mão. Rota nova só passa exigindo sessão ou entrando conscientemente nessa lista.

### Autenticação

- **Sessão opaca no banco**, não JWT (`sessions`). Custa uma consulta por requisição autenticada; em troca, revogar é apagar uma linha em vez de manter lista negra — que seria justamente o estado no banco que o JWT queria evitar.
- **O banco guarda o hash do token**, nunca o token. SHA-256 puro é o certo *aqui e só aqui*: o token são 256 bits sorteados, sem dicionário a que seja vulnerável. **Senha continua em bcrypt** — segredo escolhido por gente exige KDF caro.
- **O bcrypt ignora tudo depois do byte 72, em silêncio.** Verificado: duas senhas que só diferem do byte 73 em diante conferem como iguais, e 40 letras "ç" já são 80 bytes. Como `maxLength` do JSON Schema conta caracteres, a checagem é `Buffer.byteLength` no serviço, e falha com `ValidationError` (400).
- **Login errado responde sempre a mesma coisa, e leva sempre o mesmo tempo**: o bcrypt roda contra um hash descartável quando o e-mail não existe, senão o tempo de resposta viraria um oráculo de quais e-mails estão cadastrados.
- `BCRYPT_ROUNDS` existe só para a suíte baixar o custo para 4; o padrão é 12 e o valor é preso entre 4 e 15.

### Acesso: papéis, senha, usuários e verificação de e-mail

O restaurante teve, por várias PRs, **um login só e nenhuma forma de trocar a senha** — quem a esquecesse perdia o restaurante, sem caminho de volta pela API. As rotas abaixo existem para fechar isso, e a ordem entre elas não é arbitrária.

**`restaurant_users.role` é `owner` ou `staff`.** A checagem vale em **duas** ações — remover o restaurante e administrar usuários — e em nada mais: cardápio, pedidos e configurações são iguais para os dois. O corte é esse porque o problema que os papéis resolvem é esse: sem eles, o atendente convidado herdaria o poder de apagar o negócio.

A marcação é `config: { ownerOnly: true }`, lida pelo **mesmo hook** que já faz autenticação e escopo — o papel vem junto da sessão, na query que resolve o token, então checar não custa ida a mais ao banco.

⚠️ **O sentido do `ownerOnly` é o oposto do `public`, e de propósito.** Lá o padrão fecha, porque esquecer expõe. Aqui o padrão abre, porque o papel restringe só duas ações — marcar rota nova como `ownerOnly` por reflexo criaria uma hierarquia que ninguém decidiu.

**403 aqui, e não 404.** É uma das **duas** situações do projeto em que 403 é a resposta certa — a outra é a loja que ainda não verificou o e-mail, mais abaixo —, e ela não conflita com o S19: lá o 404 protege a *existência* de um restaurante que não é seu; aqui o restaurante É o da sessão e o que falta é permissão. Responder 404 diria que o restaurante sumiu, e mandaria quem está no painel procurar o problema no lugar errado.

**`POST /auth/change-password` exige a senha atual** mesmo já havendo sessão: sem isso, um token roubado trocaria a senha e trancaria o dono para fora — o pior resultado de um vazamento. E revoga as **demais** sessões, poupando a atual; trocar senha é o que se faz ao desconfiar de vazamento, e sessões antigas ainda válidas esvaziariam o gesto.

**`/restaurants/:restaurantId/users`** cria, lista e remove — tudo `ownerOnly`. Sem papel informado o usuário nasce `staff`. **Ninguém remove a si mesmo** (409): a regra impede alguém de se trancar para fora e, como só `owner` remove usuário, garante de quebra que o restaurante **nunca fica sem nenhum dono**.

A sessão de um usuário removido morre sozinha — a resolução do token junta `restaurant_users` filtrando `deleted_at is null`. Há teste para essa propriedade não se perder numa refatoração da query (em `test/auth-users.test.ts`), e ⚠️ o que o prende é a asserção numa rota **escopada**: o `/auth/me` responde 401 com o filtro ou sem ele, porque o `getUser` tem uma segunda rede. Até a revisão desta feature o teste só conferia o `/auth/me`, e o filtro ficou sem cobertura nenhuma: quem o removesse passava pela suíte inteira.

**`POST /auth/forgot-password` e `POST /auth/reset-password` fecham esse buraco.** O pedido gera um token de uso único, válido por uma hora — o banco guarda só o **hash** dele, nunca o token, a mesma decisão de `sessions` e do `trackingToken`. `used_at` (a recuperação aconteceu) e `deleted_at` (o token foi invalidado sem ser usado — por um pedido novo, ou por troca pelo caminho comum) são colunas diferentes de propósito: colapsá-las apagaria, numa investigação de acesso indevido, a distinção entre as duas coisas.

⚠️ **`/auth/forgot-password` sempre responde 202, e responde ANTES de fazer o trabalho.** Responder o mesmo corpo para e-mail que existe e que não existe não bastaria sozinho — se buscar o usuário, criar o token e mandar o e-mail acontecessem antes da resposta, o TEMPO de resposta seria o oráculo: e-mail inexistente voltaria na hora, por não haver usuário para buscar nem e-mail para mandar; existente esperaria a criação do token e a ida ao SMTP. O trabalho roda depois, fora do que o cliente aguarda — nem um provedor de SMTP lento segura a requisição —, e falha de envio vai só para o log: contar ao cliente que o envio falhou também diria que aquele e-mail existe.

A troca (`POST /auth/reset-password`) revoga **todas** as sessões do usuário, sem poupar nenhuma — ao contrário do `change-password`, aqui não existe sessão atual para proteger, e qualquer sessão viva pertence a quem tinha a senha antiga. E não devolve sessão: quem recuperou entra por `/auth/login`, como qualquer login — devolver token ali trocaria a prova de "conhece a senha nova" por só possuir o link.

🚨 **O e-mail sai por `nodemailer` (SMTP) ou por um driver de console, e o de console é recusado em produção — falha ao subir.** Ele escreve o link no log para dev e teste rodarem sem provedor nenhum, mas o link **é** o token: logar isso em produção derramaria credencial de recuperação de senha em log de aplicação, exatamente o que o S13 proíbe. Falhar no boot é a resposta certa — um aviso seria ignorado até o dia em que fizesse falta.

**A verificação do e-mail mora no RESTAURANTE, não no usuário** (`restaurants.email_verified_at`; nulo é "não provou"). A marca natural seria no usuário, já que é a pessoa que prova o endereço — mas quem fica bloqueado e invisível é a **loja**, e é essa diferença que decide o desenho: com a marca no usuário, o hook teria que descobrir se o **dono** verificou (e não o usuário da sessão), um `staff` convidado ficaria bloqueado por não ter verificado nada, e o `findBySlug` do cardápio público — o caminho mais quente da API, o que o QR code abre — passaria a juntar com `restaurant_users`. Com a coluna no restaurante, o hook lê o que já tem em mãos e o filtro público é uma condição a mais numa consulta que já existe. O token aponta para o **usuário** (é a caixa de entrada dele que prova algo) e a verificação marca o restaurante **dele**: não existe token que libere loja de terceiro.

⚠️ **A migration marcou como verificado todo restaurante VIVO que já estava no banco** (`where deleted_at is null`) — é o default sendo backfill, o mesmo cuidado da grade de horário e da taxa de entrega. Sem essa linha, o deploy trancaria toda loja do banco no mesmo instante, e por inteiro: 403 no painel todo e 404 em toda a superfície pública, sem modalidade nenhuma a salvar. A exigência vale só para cadastro novo. ⚠️ E vale para quem restaurar registro na mão (D7, `set deleted_at = null`) — mas **só num dos dois casos**, e a diferença foi medida. O **legado que já estava removido** quando a migration rodou volta **bloqueado**, porque o backfill não o alcançou: ninguém vai estar esperando por isso. Já o **cadastro liberado por abandono** — o estado que esta feature cria — quase nunca chega a voltar: o `update` falha com `duplicate key value violates unique constraint "restaurants_slug_active_key"`, porque quem provocou a liberação já está com o slug; e nas vezes em que o slug não tiver sido retomado, o restaurante volta com **zero usuários vivos** (a liberação marca o restaurante e o usuário dele na mesma transação), então o login responde 401. O comportamento está certo — o índice único é justamente o que impede o estado incoerente —; o que não existe é o caminho de volta que a frase antiga prometia.

**403 no painel, 404 no cardápio — é a mesma decisão vista dos dois lados.** Para quem está no painel, a sessão é válida e o restaurante É o da sessão: esconder mandaria a pessoa procurar o problema no lugar errado. Para quem está do lado de fora, uma loja que não provou o e-mail tem que ser indistinguível de uma que não existe — 403 ali diria "existe, mas não verificou", entregando que o slug está ocupado. ⚠️ No hook, o escopo (o 404 do S19) é conferido **antes** da verificação: invertendo a ordem, uma sessão descobriria que o restaurante de outra pessoa existe só por receber 403 em vez de 404. Há teste para essa ordem.

⚠️ **A criação de pedido não herda o filtro do cardápio**, porque resolve a loja por id (`getById`) e não por `findBySlug`. Ela tem o próprio assert em `services/orders.ts` — são dois lugares, de propósito: `getById` é um "pegue o restaurante por id" de propósito geral, e fazê-lo esconder loja não verificada mudaria o contrato para todo chamador futuro, inclusive os três de painel, que só ficam corretos porque o hook roda antes. Não consolide os dois sem saber o que está trocando.

**O reenvio (`POST /auth/resend-verification`) é parte do desenho, não conveniência.** Se o envio falhar no cadastro — SMTP fora do ar naquele minuto —, a loja fica com a conta criada e nenhum caminho para dentro: uma verificação sem reenvio fecharia um buraco e abriria outro, que é exatamente o que o S30 cobra. É por isso, também, que **o login funciona sem verificação** — é como a pessoa chega até o botão. O reenvio manda para o endereço de **quem chama** (nunca para outro), e invalida o token anterior antes de criar o novo, na mesma transação, para não deixar dois links vivos na caixa de entrada.

⚠️ **O caminho de volta cobre quem não recebeu o e-mail, e NÃO quem digitou o endereço errado.** O `joao@gmial.com` — o caso que motivou a feature — não tem saída pela API: o reenvio vai para o mesmo endereço errado, trocar o e-mail de um usuário não tem rota (ficou fora de escopo de propósito) e o `DELETE` do próprio restaurante responde **403** como qualquer rota escopada. Sobra esperar os 7 dias da liberação de cadastro abandonado; recadastrar antes funciona, mas o slug sai com sufixo aleatório — e slug é a URL do QR code, que o projeto trata como intocável. É pergunta de produto em aberto (o S30 manda continuar fazendo), não detalhe resolvido.

O token vale **24 horas**, e não a uma hora da recuperação de senha: o perfil de risco é outro — um token de recuperação vazado abre uma conta que já existe e tem dado dentro; um de verificação destrava uma conta vazia, cuja senha quem o pegou continua não tendo. Uma hora obrigaria a reenviar para quem só lê o e-mail depois do almoço. O banco guarda só o **hash**, como em `sessions`, no `trackingToken` e na recuperação.

🚨 **O que mantém a limpeza de cadastro abandonado segura é uma condição só: loja não verificada não pode ter NADA dentro.** Isso foi medido em duas revisões e está preso por teste — não é esperança. A loja bloqueada recebe **403 em toda rota de gestão** (produtos, categorias, grupos de opções, usuários, horário, bairros, o `PATCH` e até o `DELETE` do próprio restaurante, porque a verificação é conferida antes do `ownerOnly`), **404 em toda a superfície pública** (cardápio, listagem, cotação de frete e criação de pedido), e termina com **zero linha em toda tabela que tem `restaurant_id`** — as sete de hoje (`products`, `categories`, `option_groups`, `opening_hours`, `delivery_neighborhoods`, `tables` e `orders`), fora `restaurant_users`, que tem exatamente uma linha por construção: o dono. As netas (`options`, `order_items`, `order_item_options`, `product_option_groups`) são chaveadas pelo pai, então entram só transitivamente — pai vazio, neta vazia. As rotas autenticadas que escapam do gate escapam porque ele depende do parâmetro `:restaurantId` na URL — são `GET /restaurants`, `GET /auth/me`, `POST /auth/resend-verification`, `POST /auth/logout` e `POST /auth/change-password` —, e todas são leitura ou escrita na **própria** conta de quem chama (sessão, senha, token de verificação): nenhuma delas cria filho de restaurante. ⚠️ Uma delas produz uma assimetria que quem for construir o painel vai encontrar, e ela é conhecida e não é vazamento: a **mesma linha** de restaurante sai **200** por `GET /restaurants` e **403** por `GET /restaurants/:restaurantId`, porque o gate chaveia pelo parâmetro da URL e a listagem não o tem. A listagem é filtrada pela sessão (devolve só o próprio cadastro), é só leitura, e `emailVerifiedAt` não está no `restaurantResponseSchema` — nada escapa por ali; o que escapa é a coerência. ⚠️ Esse conjunto de cinco **não** está preso por teste: a varredura chama uma lista escrita à mão, então uma rota autenticada nova, sem `:restaurantId`, que escrevesse dado de restaurante deixaria a contagem em zero e a premissa cairia em silêncio. **Se isso deixar de valer, o estrago não é uma linha a mais removida — são as filhas ficando órfãs**: produto, categoria, grupo de opções (com as opções e os vínculos pendurados nele), grade, bairro e mesa vivos, apontando para um restaurante morto, fora do alcance de qualquer cascata — a cascata de verdade mora no `remove()` de `services/restaurants.ts`, e a limpeza não a usa. **O pedido não entra nessa lista**: pedido vivo sob restaurante morto é o estado normal também depois do `remove()`, porque pedido é histórico e nunca cascateia (ver a seção de pedidos). O teste da varredura tira essa lista do catálogo do Postgres, então tabela nova **com `restaurant_id`** entra sozinha — uma chaveada por `product_id` não entraria, e aí é a neta que segue coberta só pelo pai.

**Cadastro abandonado libera slug e e-mail, passados 7 dias.** Quem se cadastra e nunca verifica segura duas coisas escassas, e a verificação tornou o abandono mais provável por criar um passo a mais onde desistir. O dano é mudo: a segunda "Pizzaria do João" ganha sufixo por causa de uma primeira que nunca existiu de fato, e — pior — quem não recebeu o e-mail e tenta de novo com o mesmo endereço batia em "e-mail já usado", sem caminho nenhum. Por isso **`POST /auth/register` agora responde 201 onde respondia 409**. Os 7 dias são folgados de propósito: o token vale 24 horas e o reenvio existe, então "demorei para confirmar" não pode virar "perdi o endereço para outra pessoa".

⚠️ **A liberação roda dentro da transação de quem chamou (D3)**, e marca o restaurante e o usuário dele juntos — é o usuário que segura o e-mail. Se o cadastro novo falhar depois (o slug liberou, mas o e-mail está ocupado por uma conta viva), o rollback desfaz a liberação junto; com transação própria, um 409 apagaria para sempre um cadastro numa requisição que não criou nada.

⚠️ **A limpeza é preguiçosa por falta de lugar melhor, e os dois lugares óbvios não servem.** No índice único parcial o Postgres recusa — `functions in index predicate must be marked IMMUTABLE`, e `now()` não é (verificado neste ambiente). Numa rotina agendada, o projeto não tem agendador, e trazer um para isto seria infraestrutura nova para um caso de borda. Na colisão o trabalho acontece exatamente quando importa, e custa uma consulta a mais só quando há colisão.

### Trabalho depois da resposta (`src/background.ts`)

Três rotas respondem antes de terminar o serviço — o cadastro (manda o e-mail de verificação), o reenvio e o `/auth/forgot-password` —, e nas três o motivo é o mesmo: o tempo de resposta não pode denunciar o que aconteceu, e um provedor de SMTP lento não pode segurar a requisição. `track()` registra a promessa, `drainBackgroundWork()` espera todas. Continua sendo fogo-e-esquece para quem chama: a rota não aguarda nada. O que se ganha é que alguém mais sabe da promessa — sem isso, o `app.close()` termina com o e-mail de quem acabou de se cadastrar no meio, e o `truncate` do `afterEach` disputa lock com o insert que ficou correndo (medido: em três execuções da suíte, uma teve deadlock e uma falha de teste).

Dois detalhes custaram tempo de verdade, e os dois são contraintuitivos:

- ⚠️ **Quem tira do conjunto é o laço do dreno, DEPOIS de esperar** — não o `finally` de `track()`, e nunca antes da espera. Esvaziar o conjunto antes de esperar fazia um segundo dreno, começado no meio do primeiro, enxergar conjunto vazio e voltar dizendo "terminou" com trabalho ainda correndo. E a versão que confiava no `finally` para esvaziar reentrava no `while` com as mesmas promessas já resolvidas, e virava laço quente: medido, um teste ficou **707 segundos** preso assim.
- ⚠️ **O `onClose` drena com PRAZO** (`SHUTDOWN_DRAIN_TIMEOUT_MS`, 5 s — folga para um envio normal terminar, e dentro de qualquer janela de deploy). A espera ilimitada pendurava o `app.close()` atrás de um socket de SMTP travado — o nodemailer espera 2 minutos para conectar e 10 para o socket — e o `pool.end()` depois dela nunca rodava, que era exatamente o que o hook queria garantir (F26). Perder um e-mail é melhor que não encerrar. No teste o dreno é **sem** prazo, de propósito: ali, trabalho que não termina é sintoma a enxergar, não a esconder.

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

### Grupos de opções

O cardápio ganhou um quarto nível: `Categoria -> Produto -> Grupo de opções -> Opção`. Sem ele o sistema não vende pizza (tamanho, sabor), hambúrguer com adicional nem combo — o produto sozinho só descreve item de preço fixo.

**O grupo pertence ao RESTAURANTE, não ao produto**, e se liga a cada produto por uma junção (`product_option_groups`), como a `PUT /restaurants/:restaurantId/products/:id/option-groups` deixa explícito. "Sabores" vale para todas as pizzas do cardápio; com grupo por produto, a décima pizza recriaria quatro grupos e vinte opções à mão, e corrigir o preço do bacon viraria editar trinta lugares em vez de um.

**Três regras decidem como o preço das opções escolhidas entra na conta** (`PRICE_RULES` em `domain/option.ts`, e o restaurante escolhe por grupo):

- **`sum`** — soma tudo (o caso comum: adicionais, quantidade multiplica preço).
- **`highest`** — cobra só a opção mais cara escolhida, sem multiplicar por quantidade. É a regra da pizza meio a meio: dois pedaços do mesmo sabor não dobram o preço, e dois sabores diferentes cobram o mais caro dos dois, não a soma.
- **`average`** — a média das opções escolhidas, ponderada por quantidade, arredondada meio-para-cima. A outra convenção de meio a meio, e as duas convivem no mercado — quem decide é o restaurante, não o sistema. Fica de fora o "menor" que outra plataforma do ramo oferece: nenhum cardápio real do nicho o usa.

Fica claro por que somar ingenuamente os preços das opções erra para `highest`/`average`: são **entradas de uma fórmula**, não parcelas de uma soma. Medido: uma pizza de R$ 30,00 com sabores de R$ 45,05 e R$ 50,00 custa **R$ 80,00** em `highest` (o mais caro dos dois) e **R$ 77,53** em `average` — a soma ingênua dos três daria R$ 125,05, quase o dobro do certo.

**A aritmética de dinheiro — arredonda uma vez só, no preço unitário do item, nunca por grupo.** `unitPrice()` em `domain/option.ts` acumula as contribuições de `average` como uma fração exata (numerador/denominador, sem passar por float) e só converte para centavos inteiros no fim, com a mesma `divideRounded()` que soma o total. Arredondar dentro de cada grupo produziria viés sistemático **para cima** — medido: três grupos caindo em meio centavo, em dez unidades, cobram dez centavos a mais do que deveriam. E arredondar no total do item (`unitário × quantidade`) faria essa multiplicação deixar de fechar com o total do pedido — um recibo cuja conta não bate é lido como erro por quem confere, mesmo sendo só um centavo.

⚠️ **`options.price_in_cents` tem `check (>= 0)`, e isso não contradiz a ausência do `check (stock >= 0)` em `products`.** São dois problemas diferentes: o `stock` não tem check de propósito, porque a constraint transformaria a race condition da confirmação num erro de Postgres e esconderia o sintoma que o teste de concorrência precisa enxergar — ali existe corrida de verdade, entre transações concomitantes. Preço de opção não tem corrida nenhuma: negativo é só entrada sem sentido, e barrá-la na constraint é rede de segurança, não sintoma escondido. O check também fecha uma porta específica: o arredondamento meio-para-cima de `average` é assimétrico no negativo, e é essa assimetria que abriria espaço para uma "opção de desconto" manipular o resultado — com preço sempre `>= 0`, ela nunca é alcançada.

**A chave de fusão de itens do pedido deixou de ser só o `productId`.** Era a chave certa antes de existir opção: agora "um hambúrguer com bacon" e "um sem bacon" são pedidos diferentes, e fundi-los pelo `productId` sozinho os transformaria em "dois hambúrgueres" — o cliente receberia dois iguais no lugar de um com bacon e um sem. `chaveDeFusao()` em `services/orders.ts` inclui as escolhas do item, normalizadas (ordenadas por id de opção): a mesma seleção pedida em ordem diferente no corpo continua fundindo numa linha só, com a quantidade somada.

**A confirmação confere estoque somado por produto, não por linha.** Um pedido pode ter mais de uma linha do mesmo produto — duas metades de sabores diferentes viram duas linhas de `order_items` do mesmo `product_id`, cada uma com suas opções. Se `debitarEstoque()` conferisse linha a linha, duas linhas de 3 unidades cada enxergariam o mesmo estoque de 4 e as duas passariam pela checagem "tem 4?" — e o débito, que continua rodando por linha (a linha do produto já está travada), tiraria 6 de um estoque de 4. Por isso a soma acontece **antes** de qualquer débito, por `product_id`, e só depois disso o loop de débito roda linha a linha.

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

### O painel: fuso, período e ordenação

Três coisas do painel do restaurante andam juntas, e a primeira sustenta as outras duas.

**`restaurants.timezone` decide onde o dia começa.** É nome IANA (`America/Sao_Paulo`, o default), não offset fixo: offset não sabe de horário de verão, e o Brasil já mudou o dele por município. Sem a coluna, "pedidos de hoje" não tem resposta — o dia de Manaus começa uma hora depois do de São Paulo, e o painel precisa que "hoje" signifique a mesma coisa para o dono em casa e para o gerente no salão. É editável por PATCH (ao contrário do slug, mudá-lo não quebra QR code impresso) e **não** sai no cardápio público (S10).

A validação é construir um `Intl.DateTimeFormat` e ver se ele reclama, **não** comparar com `Intl.supportedValuesOf("timeZone")`: aquela lista traz só nomes canônicos e recusaria apelidos como `Brazil/East`, que o Postgres aceita — e aí a API e o banco discordariam sobre o que existe.

⚠️ **As contas de "meia-noite de hoje" ficam no Postgres, não no Node.** Elas dependem do banco de fusos, que o `at time zone` já consulta; refazê-las em JavaScript seria uma segunda implementação da mesma regra, discordando da primeira exatamente nos dias de virada. As expressões vivem num mapa fixo em `repositories/orders.ts` e o fuso vai como `$n` — ele é valor, não identificador.

**O recorte de tempo tem duas formas, e elas não se misturam:** `?period=today|yesterday|last7days|thisMonth` (os botões) **ou** `?from=&to=` (`YYYY-MM-DD`, intervalo fechado nos dois lados, o seletor de datas). Mandar as duas é **400** — não existe "hoje, de 1 a 5 de agosto", e ignorar uma em silêncio devolveria um número que ninguém pediu.

**A listagem de pedidos vem do mais novo primeiro** (mudou: era crescente). O painel existe para ver o pedido que acabou de chegar; quem quer a ordem da cozinha pede `?order=asc`. `?sort=` aceita `createdAt` e `totalInCents`, e é **allowlist** (S3): `order by` não aceita `$n`, então um mapa fixo traduz o campo para a coluna e a direção sai de um ternário, nunca da string recebida.

**`GET /restaurants/:restaurantId/orders/summary`** devolve os contadores por status (todos, zerados ou não), o faturamento, quantos pedidos o compõem e o ticket médio. Rota separada da listagem porque o painel troca de página e de filtro o tempo todo, e porque `total` (da consulta paginada) e os contadores (do período inteiro) são duas noções de "quantos" que não devem morar no mesmo corpo.

**Faturamento é o que o restaurante ACEITOU vender:** de `confirmed` em diante, sem `pending` (ainda não é venda) nem `cancelled` (deixou de ser). Contar só `completed` mostraria quase zero no pico do almoço, que é quando alguém abre o painel. A lista vive em `REVENUE_STATUSES` no domínio, **não no SQL**: o repositório agrupa por status e devolve o cru, e a regra é aplicada no serviço — se estivesse na query, mudá-la sumiria de onde alguém a procura. ⚠️ Status novo na máquina **não** entra ali sozinho.

⚠️ **Desde a taxa de entrega, o faturamento inclui o frete** — e isso não foi
decidido, foi herdado. `revenueInCents` soma `total_in_cents`, e esse total
passou a carregar o frete nos pedidos de entrega. Medido: R$ 30,00 de mercadoria
com R$ 15,00 de frete entra como R$ 45,00 de faturamento, e o ticket médio passa
a misturar comida com entrega. Para faturamento bruto o número está certo — foi
o que a loja cobrou —, mas para decidir preço de cardápio, não: o frete pode ser
repassado ao entregador. **Se alguém quiser separar os dois, é decisão de
produto, não refatoração**, e o lugar é o serviço, que já aplica a regra de
`REVENUE_STATUSES` sobre o cru do repositório. Há teste prendendo o
comportamento de hoje, para a mudança ser deliberada.

A resposta traz em `period` os instantes que o servidor usou. Sem eles, "por que o faturamento de hoje está zerado?" não tem como ser respondido sem abrir o banco.

### Horário de funcionamento, pausa manual e forma de pagamento

Duas lacunas que existiam desde o início: `restaurants` não tinha nenhuma coluna de horário (dava para pedir às 4 da manhã, e o restaurante só descobria o pedido ao abrir) e `orders` não tinha nenhuma coluna de pagamento (no delivery brasileiro o grosso é pago na entrega, e o entregador saía sem saber se precisava de troco). As duas seguem o formato de "o restaurante configura, e o pedido respeita" que `isDelivery`/`isTakeaway`/`isQrcode` já tinham consagrado.

⚠️ **Restaurante já cadastrado ganhou grade 24x7 por backfill, e isso foi decisão, não descuido.** "Dia sem faixa é dia fechado" é o desenho certo para restaurante novo — mas a tabela nasceu vazia e o bloqueio de 409 entrou depois, na mesma branch: sem backfill, o deploy fecharia TODO restaurante do banco, nas três modalidades, até alguém abrir o painel. A migration `backfill-opening-hours` dá a cada restaurante existente duas faixas por dia (`00:00–23:59` e `23:59–00:00`, porque a primeira sozinha deixaria o minuto das 23:59 de fora), preservando o comportamento anterior e deixando cada dono restringir quando quiser. Restaurante criado **depois** dela continua nascendo sem grade — e fechado.

**A grade é faixas por dia da semana, `opening_hours`, e um dia pode ter várias.** É o que separa este desenho de "uma faixa por dia": o restaurante que fecha entre o almoço e o jantar declararia 11:00–23:00 numa faixa só e aceitaria pedido às 16:00, quando a cozinha está fechada. **Dia sem nenhuma faixa é dia fechado** — não existe coluna de "fechado": uma flag redundante junto das faixas permitiria o estado incoerente de "fechado, das 11 às 15", e a ausência já é informação suficiente.

⚠️ **`closes_at < opens_at` não é erro de cadastro — é a faixa que atravessa a meia-noite.** `18:00–02:00` é a pizzaria que atende até as duas da manhã, metade do mercado de delivery noturno. Por isso só a *igualdade* entre `opens_at` e `closes_at` é proibida (faixa de duração zero não significa nada); a inversão tem significado próprio. É também a parte que exige teste dedicado: às 01:00 de terça, o restaurante está aberto por causa da faixa cadastrada em **segunda**, não em terça.

**A checagem de "está aberto agora?" roda no Postgres, não no Node** — mesmo motivo do filtro de período do painel: ela depende do banco de fusos, que o `at time zone` já consulta, e refazer a conta em JavaScript seria uma segunda implementação da mesma regra, discordando da primeira exatamente nos dias de virada de horário de verão. `isOpenNow()` em `repositories/opening-hours.ts` compara o instante atual, convertido para o fuso do restaurante, contra as faixas — nos dois ramos (dentro do mesmo dia, e atravessando a meia-noite).

⚠️ **`opens_at`/`closes_at` são `time`, não `timestamptz` — e isso NÃO viola a D13.** A D13 existe para *instantes*: `timestamp` sem fuso, usado para marcar um instante, é lido no fuso da máquina e vira horários diferentes em máquinas diferentes. Aqui não há instante — "18:00" é hora de parede, deliberadamente sem fuso e sem data, e o fuso só entra na hora de comparar, vindo de `restaurants.timezone`. Guardar como `timestamptz` exigiria inventar uma data para uma informação que não tem data.

**A pausa manual, `restaurants.accepting_orders`, é uma segunda condição, não uma substituição da grade.** A loja está aberta quando está dentro de uma faixa **e** não está pausada — desligar os pedidos não mexe no horário cadastrado, então ninguém precisa lembrar de reativar a grade depois. O nome é positivo (`accepting_orders`, não `paused`) de propósito: é a leitura que o código faz o tempo todo (`if (!restaurant.acceptingOrders) recusa`), e negativa dupla dentro de uma condição é onde nasce erro de lógica. No cardápio público, `isOpen` já é o resultado das duas condições juntas; `acceptingOrders` sai separado para a tela distinguir "fechado agora, abre às 18h" (mensagem: espere) de "a loja pausou os pedidos" (mensagem: tente mais tarde) — e a criação do pedido recusa as duas com **409**, cada uma com sua mensagem, pelo mesmo motivo.

**As formas de pagamento aceitas são quatro colunas booleanas no restaurante** (`accepts_cash`, `accepts_card_on_delivery`, `accepts_pix`, `accepts_meal_voucher`), espelhando de propósito o padrão de `is_delivery`/`is_takeaway`/`is_qrcode`: já resolveu esta forma de problema aqui, e um array ou jsonb não filtraria melhor nem custaria menos (D15). `accepts_meal_voucher` nasce `false` — vale-refeição exige credenciamento com a bandeira, e um "sim" que o restaurante não consegue honrar é pior que a ausência. O cardápio público não expõe as quatro flags cruas; deriva delas a lista `paymentMethods` que o cliente escolhe.

**O troco tem duas regras, e elas moram em lugares diferentes — a distinção importa.** A primeira, `change_for_in_cents` só existe para pagamento em `cash`, está no `check` do banco **e** no serviço: pedir troco no pix não faz sentido, e o `check` garante isso mesmo se o serviço tiver um bug. A segunda, o troco informado não pode ser menor que o total calculado no servidor, existe **só no serviço** (`assertTrocoCoerente`) — o `check` não enxerga `total_in_cents` para comparar. Pedir troco para R$ 20 numa conta de R$ 45 não é um pedido, é engano que o entregador descobriria na porta; e quem for refatorar `assertTrocoCoerente` precisa saber que não há rede embaixo dela. Ausência de `changeFor` em dinheiro é válida e significa "tenho o valor exato"; exigi-lo obrigaria quem paga certo a inventar um número.

### Taxa de entrega

`delivery` existe desde a migration `add-order-type-and-status`, e até esta
feature **era de graça**: o restaurante não tinha onde dizer quanto cobra para
entregar, nem até onde entrega, e o pedido não tinha onde guardar isso. Na
prática, todo delivery saía com frete zero e a loja acertava por fora, ou
desistia de usar o sistema para entrega. Por isso o default das colunas novas
(`delivery_fee_mode = 'fixed'`, `delivery_fixed_fee_in_cents = 0`) preserva
**exatamente** esse comportamento — restaurante já cadastrado continua de graça
até o dono configurar, o mesmo cuidado de backfill que a grade de horário já
tinha ensinado do jeito caro.

**O modo mora no restaurante, um só por vez.** `neighborhood` cota por bairro
do endereço (casado por `neighborhood`, normalizado do mesmo jeito que o
`slug` — sem acento, sem caixa, sem espaço sobrando), `fixed` é uma taxa única
para qualquer endereço, e `distance` (faixas de km) é o terceiro valor que a
**coluna** aceita. Permitir mais de um modo simultâneo exigiria uma regra de
precedência que ninguém pediu e que o dono não saberia explicar ao cliente.

⚠️ **`distance` existe no banco, mas a API não deixa a loja escolhê-lo — ainda.**
`SELECTABLE_DELIVERY_FEE_MODES` (`domain/delivery.ts`) é a allowlist que o
schema de `PATCH /restaurants/:id` usa, e ela lista só `neighborhood` e
`fixed`. `distance` vai precisar de faixas de km cadastradas e de
geocodificação (Nominatim — que será a primeira dependência externa em
runtime do projeto, com cache e teto de 1 req/s) para calcular alguma coisa, e
nada disso existe ainda. Selecioná-lo hoje deixaria a loja num modo que
**nunca** consegue determinar o frete, sempre caindo no caminho de "a
combinar" ou de recusa — oferecer o modo já seria oferecer um estado quebrado.
Ele chega na Parte 2.

⚠️ **Configuração ausente não é frete zero.** Modo bairro sem nenhum bairro
cadastrado, ou endereço num bairro fora da lista, não é "grátis" — é "não
consegue determinar", o mesmo princípio de "dia sem faixa é dia fechado" do
horário de funcionamento. Tratar o vazio como zero faria a loja entregar de
graça para a cidade inteira por esquecimento, que é o erro mais caro que este
desenho evita. Quando o cálculo não consegue decidir, quem resolve é
`delivery_fee_to_arrange`: ligado, o pedido é aceito com frete `null` (o
cliente e a loja combinam por fora); desligado, a criação recusa com **409**.

**O frete gravado no pedido tem três estados, e eles são distintos de propósito:**

| `deliveryFeeInCents` | Significa |
| --- | --- |
| um valor > 0 | o frete cobrado |
| `0` | entrega grátis |
| `null` | "a combinar", ou pedido que **não** é `delivery` |

Confundir `0` com `null` entregaria de graça por acidente (o primeiro) ou
esconderia uma promoção genuína atrás de "não sei calcular" (o segundo) — por
isso o schema das respostas usa `nullable: true` (F12), nunca omite o campo.

**"Grátis acima de X" (`free_delivery_above_in_cents`) compara com o
SUBTOTAL dos itens, nunca com o total.** Comparar com o total seria circular:
o total inclui o frete, que é justamente o que está sendo decidido. Vale nos
três modos — é promoção do restaurante, não propriedade de um jeito de
calcular —, e o limite é inclusivo (pedido de exatamente R$ 50 com "grátis
acima de R$ 50" é grátis; exclusivo faria o cliente de R$ 50,00 pagar frete e o
de R$ 50,01 não, o que ninguém explica no balcão).

⚠️ **Isto muda o significado de `total_in_cents`, e é *breaking* — a
invariante da soma dos itens mudou.** Até aqui, todo pedido satisfazia
`Σ(unitPrice × quantity) = total`. De agora em diante, pedido de entrega
satisfaz `Σ(unitPrice × quantity) + frete = total`; salão e retirada continuam
na regra antiga, porque não têm frete. **Toda superfície que mostra o pedido
precisa mostrar o frete**, senão a conta não fecha para quem confere — é a
mesma categoria de defeito que motivou o cuidado com arredondamento em
`unitPrice()` na feature de grupos de opções: um recibo cuja conta não bate é
lido como erro por quem confere, mesmo sendo só um centavo. O troco
(`change_for_in_cents`) já é conferido contra esse total com frete embutido:
seria o entregador descobrindo na porta que faltou dinheiro se a checagem
comparasse com o subtotal.

**O endpoint de cotação informa; a criação decide.**
`POST /menu/:slug/delivery-quote` é público como o resto do cardápio, recebe o
endereço no **corpo** (nunca na querystring — endereço de cliente não deve
morar em log de proxy, o mesmo raciocínio do S21), e devolve `deliversTo`,
`feeInCents`, `isFree`, `toArrange` e `servedNeighborhoods` (só populada no
modo bairro, para a tela oferecer um seletor em vez de texto livre). Ele
**não é autoridade**: a criação do pedido recalcula a cotação no servidor, do
zero, e recusa com 409 se a loja não entrega naquele endereço. Entre cotar e
montar o carrinho cabe tempo de sobra, e cabe um cliente batendo direto na API
sem nunca ter chamado a cotação — a mesma separação que `isOpen` (informa) e o
409 da pausa manual (decide) já tinham. `deliveryFeeInCents` que venha no corpo
da criação é ignorado, pela mesma razão de `totalInCents` nunca existir lá.

Só três colunas cruas de configuração chegam ao cardápio público —
`deliveryFeeMode`, `freeDeliveryAboveInCents` e `minimumOrderInCents`, o
suficiente para a tela anunciar "frete grátis acima de R$ 50" e "pedido mínimo
de R$ 30" antes do carrinho. `MenuRestaurant` (`domain/menu.ts`) é um `Pick`
explícito do `Restaurant`, não um `Omit` — coluna nova não chega ao cardápio
sozinha, precisa entrar no `Pick`, no `toMenuRestaurant()` e no
`schema.response` da rota, os três (S10).
`deliveryFixedFeeInCents` e `deliveryFeeToArrange` ficam de fora **de
propósito**: a cotação já devolve o número certo para o endereço do cliente, e
a política de "a combinar" é operação interna da loja, não informação dele.

### Mesas e o QR code do salão

`dine_in` existe desde a migration `add-order-type-and-status`, e até esta
feature **não sabia de onde o pedido vinha**: o slug é um só por restaurante,
então o QR da mesa 3 e o da mesa 12 abriam a mesma URL, e o pedido chegava com
nome e telefone do cliente e nada mais — o garçom saía procurando pelo salão.
`tables` é a entidade que faltava para o QR code significar alguma coisa.

**A mesa só IDENTIFICA.** Não tem estado, não acumula conta, não fecha total:
se a mesa 7 pedir três vezes, são três pedidos independentes etiquetados "Mesa
7", cada um com a trilha de status que já existia. Conta aberta (uma
`table_sessions`, abrir/fechar, taxa de serviço) é outro produto e outra PR —
o que este desenho garante é não fechar a porta para ela: bastaria uma coluna
a mais em `orders`.

**O hash da mesa fica EM CLARO no banco, e isso não afrouxa o S21.** `sessions`
e o `trackingToken` guardam só o `sha256` porque são segredos entregues **uma
vez** a uma pessoa. O hash da mesa é o oposto em todas as dimensões que
importam: está impresso num adesivo colado na parede, à vista de quem entrar no
salão, e precisa ser **reimprimível** — o adesivo descola, rasga, encardece. Só
o hash no banco tornaria reimprimir impossível, porque o valor original não
existiria em lugar nenhum. O que o protege é entropia (16 bytes, 128 bits) mais
a **rotação**, não sigilo. ⚠️ Por isso o gerador mora em `domain/table.ts` e
**não** em `tokens.ts`: aquele arquivo se abre prometendo "o banco guarda só o
hash", e enfiar a mesa lá obrigaria a afrouxar a promessa — abrindo a porta
para alguém guardar um segredo de verdade em claro "seguindo o exemplo da
mesa".

São **16 bytes, e não os 32 de `tokens.ts`**, porque o critério é outro: lá o
tamanho vem de "isto protege o dado de alguém"; aqui vem de "isto é impresso, e
cada caractere adensa o QR" — QR mais denso escaneia pior de longe e com luz
ruim, que é a condição real de um salão.

**A rotação é rota própria (`POST .../tables/:id/rotate-hash`), e o `PATCH` não
toca no hash.** Renomear "Mesa 7" para "Mesa 8" não pode, como efeito
colateral, matar o adesivo colado nela — é o mesmo raciocínio que mantém o
`slug` fora do PATCH do restaurante.

**A URL do QR é `MENU_BASE_URL/<slug>?mesa=<hash>`, e o servidor a monta
inteira** (`qrUrl` na resposta). O front só a entrega à biblioteca de QR:
tanto `react-qr-code` quanto `qrcode.react` têm `value: string` como única prop
obrigatória. O slug fica no caminho e o hash na querystring de propósito — uma
URL auto-contida (`/m/<hash>`) economizaria treze caracteres e custaria um
**segundo cardápio público** para manter em sincronia com o primeiro. (Para
quem for desenhar a tela: o `level` default das bibliotecas é `L`, 7% de
correção de erro; um adesivo que vai pegar gordura e risco quer `M` ou `Q`.)

🚨 **`MENU_BASE_URL` derruba o boot se faltar** — mais duro que as URLs de
e-mail, que só o derrubam com `EMAIL_DRIVER=smtp`. A diferença é o custo do
erro: link de e-mail errado se conserta com um reenvio; URL de QR errada já foi
impressa, plastificada e colada em quarenta mesas antes de alguém escanear a
primeira, e desfazer é trabalho físico.

⚠️ **`tableHash` na criação do pedido é OPCIONAL, e essa é a garantia mais
frágil da feature.** Todo QR impresso antes dela aponta para `/slug` sem hash
nenhum; exigir a mesa faria, no deploy, **todo adesivo já colado parar de
funcionar** — o cliente escaneia, monta o carrinho e leva erro no fim. E aqui
não existe backfill honesto: a grade de horário pôde ser salva com 24x7 porque
aquilo *preservava* o comportamento anterior, mas inventar uma "Mesa 1" por
loja não preservaria nada, já que o adesivo impresso continuaria sem o hash
dela. Pedido de salão sem mesa continua significando o que sempre significou.
Há teste prendendo isso, e é o primeiro a cair em quem "limpar" a
opcionalidade. O custo assumido: enquanto houver adesivo velho, o painel terá
pedidos de salão sem mesa, e não dá para distinguir "adesivo antigo" de "abriu
o cardápio direto". Se incomodar, a saída é uma flag `requiresTable` que a loja
liga **depois** de trocar os adesivos — aditiva, não quebra ninguém.

**O pedido congela o rótulo** (`orders.table_label`, ao lado de `table_id`),
como `order_items` congela nome e preço do produto: renomear a mesa não
reescreve histórico, remover a mesa não apaga o rótulo do pedido, e nenhuma
leitura de pedido junta `tables`. O `check` `orders_table_check` exige as duas
colunas juntas e só em `dine_in` — espelha o `orders_address_check`.

**Hash errado na criação é 400, não 404** (mesa de outro restaurante, hash
inexistente, hash já rotacionado): é a montagem do pedido que falha, não um
recurso ausente — a mesma categoria das violações de opção. Já na **resolução
pública** tudo é 404, inclusive hash malformado: ali "não existe" e "não
poderia existir" têm que ser indistinguíveis, e por isso o schema daquela rota
**não tem `pattern`** apesar de o hash ter forma conhecida (um `pattern` faria
formato errado sair 400, denunciando que aquele formato chegou a ser avaliado).

⚠️ **A resolução pública devolve SÓ o rótulo** — nem `id`, nem `hash`. Quem
escaneou precisa saber em que mesa está; devolver o hash entregaria a
credencial do adesivo a qualquer um que passe pela mesa. O `hash` sai, sim, nas
rotas de **gestão**: lá quem lê é o dono do salão, que precisa dele para
imprimir.

**Nenhuma rota de mesa é `ownerOnly`**: o papel restringe só o que é destrutivo
(apagar o negócio, administrar usuários), e gerenciar mesa é operação de salão,
como mexer no cardápio.

**Quem está na mesa continua sem acompanhar o pedido**, e isso é do modelo, não
um `if` removível: `dine_in` não recebe `trackingToken`
(`acompanhaPedido()` em `domain/order.ts` é `return type !== "dine_in"`), então
não existe credencial com que conectar. A pessoa pede e descobre quando a
comida chega.

**O painel filtra por mesa** com `?tableId=` na listagem de pedidos — é o que
torna a etiqueta útil em vez de decorativa.

### Pedido mínimo

`restaurants.minimum_order_in_cents` é o piso de valor para a loja sair para
entregar, e **vale só em `delivery`**: entrega tem custo de piso — sai
entregador, sai veículo —, enquanto retirada e salão não custam nada a mais à
loja. Recusar um café de R$ 5 no balcão só perderia venda. É outro conceito que
não se mistura com o frete: o mínimo **recusa** o pedido, não cobra por ele.

⚠️ **Compara com o SUBTOTAL dos itens, nunca com o total.** É o mesmo critério
do "grátis acima de X", e aqui a razão é ainda mais direta: o total inclui o
frete, e deixá-lo contar para atingir o mínimo faria o cliente pagar mais para
contornar exatamente o que a loja quis evitar — sair para entregar pouca
mercadoria.

O limite é **inclusivo**: pedido de exatamente R$ 30 com mínimo de R$ 30 passa.
Exclusivo recusaria o de R$ 30,00 e aceitaria o de R$ 30,01, o que ninguém
explica ao cliente — o mesmo raciocínio do frete grátis.

⚠️ **Zero é "sem mínimo", e por isso a coluna NÃO é nulável.** É o contraste
deliberado com `free_delivery_above_in_cents`, que é nulável e precisou de
`nullable: true` no schema do PATCH (F12) para a loja conseguir DESLIGAR a
promoção — lacuna que só a revisão daquela branch pegou. Aqui desligar é pôr
zero, e o caminho de volta existe sem tratamento especial.

**A recusa é 409 na criação do pedido, e a mensagem traz o valor em reais**
(`R$ 30,00`, não `3000`): quem a lê é o cliente. E o mínimo **não fica gravado
no pedido** — ao contrário do frete, ele não é cobrado, é só condição de
aceite, e não há o que congelar. `minimumOrderInCents` sai no cardápio público
para a tela avisar antes do carrinho: informar continua sendo do cardápio,
decidir continua sendo da criação.

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

**`GET /orders/:orderId?token=` é o gêmeo HTTP do canal**, e existe por duas razões que ele não cobre: o WebSocket transmite só `{ id, type, status, totalInCents, updatedAt }` (é mensagem de mudança, não de consulta), então depois de um reload a tela não teria como dizer o que a pessoa pediu; e upgrade de WebSocket morre atrás de proxy corporativo. A rota devolve os **itens**, confere o `orderId` contra o pedido que o token resolve (senão um token legítimo leria qualquer pedido) e **não** devolve os dados do cliente nem do restaurante.

⚠️ **O emissor é do processo.** Com duas instâncias, o cliente conectado na A não recebe o evento publicado na B, e a falha é silenciosa — a tela só não atualiza. Mesma limitação do contador de rate limit, mesma solução (pub/sub no Redis).

**Teste de WebSocket não usa `app.inject()`** — ele não faz upgrade. `test/orders-tracking.test.ts` sobe o servidor em porta efêmera (`listen({ port: 0 })`) e conecta com um cliente real; é a exceção documentada ao F21. E o cliente de teste enfileira as mensagens desde antes do `open`: o servidor manda o `snapshot` assim que a conexão abre, e um listener registrado depois do `open` chega tarde demais.

### Limites de exposição

Todos os números vivem em `src/limits.ts`, cada um com o porquê ao lado, e **nenhum é o default** (F27/S16): `bodyLimit` 128 KB, `keepAliveTimeout` 72s (tem que ser **maior** que o do proxy à frente, senão vira 502 intermitente), `connectionTimeout` 10s, e os tetos de rate limit.

**Rate limit:** 100 req/min por IP no geral, **5 req/min no `/auth/login`**. A chave é só o IP — por e-mail protegeria uma conta de ataque distribuído, mas viraria uma forma de trancar o dono para fora. O contador é em memória, **por processo**: com duas instâncias, o limite efetivo dobra.

⚠️ **`POST /auth/resend-verification` é o único teto do projeto que NÃO tem o IP como chave:** ele conta por **usuário**, 3 por minuto (o suficiente para "cliquei, não chegou, cliquei de novo"). A rota exige sessão, então existe sinal melhor que o endereço de rede — e por IP duas lojas na mesma praça de alimentação, ou atrás do mesmo CGNAT, dividiriam o teto e o botão de "não recebi o e-mail" pararia de funcionar justamente para a segunda. O teto precisa existir porque cada chamada manda um e-mail de verdade: sem ele, uma sessão sozinha dispara os 100/min do teto global contra a reputação do domínio. O S25 manda usar IP em rota **anônima**, onde não há outra chave; não é o caso desta.

⚠️ **`TRUST_PROXY` precisa estar certo, e os dois erros custam caro.** `false` atrás de um proxy faz `request.ip` ser o IP do proxy para todo mundo, e o teto vira compartilhado entre todos os clientes juntos. `true` com a app exposta direto deixa qualquer um forjar o `X-Forwarded-For` e escolher o próprio IP. Default `false`.

⚠️ **O rate limit roda DEPOIS da autenticação**, e isso não é escolha nossa: o plugin instala a checagem como hook de rota, e hook de rota roda depois dos hooks de instância. Instalar um hook de instância por fora não resolve — o plugin marca a requisição e roda no máximo uma vez, então o hook global engoliria o limite específico do login. Na prática custa pouco: no login (rota pública) a autenticação devolve na primeira linha e o limitador roda antes do bcrypt, e em rota protegida a recusa sem token não custa consulta ao banco.

**CORS:** `CORS_ORIGINS` separado por vírgula; **vazio = nenhuma origem cruzada**. Sem `credentials`, porque a API usa header e não cookie.

⚠️ **O CORS é registrado ANTES do `installAuth()`.** O preflight `OPTIONS` não carrega `Authorization` — é anônimo por definição —, então o hook de negação por padrão responderia 401 e o navegador reportaria "erro de CORS", apontando para o lugar errado. Inverter a ordem quebra dois testes.

### Banco: Postgres via `pg` (sem ORM)

`apps/api/src/db/pool.ts` exporta um **`Pool` singleton** do driver `pg` (e o helper `withTransaction()`), configurado só por env (ver acima). Não há ORM, query builder nem plugin Fastify no meio: os **repositórios** (`src/repositories/`) importam `pool` direto e escrevem SQL na mão — e são o único lugar do código com SQL. Restaurantes, usuários, sessões, categorias, produtos, grupos de opções, opções, horário de funcionamento, clientes e pedidos vivem no Postgres — não há mais nada em memória.

O `app.ts` fecha o pool no hook `onClose` (registrado no `buildApp()`, junto do error handler — não no `server.ts`) e o `server.ts` trata `SIGINT`/`SIGTERM` chamando `app.close()` (F26), que por sua vez dispara esse hook. A distinção importa para quem lê os testes: `buildTestApp()` + `app.close()` **encerra o pool singleton** de verdade — é por isso que cada arquivo de teste usa um único `describe` de topo (um segundo fecharia o pool que o primeiro ainda está usando). Requer **Postgres >= 13** (`gen_random_uuid()` nativo).

O schema é versionado com **`node-pg-migrate`**, em migrations de **SQL puro** dentro de `apps/api/migrations/` (`-- Up Migration` / `-- Down Migration`, controle na tabela `pgmigrations`). Dados de exemplo ficam em `src/db/seed.sql`.

🚨 **Este projeto usa soft delete: nada é apagado do banco.** Todo `DELETE` da API é um `update ... set deleted_at = now()`, e **toda** consulta filtra `deleted_at is null`. As regras completas (cascata transacional, índices parciais, como criar migration e como fazer baseline de banco existente) estão em `.claude/rules/database.md` — **leia antes de escrever qualquer SQL**.

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
- **A grade de horário é `PUT` de lista inteira** (`/opening-hours`): por isso a tela tem barra de salvar e nada sai enquanto a pessoa digita — uma hora pela metade (`18:`) viraria uma grade quebrada, e o `PUT` substitui tudo. Dia sem faixa some do corpo: é assim que ele fica fechado. A regra (dias, faixas, tradução da numeração `0 = domingo`, validação) mora em `features/settings/openingHours.ts`, sem React.
- **Interruptor salva sozinho, com volta atrás** (`useToggleRestaurantFlag`): o estado novo aparece na hora e o cache volta ao anterior se o `PATCH` falhar. Formulário (Dados da loja, produto, horário) usa a `SaveBar` de `src/ui/`.
- ⚠️ **Remover o restaurante encerra a sessão** e leva ao `/login?motivo=loja-removida`: a API marca o restaurante e as filhas, mas **não** toca no usuário nem na sessão — continuar no painel deixaria a pessoa numa casca pedindo um restaurante que já não existe. A confirmação pede o nome da loja digitado.
- **A tela de Modalidades tem o quarto interruptor de pagamento** (vale-refeição) que o handoff não desenhou: a API tem a flag, e sem ele a loja não a ligaria em lugar nenhum. E **nenhuma modalidade ligada é estado permitido**, com aviso âmbar — travar o último interruptor brigaria com quem está suspendendo as vendas.
- ⚠️ **Cada interruptor tem a sua própria instância de mutação** (`FlagRow` em `features/settings/ModalitiesPage.tsx`): no `@tanstack/query-core` 5, `mutate()` desanexa o observer da mutação anterior, e os callbacks por chamada dela (`onError`, `onSuccess`) deixam de disparar. Com os sete interruptores dividindo uma instância, a falha de um `PATCH` sobreposto a outro sumia sem mensagem nenhuma. Vale para qualquer tela com mais de um controle que salva sozinho.
- **Entrega salva os bairros ANTES do restaurante** (`features/settings/DeliveryPage.tsx`): trocar para "por bairro" antes de a lista existir faria a loja recusar entrega por um instante. A sujeira é medida contra o cache, então um `PATCH` que falha depois de um `PUT` que deu certo deixa a barra suja só no que faltou.
- ⚠️ **"Entrega grátis acima de" vazio vai como `null`, nunca 0**: zero seria "grátis acima de R$ 0", sempre grátis. É o `nullable: true` do `PATCH` da API (F12).
- **"usado em N produtos" é contado no painel** (`features/optionGroups/optionGroups.ts`), percorrendo os `optionGroupIds` de todos os produtos — provisório, até a API ter o campo calculado no SQL. A query mora sob `["products", restaurantId]`, para toda invalidação de produto refazer a contagem.
- **Confirmação que está salvando não fecha** (`src/ui/ConfirmDialog.tsx`): com `busy`, o modal ignora Esc, clique fora e o X — senão dava para fechar no meio de um `DELETE`, clicar de novo no gatilho e mandar um segundo. O gatilho da ação também fica desabilitado enquanto ela roda.

### Monorepo

Turborepo (`turbo.json`) + pnpm workspaces (`pnpm-workspace.yaml`: `apps/*` + `packages/*`). `packages/` ainda **não existe** no disco — o `pnpm-workspace.yaml` só o declara, reservado para libs compartilhadas. As tasks `dev`/`start` são `persistent` e sem cache; `build` depende de `^build` (builds das dependências primeiro).

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
