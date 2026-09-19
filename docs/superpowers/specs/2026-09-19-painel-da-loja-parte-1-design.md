# Painel da loja, parte 1 — fundação e operação — desenho

**Data:** 2026-09-19 · **Estado:** aprovado, não implementado (branch `feat/painel-da-loja`)

## O problema

O MenuClick tem uma API completa e nenhuma tela. A loja não consegue aceitar um
pedido sem `curl`. O painel é a primeira superfície de front do monorepo, e esta
parte entrega o que a loja toca **todo dia**: entrar, destravar o e-mail, receber
e despachar pedidos, e manter o cardápio.

Fontes deste desenho:

- **Handoff de design** em `docs/design/painel-da-loja/` — `README.md`
  (tokens, 21 telas, copy final, mapa para Mantine) e `Painel da Loja.dc.html`
  (protótipo de referência, não é código de produção). Alta fidelidade: cores,
  tipografia, espaçamento, estados e **toda a copy** são finais.
- **`docs/frontend/painel-da-loja.md`** — o produto e os estados, checado contra
  a API.
- **`apps/api/openapi.json`** — o contrato.

## O painel foi fatiado em três

O handoff tem 19 telas de produto. Um spec só para todas seria grande demais para
revisar e implementar de uma vez; o corte é por frequência de uso, como o
`painel-da-loja.md` já sugeria:

| Parte | Conteúdo |
| --- | --- |
| **1 — este documento** | app, tema, shell (rail, header, pausa), acesso com bloqueio de e-mail, Pedidos (kanban + drawer + confirmações), Produtos, Produto, Seções |
| 2 | Grupos de opções, Horário, Entrega, Modalidades e pagamento, Dados da loja |
| 3 | Mesas e QR, Usuários, Resumo do dia, Modo cozinha |

O cardápio do cliente (SSR) é outro projeto, depois destes.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Dados | **API real desde o início**, via proxy do Vite |
| Lacunas entre design e API | **caso a caso**; a UI se adapta agora e a API é ajustada depois |
| Stack | Vite + React + Mantine + React Router + TanStack Query |
| Onde mora | `apps/panel` (`@menuclick/panel`) |
| Token de sessão | `localStorage`, **provisório** |
| Tipos da API | escritos à mão, espelhando o `openapi.json` |
| "Aceitar" | encadeia `confirm` + `start-preparing` no front |
| "Recusar" | terceiro texto de confirmação, próprio |
| Código curto do pedido | derivado do UUID (`#A3F9`) |
| Andamento | hora só onde a API tem o dado |
| Cadastro | o formulário ganha endereço e modalidades |
| Rail | mostra só a pausa, sem "aberta · fecha 23:30" |

## Arquitetura

### Stack e dependências

Aprovadas explicitamente, uma a uma:

- **runtime:** `react`, `react-dom`, `@mantine/core`, `@mantine/hooks`,
  `@tabler/icons-react`, `react-router`, `@tanstack/react-query`,
  `@fontsource/figtree`
- **dev:** `vite`, `@vitejs/plugin-react`, `@testing-library/react`, `jsdom`,
  `eslint-plugin-react-hooks`

Ficaram de fora de propósito: `@mantine/dates` (o intervalo usa
`<input type="date">` nativo), `@mantine/modals` e `@mantine/notifications` (o
`Modal` do core basta), msw (o `fetch` é mockado com `vi.fn`), Playwright (sem
e2e nesta parte) e qualquer lib de QR (só na parte 3).

**Por que SPA e não Next.js:** o painel está inteiro atrás de login, SEO não
importa, e com o token Bearer no navegador o servidor de SSR não teria o que
renderizar. Next faz sentido para o cardápio do cliente, não aqui.

**Por que TanStack Query:** o painel precisa de polling com a aba em segundo
plano, de uma fonte única para o header e o Resumo, e de invalidação depois de
cada ação. Sem a lib, isso seria reescrito à mão — e hook próprio de cache é onde
nasce o número que diverge entre duas telas, o defeito que o handoff aponta como
o que faz o operador deixar de confiar no painel.

### Estrutura

