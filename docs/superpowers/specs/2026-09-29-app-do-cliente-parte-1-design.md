# App do cliente, parte 1 — base, cardápio e o pedido do salão — desenho

**Data:** 2026-09-29 · **Estado:** implementado (branch `feat/app-cliente-parte-1`)

## O problema

O painel da loja está completo, mas o lado de quem come não existe. Hoje o QR
code colado na mesa aponta para `MENU_BASE_URL`, que por default é o próprio
painel (`:5173`): quem escaneia abre uma tela de login. Pedido só entra pela
API na mão ou pelo `/docs`.

Este documento desenha o **app do cliente** inteiro no nível de arquitetura, e
detalha a **parte 1**: a base do app, o cardápio, o produto, o carrinho e o
pedido **do salão** (QR da mesa). A **parte 2** — entrega, retirada e
acompanhamento — ganha spec própria, e as duas vão ao ar juntas.

Fontes: o handoff em `docs/design/app-do-cliente/` (cópia de
`~/Downloads/Pedidos web mobile-first`: o protótipo navegável
`App do Cliente.dc.html`, o board `Estados e Design System.dc.html` e as duas
direções visuais), o documento de produto `docs/frontend/app-do-cliente.md`, o
`PRODUCT.md` e o contrato em `apps/api/openapi.json`.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Fatiamento | **Duas partes.** 1: base + cardápio + produto + carrinho + pedido do **salão** + estados de loja. 2: entrega, retirada, acompanhamento |
| Direção visual | **B · Balcão** (Sora, branco, azul elétrico), a do protótipo e do design system. A direção A · Brasa fica descartada |
| Stack | **Next.js (App Router)**, TypeScript, **Tailwind** |
| Renderização | **ISR só no cardápio** (revalida a cada 60 s); mesa, horário ao vivo, carrinho, cotação, pedido e acompanhamento no navegador |
| Infra | Tudo precisa caber em **plano gratuito** (front na Vercel Hobby; API e Postgres em free tier). A escolha exata de hospedagem é uma etapa própria, antes de subir |
| Preço ao vivo | **`packages/pricing`**: o `unitPrice()` sai da API para um pacote que a API e o app importam |
| API nova | Horário no cardápio público, capa e cor da marca, observação no item (parte 1); complemento do endereço, motivo do cancelamento e previsão (parte 2) |
| "Em breve" do handoff | **Implementado de verdade**: observação (parte 1) e complemento (parte 2) |

## Arquitetura

### O app: `apps/menu`

Next.js com App Router, TypeScript e Tailwind. Mesmas convenções do monorepo:
identificadores em inglês, textos em pt-BR, `pnpm --filter @menuclick/menu dev`
na porta **3000**.

- **Estilo:** os tokens da direção Balcão viram variáveis CSS lidas pelo tema do
  Tailwind (seção "Design system"). A cor de ação é a única variável que a loja
  troca.
- **Dados:** `fetch` puro, sem TanStack Query — o app tem pouca leitura, e o que
  precisa de polling (o acompanhamento, na parte 2) faz à mão.
- **Testes:** Vitest + Testing Library + jsdom, como no painel. Regra de negócio
  mora em módulos puros; a página de servidor só busca e entrega a um
  componente testável.

### O pacote: `packages/pricing`

O primeiro pacote do monorepo (`pnpm-workspace.yaml` já declara `packages/*`).
Carrega o `unitPrice()` e a aritmética de dinheiro que hoje moram em
`apps/api/src/domain/option.ts` — as três regras (`sum`, `highest`, `average`),
a fração exata da média e o arredondamento meio-para-cima numa vez só.

- ⚠️ **TypeScript só com sintaxe "apagável"** e imports com extensão `.ts`: a API
  roda `.ts` direto no Node (type stripping), e é ela que importa o pacote.