```
apps/panel/
  index.html
  vite.config.ts        proxy /api → http://localhost:3333
  src/
    main.tsx            providers: Mantine, Query, Router
    theme/              tokens (claro/escuro), createTheme, global.css
    api/                client, tipos, um módulo por recurso
    auth/               sessão, guardas de rota
    layout/             AppShell: Rail, Header, PauseSwitch, PauseBanner
    features/orders/    kanban, cartão, drawer, confirmações, som
    features/products/  lista, formulário, vínculo de grupos
    features/categories/
    features/access/    login, cadastro, bloqueio, verificar, esqueci, nova senha
    lib/                money, orderCode, relativeTime
```

Convenções herdadas da API: identificadores em inglês e copy em pt-BR literal do
handoff; sem `enum` (uniões `as const`); imports locais com extensão (`.ts`/`.tsx`).

### Como o painel fala com a API

- **Proxy do Vite** leva `/api/*` para `http://localhost:3333`. No dev, isso
  dispensa mexer em `CORS_ORIGINS`. Em produção a base vem de `VITE_API_URL`
  (default `/api`); como o painel será hospedado é decisão futura.
- **`src/api/client.ts`** é um wrapper de `fetch`: injeta
  `Authorization: Bearer`, e transforma o corpo de erro da API
  (`{ statusCode, error, message }`) num `ApiError` com o status. A `message` da
  API já é pt-BR escrita para quem lê, e pode ir direto para a tela.
- **Um módulo por recurso** (`auth.ts`, `orders.ts`, `products.ts`,
  `categories.ts`, `restaurant.ts`), com os tipos em `src/api/types.ts`.

### Estado de servidor

Hooks por feature sobre TanStack Query (`useOrders`, `useSummary`, ...). Toda
mutação invalida as chaves que afeta — aceitar um pedido invalida `orders` e
`summary`.

**O header ("Aceitos hoje · Faturamento · Ticket médio") e o Resumo da parte 3
leem a mesma query**: `GET /orders/summary?period=today`. Os três números saem
direto de `revenueOrderCount`, `revenueInCents` e `averageTicketInCents` — o
front não recalcula nenhum.

## Acesso

### Rotas

| Rota | Acesso | Tela |
| --- | --- | --- |
| `/login`, `/cadastro`, `/esqueci-senha` | só sem sessão; com sessão vai para `/pedidos` | Login, Cadastro, Esqueci (etapa 1) |
| `/recuperar-senha?token=` | pública | Nova senha — o link do e-mail, igual ao default de `PASSWORD_RESET_URL` |
| `/verificar-email?token=` | pública | faz o `POST /auth/verify-email` ao abrir — igual ao default de `EMAIL_VERIFICATION_URL` |
| `/confirme-seu-email` | sessão, e-mail não verificado | bloqueio, sem rail e sem header |
| `/pedidos`, `/pedidos/:orderId` | sessão verificada | kanban; o drawer é rota filha, então o link do pedido é compartilhável |
| `/produtos`, `/produtos/novo`, `/produtos/:id`, `/secoes` | sessão verificada | cardápio |

O rail mostra **só o que existe**. Os itens das partes 2 e 3 entram quando forem
feitos; nada de link para tela vazia.

### Guardas

- **`RequireSession`** — sem token, ou com `expiresAt` no passado, vai para
  `/login`.
- **`RequireVerified`** — `GET /auth/me` com `emailVerified: false` vai para
  `/confirme-seu-email`. Quem decide é o `/auth/me`, **nunca** a listagem
  `GET /restaurants`, que responde 200 para a loja bloqueada (incoerência
  documentada da API). Enquanto o `/auth/me` carrega, tela neutra — sem skeleton
  pulsante.
- **401 em qualquer resposta** limpa a sessão e leva a `/login` mostrando o
  estado "Sua sessão expirou" com a copy do design.

### Fluxos

**Cadastro.** `POST /auth/register` responde 201 **sem token**. O front faz em
seguida o `POST /auth/login` com as mesmas credenciais e leva ao bloqueio.

O register exige endereço e as três modalidades, que o design não pede. O card
ganha uma terceira seção, **Endereço e modalidades**. Defaults: Retirada e Salão
ligados, **Entrega desligada** — a loja nova nasce com `deliveryFeeMode = fixed`
e taxa R$ 0, então Entrega ligada no cadastro seria entregar de graça por
acidente. A loja liga a entrega na tela de Entrega (parte 2), já configurando o
frete. O slug não aparece: é derivado do nome pela API.

**Bloqueio (`/confirme-seu-email`).**

- "Não recebi, reenviar" → `POST /auth/resend-verification`. 202 mostra a
  mensagem neutra. **429 trava o botão** em "Reenviar em 0:38", contando a partir
  do header `Retry-After`, com o aviso âmbar do design.
- "Verificar de novo" busca o `/auth/me` outra vez.
- "Sair da conta" → `POST /auth/logout` e limpa a sessão.
- "Falar com o suporte ↗" aponta para `VITE_SUPPORT_URL`; sem a variável, o botão
  não aparece.

**Link de verificação (`/verificar-email?token=`).** Sucesso leva a `/pedidos`
se houver sessão, ou a `/login` com a mensagem de e-mail confirmado. 400 mostra
que o link expirou ou já foi usado e, com sessão, oferece o reenvio.

**Nova senha (`/recuperar-senha?token=`).** A API não devolve sessão no reset —
de propósito, ver S30 — e a página só conhece o token, não o e-mail. Por isso o
CTA **"Salvar e entrar" do design vira "Salvar nova senha"**, e o sucesso leva a
`/login` com aviso. 400 mostra a faixa âmbar "Link expirado ou já usado".

**Esqueci a senha.** `POST /auth/forgot-password` sempre mostra a mesma resposta,
exista a conta ou não.

**Login.** 401 mostra a mensagem da API; 429 mostra "aguarde um instante".

## Pedidos

### Dados e atualização

- **A lista vem de `GET /orders` com os filtros da tela e `limit=100`. Se o
  `total` passar de 100, o front pagina até trazer tudo.** Com a ordem "mais
  recentes" num dia cheio, um pedido aberto antigo cairia para fora da primeira
  página e sumiria do kanban — o pior defeito possível nesta tela.
- **Polling a cada 10 s, inclusive com a aba em segundo plano**
  (`refetchIntervalInBackground: true`). O painel passa o dia atrás de outras
  janelas, e o som do pedido novo precisa tocar mesmo assim.
- **Uma requisição de lista por ciclo, não uma por status.** Orçamento: ~12
  req/min por aparelho num dia normal (lista + summary). Dois aparelhos da loja
  atrás do mesmo IP ficam bem abaixo do teto global de 100/min.
- **Filtros na URL** (`?period=`, `?from=&to=`, `?tableId=`, `?sort=`), para
  sobreviverem ao recarregar. Período e intervalo são **mutuamente exclusivos na
  própria UI** — escolher um desliga o outro, com a nota do design —, porque a
  API responde 400 quando recebe os dois.
- **O filtro de mesa só aparece se a loja tem mesas** (`GET /tables`).

### Colunas

| Coluna | Status |
| --- | --- |
| Novos | `pending` |
| Em preparo | `confirmed`, `preparing` |
| Prontos | `out_for_delivery`, `ready_for_pickup` |
| Finalizados | `completed`, `cancelled` |

### Pedido novo se anuncia sozinho

Um `pending` que o front ainda não tinha visto (depois da primeira carga)
dispara: um bipe por Web Audio (sem arquivo de som), um contador no título da aba
(`(2) Pedidos`) e o contador âmbar no rail. O navegador só libera áudio depois de
um gesto do usuário; se o `AudioContext` estiver suspenso, aparece um "Ativar
som" discreto.

### Estados

- **Sem internet** — evento `offline` ou falha de rede: banner com a copy do
  design, e **Aceitar e Despachar ficam desabilitados** até a conexão voltar.
- **Estoque acabou ao aceitar** — 409 no `confirm`: o título do design, a
  mensagem da API como corpo (`Estoque insuficiente de "Pizza Grande": 3
  pedidos, 2 disponíveis`), e os CTAs "Repor estoque" (vai para Produtos) e
  "Recusar pedido".