- O Next compila o pacote com `transpilePackages`.
- A API passa a importar de lá; os testes de preço que existem continuam valendo
  e passam a cobrir o pacote. **A criação do pedido continua recalculando no
  servidor** — o preço da tela informa, a criação decide.

### Origens e rotas

**Origem própria para o app** (`:3000` no dev), separada do painel.
`MENU_BASE_URL` passa a apontar para ela — é o que faz o QR impresso abrir o
cardápio, e o que impede um slug de colidir com rota do painel. A origem entra
em `CORS_ORIGINS` da API.

| Rota | O que é | Parte |
| --- | --- | --- |
| `/:slug` | cardápio pelo link | 1 (só navegar), 2 (pedir) |
| `/:slug?mesa=<hash>` | cardápio da mesa | 1 |
| `/:slug/pedido/:orderId?t=<token>` | acompanhamento | 2 |

O pedido mora **debaixo do slug** de propósito: uma rota `/pedido/…` no topo
colidiria com uma loja cujo slug fosse `pedido`.

### Renderização

- **Servidor, com revalidação de 60 s:** loja, seções, produtos e grupos de
  opções (`GET /menu/:slug` e `GET /menu/:slug/products`). A busca percorre as
  páginas até o fim (o teto é 100 seções por página; o cardápio é paginado por
  seção).
- **Navegador:** a resolução da mesa, o horário ao vivo (`GET /menu/:slug` de
  novo, sem cache), o carrinho, a criação do pedido e — na parte 2 — cotação e
  acompanhamento. É o que impede o SSR de concentrar o rate limit de todos os
  clientes num IP só (100 req/min por IP na API).
- **Preço visto com até 60 s de atraso** é custo aceito: ninguém paga o preço da
  tela, a criação do pedido recalcula no servidor.
- Com a API num plano gratuito que "dorme", a página em cache continua saindo
  na hora enquanto a API acorda — é a razão prática do ISR, além da primeira
  tela rápida no 4G e da prévia do link no WhatsApp.

### Carrinho

`localStorage`, por slug **e** por mesa (`cart:<slug>:<hash|link>`), e sobrevive
a recarregar. Não guarda segredo nenhum. Leitura e escrita dentro de
`try/catch`: aba anônima ou armazenamento bloqueado viram carrinho só em
memória, nunca um erro.

## Mudanças na API — parte 1

Cada item: migration própria (quando há coluna), `schema.response`,
`openapi.json` regerado e teste de integração.

### 1. Horário no cardápio público

`GET /menu/:slug` ganha `closesAt` e `opensAt` ao lado de `isOpen`, pela mesma
`findOpeningStatus()` que o painel usa (com a fusão de faixas encostadas).
`openingHours` já vem na resposta: a tela monta "Aberto até 23h", "Fechado.
Abre amanhã às 18h" e a grade da semana.

- **`isOpen` do cardápio continua sendo grade E pausa** (é o que já existe em
  `services/menu.ts`), e `acceptingOrders` continua separado.
- `closesAt`/`opensAt` falam **só da grade** (é o `openingStatus`). A tela decide
  pela ordem: pausada (`acceptingOrders: false`) mostra o estado de pausa e
  ignora os horários; aberta mostra "Aberto até" com `closesAt` (ausente = aberta
  direto, só "Aberto agora"); fechada mostra "Abre …" com `opensAt` (ausente =
  sem grade, só "Fechado agora").
- `isOpenNow()` sai desta rota: a mesma `findOpeningStatus()` responde o `isOpen`
  da grade, e há teste de que as duas concordam.

- **O fuso da loja (`timezone`) passa a sair no cardápio público.** Até aqui ele
  ficava de fora por S10 (nada sai sem decisão); sem ele o app diria "23h" no
  fuso do celular, não no da loja. Fuso não é dado sensível: é a decisão
  deliberada que a S10 pede, nos três lugares (`Pick`, mapper, `schema.response`).

### 2. Capa e cor da marca