- **Entrega por bairro sem bairro nenhum** — alerta persistente no topo quando o
  modo é `neighborhood`, a entrega está ligada e `GET /delivery-neighborhoods`
  volta vazio. O botão que leva à tela de Entrega só aparece quando a parte 2
  existir.
- **Nenhum pedido ainda hoje** — a copy do design.

### Drawer (`/pedidos/:orderId`)

472 px, **sem overlay**: o kanban continua legível e clicável ao lado, de
propósito. Busca o detalhe (`GET /orders/:orderId`), com polling enquanto aberto.

- **Cabeçalho** — `#A3F9`, pill do tipo, "há 2 min", nome e telefone. A terceira
  linha depende da modalidade: o endereço na entrega; "Mesa 7" no salão com mesa;
  **"Salão · sem mesa"** no salão com `table: null` (adesivo antigo, sem hash);
  "Retirada no balcão" na retirada.
- **Itens** — quantidade × nome, com o valor da linha em
  `unitPriceInCents × quantity`; as opções agrupadas por `groupName`
  ("Sabores: Calabresa, Portuguesa").
- **Totais** — "Itens" = total − frete; o frete em três formas distintas
  (`R$ 9,00` / `Grátis` / `A combinar`) e ausente fora de entrega; Total em
  24 px.
- **Pagamento** — "Pix", "Cartão na entrega", "Vale-refeição",
  "Dinheiro · troco para R$ 50,00", ou "Dinheiro · sem troco" quando
  `changeForInCents` é nulo (o cliente tem o valor exato).
- **Andamento** — as etapas do handoff por modalidade (entrega: Novo · Em
  preparo · Saiu para entrega · Concluído; retirada troca a terceira por Pronto
  para retirada; salão não tem a terceira). "Novo" leva o `createdAt`, a etapa
  atual leva o `updatedAt`, as cumpridas ficam sem hora e as futuras mostram
  "—". `confirmed` e `preparing` são ambos a etapa "Em preparo", coerente com o
  aceite encadeado.

### Ações

A regra mora num módulo só, `orderActions.ts`, usado pelo cartão e pelo drawer.

| Status | Ação principal | Cancelamento |
| --- | --- | --- |
| `pending` | **Aceitar** (`confirm` + `start-preparing`) | **Recusar** (texto próprio) |
| `confirmed` | Começar preparo (rede do aceite) | devolve estoque |
| `preparing` | Saiu para entrega / Pronto para retirada / Concluir (salão) | devolve estoque |
| `out_for_delivery`, `ready_for_pickup` | Concluir | **não devolve** |
| `completed`, `cancelled` | nenhuma — caixa "Pedido concluído às 20:10. Não há mais ação possível." (ou a versão de cancelado) | — |

- **Aceitar encadeia duas chamadas.** O design tem um clique entre Novo e Em
  preparo; a API tem duas etapas. Se o `start-preparing` falhar, o pedido fica
  `confirmed` na coluna Em preparo com o botão "Começar preparo" como rede.
- **Três textos de cancelamento**, porque dizer algo falso sobre o estoque é o
  erro mais caro do fluxo:
  - **Recusar** (`pending`, estoque nunca baixado): título "Recusar o pedido
    #A3F9?", corpo "O pedido sai da lista. O estoque não tinha sido baixado,
    então nada muda nele.", CTA "Recusar pedido". Não existe no handoff; o
    handoff reaproveitava "as unidades voltam para o estoque", que é falso para
    um pedido que nunca baixou nada.
  - **Antes de pronto** (`confirmed`, `preparing`): a copy literal do design,
    CTA "Cancelar e devolver estoque".
  - **Depois de pronto** (`out_for_delivery`, `ready_for_pickup`): a copy
    literal do design, com o aviso "O estoque NÃO será devolvido." e o CTA
    "Cancelar sem devolver".
- Aceitar e todo cancelamento passam pelo modal de confirmação com a copy
  literal do handoff.
- O botão fica desabilitado enquanto a mutação corre, contra clique duplo.
- 409 numa transição — outro aparelho já mexeu no pedido — mostra a mensagem da
  API e recarrega o pedido.
- Os botões do cartão fazem `stopPropagation`, para não abrir o drawer ao
  aceitar.

## Cardápio

### Produtos (`/produtos`)

- `GET /products?search=&categoryId=&limit=20&offset=`; busca com debounce de
  300 ms. Busca, chip e página ficam na URL.
- Chips "Todas" + um por seção. **Sem chip "Sem categoria"**: a API não filtra
  por `categoryId` nulo. Produto sem seção mostra "—" na coluna.
- Estoque em `danger` quando 0 ("esgotado") e em `warn` até 5. O status
  "Disponível"/"Esgotado" sai de `stock > 0`, a mesma regra do `available`
  público.
- Sem seção e sem produto: o estado "Seu cardápio está vazio", com CTA para
  Seções.

### Produto (`/produtos/novo`, `/produtos/:id`)

- Criar = `POST` e depois `PUT /products/:id/option-groups`; editar = `PATCH` e
  depois o mesmo `PUT`. Se a segunda chamada falhar, o produto já está salvo, e o
  erro diz que faltou salvar os grupos.
- **Preço em reais é convertido para centavos por string, sem passar por
  float.**
- `photoUrl` validado como URL, com a nota de ausência de upload.
- Grupos de opções: escolha entre os que a loja já tem (`GET /option-groups`),
  ordem por ↑↓, enviada como a ordem do array no `PUT`. Criar grupo não é aqui
  (é a parte 2).
- **O exemplo em reais de cada regra de preço é o texto fixo do handoff**
  (Margherita R$ 62 + Calabresa R$ 72 …), não um cálculo com as opções reais —
  assim o front não duplica a regra de `unitPrice()` da API.
- Barra de salvamento fixa, com "Alterações não salvas" quando o formulário foi
  alterado.

### Seções (`/secoes`)

- Lista por `position`. A contagem de produtos sai de um
  `GET /products?categoryId=X&limit=1` por seção, lendo o `total`.
- **↑↓ renumera a lista inteira e manda `PATCH` só para quem mudou.** As
  posições podem ter buraco ou empate — o empate é desfeito pelo nome —, e
  trocar só as duas posições com empate não moveria nada. No caso comum são dois
  `PATCH`.
- Adicionar confere duplicata ignorando maiúsculas antes de enviar, com a copy
  do design; o 409 da API fica como rede.
- Renomear inline. Remover com o modal "Os produtos dela não são apagados…".

## Tema

- **Os tokens do handoff são a fonte**: variáveis CSS em `theme/global.css`, um
  bloco para o claro e outro para o escuro. O Mantine já põe
  `data-mantine-color-scheme` no `<html>`, que é onde o handoff exige o atributo
  de tema (senão `body` e overscroll ficam claros).
- **`createTheme`**: `primaryColor` oliva com `#4A6B3A` como shade 6 no claro e
  `#93B375` no escuro; Figtree via `@fontsource` (400/500/600/700); raio 6 em
  controles e 10 em painéis; **todas as sombras zeradas**; **transição 0 como
  default de Drawer, Modal e Menu** — o design não admite movimento além da
  chegada de pedido; `Skeleton` sem animação; classe utilitária `.n` com
  `font-variant-numeric: tabular-nums` em todo número.
- **O rodapé do rail vira um menu** com "Tema escuro" e **"Sair"**. É adição ao
  design, que não tem logout em lugar nenhum. O tema é guardado pelo gerenciador
  de esquema de cor do Mantine em `localStorage`. A densidade compacta fica para
  depois.

## Testes

Vitest + Testing Library + jsdom, com `fetch` mockado por `vi.fn`.

**Unitários da lógica pura:** `money` (reais ↔ centavos por string),
`orderCode`, `orderActions` (status × modalidade → ação e texto de
cancelamento), colunas do kanban, renumeração de seções, paginação até o fim,
detecção de pedido novo.

**Componentes, onde o erro custa caro:**

- o texto do modal de cancelamento nos três casos — recusar, devolve, não
  devolve;
- o aceite encadeado com falha na segunda chamada, deixando o pedido com
  "Começar preparo";