- `restaurants.cover_url` e `restaurants.brand_color`, nuláveis, editáveis por
  `PATCH` (com `nullable: true`, F12 — `null` tira).
- Saem no cardápio público: entram no `Pick` de `MenuRestaurant`, no
  `toMenuRestaurant()` e no `schema.response` da rota, os três (S10).
- `brand_color` é `#RRGGBB`. ⚠️ **A API recusa com 400 a cor cujo contraste com
  o branco fica abaixo de 4.5:1** (WCAG AA): o texto do botão de ação é branco,
  e uma loja amarela deixaria "Adicionar ao carrinho" ilegível. A conta de
  contraste (luminância relativa) mora no domínio, testada à parte.
- Painel: Dados da loja ganha "Capa (URL)" e "Cor da marca", esta com prévia do
  botão e a mensagem da API quando recusada.

### 3. Observação no item

- `order_items.note text`, nulável, até **140** caracteres, congelada como nome
  e preço.
- ⚠️ **Entra na chave de fusão** (`chaveDeFusao()` em `services/orders.ts`): o
  mesmo produto com as mesmas opções e observações diferentes são linhas
  diferentes. "Sem cebola" e "com cebola" não podem virar "2×".
- Sai no detalhe do painel, no modo cozinha e no acompanhamento público.

## Mudanças na API — parte 2 (contrato; detalhe na spec da parte 2)

- **Complemento do endereço:** `orders.complement`, opcional, congelado com o
  endereço.
- **Motivo do cancelamento:** `POST .../cancel` aceita `{ reason }` opcional (até
  200 caracteres); o painel pede ao cancelar; o acompanhamento mostra. Sem
  motivo, texto genérico.
- **Previsão:** a loja configura tempo de preparo (retirada) e faixa de entrega
  (minutos); o acompanhamento devolve instantes previstos a partir do evento
  `confirmed` do histórico. Sem configuração, sem previsão — a tela não inventa.

## Telas da parte 1

A copy do protótipo é **literal**; desvios na tabela "Onde a implementação
diverge do handoff".

### Cardápio (`/:slug`)

- **Topo:** capa (bloco reservado quando não há), logo, nome, tipo de cozinha.
- **Chips:** "Aberto até 23h" / "Fechado agora". "Pedido mínimo R$ 30" e "Entrega
  grátis acima de R$ 50" **só fora do salão** — as duas regras valem só na
  entrega.
- **Mesa** (`?mesa=`): faixa fixa no topo, "Mesa 7 · Pedido no salão",
  resolvida no navegador por `GET /menu/:slug/table/:hash`.
- **Busca** "Buscar no cardápio": filtra no aparelho o que já veio (a API não
  tem busca pública, de propósito).
- **Seções:** abas sublinhadas fixas no topo, rolando até a seção.
- **Grade de 2 cards** com foto no topo (bloco reservado sem foto), nome,
  descrição e preço.
  - Indisponível: apagado, "Indisponível hoje", não abre.
  - Com grupo obrigatório: "a partir de" + o menor preço possível, calculado
    pelo `packages/pricing` (escolhendo as opções mais baratas até o mínimo de
    cada grupo obrigatório).
- **Barra do carrinho** na faixa inferior: contador, "Ver carrinho", subtotal.

### Produto

- Foto, nome, descrição, preço base.
- **Grupos:** nome, "Obrigatório"/"Opcional" (ou a nota do grupo), contador
  ("1 de 2" no obrigatório, "0/3" no opcional). Opções com "+ R$ 6,00" em
  `sum`; em `highest`, a nota "Cobramos o sabor mais caro" e as opções como
  "até + R$ 45,00". Grupo de uma escolha troca a seleção ao tocar outra.
- **Observação** "ex.: sem cebola", até 140 caracteres.
- Seletor de quantidade (mínimo 1) e **"Total do item"** ao vivo.
- **Botão travado diz o motivo**: "Escolha 2 sabores" — nunca só apagado.