- as guardas: não verificado vai para o bloqueio, 401 vai para o login;
- a contagem regressiva do 429 no reenvio.

**Sem e2e nesta parte.** A conferência manual é contra a API real com o seed
(`pnpm dev` sobe os dois apps).

## Monorepo

- `apps/panel/package.json`: `dev` (`vite`, porta 5173), `build`
  (`tsc --noEmit && vite build`), `test` (`vitest run`). **Sem `start`**: em
  produção o painel é um punhado de arquivos estáticos, e onde hospedá-los é
  decisão futura.
- `typescript@^7`, igual à API. O lint da raiz já cobre `.tsx`; ganha o
  `eslint-plugin-react-hooks`.
- `turbo.json` ganha `outputs: ["dist/**"]` no `build`.
- Variáveis: `VITE_API_URL` (default `/api`) e `VITE_SUPPORT_URL`.
- CI ganha type-check, build e teste do painel.
- `CLAUDE.md` ganha a seção do painel, e deixa de dizer que "hoje existe só a
  API".

⚠️ `MENU_BASE_URL` tem default `http://localhost:5173`, a mesma porta do painel.
Até o cardápio do cliente existir, o QR de uma mesa abriria o painel. Mesas só
entram na parte 3, e a separação das origens é pendência já registrada.

## Onde este desenho diverge do handoff

| Handoff | Aqui | Por quê |
| --- | --- | --- |
| `#1042` sequencial | `#A3F9`, derivado do UUID | a API não tem número de pedido |
| hora real em toda etapa do Andamento | hora só em "Novo" e na etapa atual | a API só tem `createdAt` e `updatedAt` |
| "Pix · pago" | só a forma de pagamento | a API não registra se o pagamento aconteceu |
| "Borda: Catupiry +R$ 8,00" | sem valor por opção | o pedido não guarda a regra do grupo; em "mais caro" e "média" o "+R$" mentiria |
| cancelar pedido novo com o texto "as unidades voltam" | terceiro texto, "Recusar" | pedido `pending` nunca baixou estoque |
| cadastro com nome e tipo de cozinha | + endereço e modalidades | o register exige |
| "Salvar e entrar" | "Salvar nova senha" | o reset não devolve sessão e a página não sabe o e-mail |
| "Aberta · fecha 23:30" no rail | só "Aceitando pedidos" / "Pausada agora" | a rota do restaurante não expõe `isOpen`, e calcular no front duplicaria regra que mora no Postgres |
| sem logout | "Sair" no menu do rodapé do rail | sem ele, só limpando o navegador |

## Pendências de backend que este desenho gera

Nenhuma bloqueia a parte 1; cada uma deixa a UI mais fiel ao handoff quando
entrar:

1. número sequencial do pedido por loja;
2. horário por transição de status (colunas ou tabela de eventos);
3. `productCount` na categoria (e "usado em N produtos" no grupo, parte 2);
4. `isOpen` e o próximo fechamento na resposta do restaurante;
5. decidir se `confirmed` segue existindo como etapa separada de `preparing`;
6. afrouxar o register (endereço opcional, modalidades com default), se o
   cadastro curto do design for preferido;
7. status de pagamento, se "pago" for virar informação de verdade.

E as oito pendências de integração levantadas antes deste desenho (origens dos
apps, SSR × rate limit, prévia de preço, push para o painel, CORS e token,
paginação do cardápio, tipos gerados, build) continuam valendo — o painel toca
as de push (resolvido com polling) e de CORS/token (resolvido provisoriamente com
proxy e `localStorage`).

## Fora de escopo, de propósito

- As telas das partes 2 e 3, e as rotas delas no rail.
- **Remover produto**: a API tem a rota, mas o handoff não desenha o fluxo, e ele
  pede o desenho antes de improvisar. Até lá, produto sai do ar zerando o
  estoque.
- Densidade compacta, Modo cozinha (parte 3), e o grupo "Protótipo" do rail
  (Estados, Direção visual), que o handoff manda não implementar.
- Tudo que a API não oferece: upload de imagem, impressão de comanda, relatório
  histórico, conta por mesa.