### Carrinho

- Linhas com opções ("Calabresa · Borda Catupiry" / "Sem complementos"),
  observação, seletor de quantidade (zero remove) e total da linha.
- Mesma fusão da API: mesmo produto + mesmas opções + mesma observação vira uma
  linha só, com quantidade somada.
- "+ Adicionar mais itens", subtotal, e o cabeçalho diz o contexto ("Mesa 7").
- Carrinho vazio: "Carrinho vazio · Volte ao cardápio e escolha o primeiro
  item." com "Ver cardápio".
- No salão **não há pedido mínimo**.

### Finalizar — salão (passo único)

- "Quem está pedindo?" — nome e telefone (telefone com ao menos 10 dígitos),
  com "Sem cadastro. Só o nome e o telefone para a loja te achar."
- "Como você paga?" — "Dinheiro no caixa", "Cartão no caixa", "Pix", **filtrados
  pelo `paymentMethods` da loja**, mapeados para `cash`, `card_on_delivery`,
  `pix`. Nota: "O pagamento é no caixa, na hora de sair. Você pode pedir mais
  coisas antes disso." **Sem troco** no salão: a pessoa paga no caixa.
- Resumo (itens, total) e o botão **"Enviar para a cozinha"**, que trava dizendo
  o que falta ("Informe seu nome", "Informe um telefone válido", "Escolha a
  forma de pagamento").
- Envio: `POST /restaurants/:restaurantId/orders` com `type: "dine_in"`,
  `tableHash` (quando a mesa resolveu), itens com opções e observação.

### Pedido enviado — salão

"Pedido enviado para a cozinha" · "É só aguardar na Mesa 7. A comida chega até
você." (sem mesa: "É só aguardar. A comida chega até você."), o resumo, e
"Voltar ao cardápio". **Sem acompanhamento** — salão não recebe `trackingToken`.
O carrinho é limpo.

### Sem mesa, na parte 1

`/:slug` sem `?mesa=` navega no cardápio e abre produtos, sem adicionar ao
carrinho: o pedido pelo link depende da escolha entre entrega e retirada, que é
a parte 2. As duas partes vão ao ar juntas; ninguém vê esse meio-termo.

## Estados (do board do handoff)

| Estado | O que a tela faz |
| --- | --- |
| Carregando | skeleton com a grade real; foto progressiva no bloco reservado |
| Fora do horário | "Fechado. Abre amanhã às 18h" + a grade da semana; cardápio visível, sem adicionar |
| Loja pausou | "A loja não está aceitando pedidos no momento" · "Pode ser uma pausa curta. Vale tentar de novo em alguns minutos." Sem prometer hora |
| Mesa não resolveu | "Não reconhecemos esta mesa. Você pode pedir normalmente — a loja vai confirmar sua mesa." Segue sem mesa; nunca tela de erro |
| Loja não existe | "Este link não existe mais" · "Confira o endereço com o restaurante ou escaneie o QR code da mesa outra vez." Resposta HTTP 404 |
| Cardápio vazio | "Cardápio ainda não publicado" · "A loja está montando os pratos. Volte em breve." |
| Opção obrigatória faltando | botão travado com o que falta |
| Erro ao enviar | 409 (fechou/pausou no meio) mostra a mensagem da API; 400 de carrinho desatualizado avisa e manda ao produto; sem rede, mantém o carrinho e oferece tentar de novo |

## Design system (direção Balcão)

| Token | Valor |
| --- | --- |
| Ação (temável) | `#1E5AE8` (hover `#1442AE`) |
| Tinta | `#0B0D12` · `#5C6474` · `#8B93A5` |
| Papel | `#FFFFFF` · `#F4F6FA` · `#ECEFF5` |
| Sucesso | `#0B7A48` |
| Atenção | `#FFF4DB` / `#7A4E00` |
| Erro | `#A62B21` |
| Tipografia | Sora — display 26/600/−3%, título 19/600, ação 16/600, corpo 15/400, apoio 13/400, rótulo 13/600 caixa alta |
| Espaço | escala 4 · 8 · 12 · 16 · 24 · 32; margem lateral sempre 16 |
| Raio | chip 5, campo 10, card 12 |

- **Temável:** a loja troca logo, capa e a cor de ação. Tinta, papel e
  semânticas ficam fixas — é o que garante o contraste AA.
- Alvo de toque mínimo **44 px**; toda ação primária mora na **faixa inferior**,
  no alcance do polegar.
- Fonte Sora auto-hospedada pelo `next/font` (sem requisição ao Google no
  navegador do cliente).
- Acessibilidade: **WCAG 2.2 AA** (`PRODUCT.md`), foco visível em todo controle,
  rótulos em todo campo.

## Testes

- **`packages/pricing`:** os testes de preço atuais migram para o pacote; a
  suíte de integração da API prova que a extração não mudou nada.
- **API** (integração, Postgres): `closesAt`/`opensAt` no cardápio; `cover_url` e
  `brand_color` no `PATCH` (inclusive `null`) e no cardápio; a trava de
  contraste (cor clara recusada, escura aceita); `note` no pedido, na fusão (duas
  observações = duas linhas) e no acompanhamento.
- **App, unidade (puro):** carrinho (adicionar, fundir, remover no zero,
  persistir), "a partir de", o que falta escolher, mapeamento de pagamento do
  salão, textos de horário ("Aberto até 23h", "Abre amanhã às 18h").
- **App, telas** (Testing Library, `fetch` simulado): cardápio em cada estado;
  produto travado e liberado; carrinho; envio no salão com sucesso e com cada
  erro.
- **Fim a fim no navegador**, em 390 px: escanear a mesa, montar o carrinho,
  enviar, ver o pedido chegar no kanban do painel com a mesa e a observação.
- `pnpm lint`, `pnpm build` e as suítes dos três apps no CI.

## Onde a implementação diverge do handoff

| Handoff | Aqui | Por quê |
| --- | --- | --- |
| "Pedido mínimo" em todo modo, bloqueando o carrinho | só fora do salão | o mínimo vale só em `delivery` na API — recusar um café no balcão só perderia venda |
| Troco no dinheiro também no salão | sem troco no salão | a pessoa paga no caixa ao sair |
| "Observação" e "Complemento" com selo "em breve" | campos ativos | implementados na API |
| `/pedido/8F2K-91DA` (código curto) | link longo com o `trackingToken` (parte 2) | o token é a credencial (S27); código curto seria segredo adivinhável |

## Repo

- `apps/menu` (Next.js), `packages/pricing`; `turbo.json` já orquestra
  `apps/*` e `packages/*`.
- Dependências novas: `next`, `react`, `react-dom`, `tailwindcss` e o que o
  Tailwind exige no build; Vitest/Testing Library já são do monorepo. Conferir
  scripts de instalação contra `allowBuilds` do `pnpm-workspace.yaml`.
- CI (`.github/workflows/ci.yml`): lint, build e testes passam a incluir
  `apps/menu` e `packages/pricing`.
- `CLAUDE.md` ganha a seção do app do cliente; `MENU_BASE_URL` e `CORS_ORIGINS`
  documentados com a nova origem; o `.env.example` da API atualizado.

## Fora de escopo, de propósito

- **Hospedagem e deploy** — etapa própria, com a restrição de caber em plano
  gratuito.
- **Pagamento online, conta do cliente, histórico de pedidos** — a API não tem,
  por decisão (`docs/frontend/app-do-cliente.md`).
- **Direção A · Brasa.**
- **Busca no servidor** — o cardápio vem inteiro; filtrar no aparelho basta.
- **Parte 2 inteira** — entrega, retirada, cotação de frete no app,
  acompanhamento, complemento, motivo do cancelamento e previsão ganham spec
  própria.
