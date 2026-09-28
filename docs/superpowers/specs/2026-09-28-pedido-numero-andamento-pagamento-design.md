# Número do pedido, andamento, horário da loja e pagamento — desenho

**Data:** 2026-09-28 · **Estado:** aprovado, a implementar (branch `feat/pedido-numero-andamento-pagamento`)

## O problema

O painel está completo pelo handoff, mas quatro telas mostram menos do que o
handoff desenhou porque a API não tem o dado. A spec da parte 1 os registrou como
"pendências de backend que este desenho gera" (itens 1, 2, 4 e 7):

| O handoff desenha | O painel mostra hoje | Falta na API |
| --- | --- | --- |
| `#1042`, sequencial por loja | `#A3F9`, derivado do UUID (`lib/orderCode.ts`) | um número de pedido |
| horário real em cada etapa do Andamento, "—" no que não aconteceu | horário só em "Novo" e na etapa atual | quando o pedido entrou em cada status |
| "Aberta · fecha 23:30" no topo do rail | só "Aceitando pedidos" / "Pausada agora" | se a loja está aberta agora, e até quando |
| "Pix · pago" na linha de pagamento | só a forma de pagamento | se o pagamento aconteceu |

Fontes: o handoff (`docs/design/painel-da-loja/README.md`, rail, cartão e drawer
do pedido), a spec da parte 1 e o contrato em `apps/api/openapi.json`.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Escopo | As quatro, numa branch só, um bloco de commits por item |
| Numeração | **Contínua por loja** (`#1` … `#1042`, para sempre), como o handoff desenha. Recomeçar por dia foi descartado: a "senha do dia" não identifica o pedido sozinha, precisa da data junto, e o dia depende do fuso |
| Geração do número | **Contador na linha do restaurante**, incrementado na transação que cria o pedido |
| Registro das etapas | **Tabela de eventos** `order_status_events`, não uma coluna por status |
| Quem diz que está pago | **A loja, na mão**, em qualquer forma de pagamento. O sistema não presume nada — nem que o pix caiu, nem que o concluído foi pago |
| Loja fechada no rail | **"Fechada · abre 18:00"**, com o dia quando não é hoje; sem faixa nenhuma, "Fechada · sem horário cadastrado" |

## 1. Número do pedido

### API

- Migration: `restaurants.last_order_number integer not null default 0` e
  `orders.number integer`. A mesma migration numera os pedidos existentes por
  loja com `row_number() over (partition by restaurant_id order by created_at, id)`,
  acerta `last_order_number` com o maior número de cada loja, e só então põe
  `orders.number` como `not null`.
- Índice único **parcial** `(restaurant_id, number) where deleted_at is null`
  (D6). Pedido nunca é apagado, mas a regra de soft delete é absoluta.
- Na criação (`services/orders.ts`, `create`), dentro do `withTransaction` que já
  existe: `update restaurants set last_order_number = last_order_number + 1
  where id = $1 returning last_order_number`, e o valor vai no `insert into orders`.
  - **Sem buraco na numeração:** o incremento está na mesma transação do
    pedido; se a criação falhar depois (estoque, troco, mesa), o rollback desfaz
    o incremento junto.
  - **Custo assumido:** a linha do restaurante fica travada até o commit, então
    duas criações simultâneas da mesma loja entram em fila por alguns
    milissegundos. Lojas diferentes não disputam nada.
  - O incremento não passa por `updated_at` do restaurante: é contador interno,
    não edição de conteúdo (D10 vale para conteúdo).
- `number` sai em toda resposta de pedido: criação (incluindo a pública),
  listagem, detalhe e o acompanhamento público por token. `last_order_number`
  **não** sai em resposta nenhuma (S10).
- Teste de concorrência: N criações simultâneas na mesma loja recebem N números
  distintos e contíguos. 🚨 Com o pool aquecido (`warmPool()`), e conferindo que o
  teste **falha** sem o lock — senão não está testando nada.

### Painel

- `#1042` (`#${order.number}`) substitui `orderCode(order.id)` no cartão, no
  drawer, nas confirmações e no modo cozinha. `lib/orderCode.ts` sai.

## 2. Horário por etapa (Andamento)

### API

- Migration: `order_status_events (id, order_id, status, occurred_at, created_at,
  updated_at, deleted_at)`, com `status` no mesmo `check` dos status do pedido e
  índice parcial `(order_id, occurred_at, id) where deleted_at is null`.
- **Um ponto só de escrita:** `ordersRepository.updateStatus()` já é por onde
  todo status passa (via `transitionTo()`), e passa a inserir o evento na mesma
  transação. A criação do pedido insere o evento `pending`. Nenhuma outra linha
  do código grava evento.
- **Backfill honesto:** pedido existente ganha `pending` em `created_at` e, se o
  status atual não é `pending`, o status atual em `updated_at`. As etapas do meio
  **não** são inventadas — ficam sem horário e aparecem como "—". Estimar um
  horário para elas seria mostrar como fato o que não foi registrado.
- O **detalhe** do pedido (`GET .../orders/:orderId` do painel) ganha
  `statusHistory: [{ status, at }]`, em ordem. A listagem **não** ganha: é paginada
  e polled a cada 10 s, e nenhum cartão do kanban mostra o andamento.
- O acompanhamento público **não** ganha o histórico nesta rodada: o app do
  cliente não existe, e a decisão de quanto mostrar a ele fica com ele.

### Painel

- O Andamento mostra o horário (`HH:mm`, no fuso da loja) de cada etapa cumprida
  e da atual, e "—" nas futuras e nas cumpridas sem registro (pedidos antigos).
- Pedido encerrado: "Pedido concluído às 20:10. Não há mais ação possível." —
  texto literal do handoff, com o horário do evento `completed` (ou `cancelled`,
  "Pedido cancelado às …").

## 3. Loja aberta agora, e até quando

### API

- `GET /restaurants/:restaurantId` ganha
  `openingStatus: { isOpen: boolean, closesAt?: string, opensAt?: string }`:
  - aberta: `isOpen: true` e `closesAt`, o fim da faixa em que o instante atual
    cai (numa faixa que atravessa a meia-noite, é o fechamento na madrugada);
  - fechada: `isOpen: false` e `opensAt`, o começo da próxima faixa;
  - sem faixa nenhuma cadastrada: `isOpen: false`, sem `opensAt`.
- `isOpen` aqui é **só a grade**. A pausa manual (`acceptingOrders`) continua
  separada, como no cardápio público — a tela combina as duas.
- **A conta fica no Postgres**, em `repositories/opening-hours.ts`, ao lado do
  `isOpenNow()` e pelo mesmo motivo (banco de fusos, horário de verão): expandir
  cada faixa em instantes concretos nos próximos 8 dias
  (`generate_series` sobre as datas locais, `(data + hora) at time zone fuso`),
  tratar a faixa que atravessa a meia-noite como terminando no dia seguinte, e
  pegar a primeira fronteira depois de `now()`. Instantes em ISO (`timestamptz`).
- Só o `GET` por id calcula; `PATCH` e `POST` devolvem o restaurante sem o campo
  (o schema de resposta do `GET` é próprio, mesmo padrão do `productCount`).
- Testes: faixa normal, faixa que atravessa a meia-noite (às 01:00 de terça, a
  faixa de segunda ainda vale), dia sem faixa, loja sem grade, e a virada em fuso
  diferente de São Paulo.

### Painel

- Topo do rail, por prioridade:
  1. pausada → "Pausada agora" (como hoje);
  2. aberta → "Aberta · fecha 23:30";
  3. fechada com próxima abertura → "Fechada · abre 18:00", ou "Fechada · abre
     sex 18:00" quando não é hoje (no fuso da loja);
  4. sem horário → "Fechada · sem horário cadastrado", com link para Horário.
- O painel **formata**, não calcula: recebe instantes e os mostra no fuso da loja
  com `Intl.DateTimeFormat`. Nenhuma regra de faixa no front.
- A query do restaurante passa a se refazer a cada 60 s, para "Aberta" virar
  "Fechada" sem recarregar.

## 4. Pagamento

### API

- Migration: `orders.paid_at timestamptz` (nulável; nulo = não marcado como pago).
- Duas rotas, no estilo de `confirm`/`cancel` (ações, não `PATCH`):
  - `POST /restaurants/:restaurantId/orders/:orderId/mark-paid`
  - `POST /restaurants/:restaurantId/orders/:orderId/mark-unpaid`
- Regras (serviço, com `select ... for update` no pedido, como as transições):
  - marcar pedido **cancelado** é **409** ("pedido cancelado não recebe
    pagamento"); desmarcar vale em qualquer status, para corrigir clique errado;
  - as duas são idempotentes: marcar o que já está pago mantém o `paid_at`
    original (o primeiro registro é o que vale), desmarcar o não pago não faz nada;
  - pagamento **não** é transição de status e não passa pela máquina de status —
    é outro eixo: pedido pode ser pago antes de sair (pix) ou depois (dinheiro).
- `paidAt` sai na listagem e no detalhe do painel. **Não** sai no acompanhamento
  público nesta rodada.
- Nenhuma das duas rotas é `ownerOnly` (operação de balcão, S32).

### Painel

- Linha de pagamento: "Pix · pago" quando `paidAt` existe; o cartão do kanban
  ganha o mesmo "· pago".
- Drawer: "Marcar como pago" / "Desfazer pago", fora do rodapé de transições (não
  é mudança de status). Pedido cancelado não mostra o botão.
- Chave de query no prefixo `"orders"`, como toda ação de pedido.

## Testes

- **API** (integração, Postgres): numeração por loja e independente entre lojas;
  corrida da numeração; backfill da migration conferido num banco com pedidos;
  evento gravado em toda transição e na criação; histórico no detalhe;
  `openingStatus` nos cinco casos acima; `mark-paid`/`mark-unpaid` com 409 em
  cancelado, idempotência e escopo (S19: pedido de outra loja é 404).
- `test/authorization.test.ts` e `test/openapi.test.ts` cobrem as duas rotas novas
  sozinhos (fechadas por padrão, com `tags`/`summary`/`operationId`).
- **Painel** (Vitest + jsdom): `#1042` nos quatro lugares; Andamento com horário e
  "—"; os quatro estados do rail; marcar/desmarcar pago e o "· pago" no cartão.

## Onde a implementação diverge do handoff

| Handoff | Aqui | Por quê |
| --- | --- | --- |
| só "Aberta · fecha …" e "Pausada agora" | + "Fechada · abre …" e "Fechada · sem horário cadastrado" | o handoff não desenha a loja fora do horário |
| — | "Marcar como pago" / "Desfazer pago" no drawer | o handoff mostra "pago" mas não diz quem o registra |

As duas linhas entram na tabela de desvios da spec da parte 1; as linhas de
`#1042`, "hora só em Novo e na etapa atual" e "Pix · pago" saem de lá.

## Repo

- Três migrations (`add-order-number`, `add-order-status-events`,
  `add-order-paid-at`), cada uma criada pelo `migrate:create` (D21) e com `Down`
  que desfaz (D17). `openapi.json` regerado.
- Nenhuma dependência nova.
- `CLAUDE.md`: seções de pedidos, máquina de status e horário de funcionamento; e
  o `lib/orderCode.ts` sai da seção do painel.

## Fora de escopo, de propósito

- **Próxima abertura no cardápio público** — o cliente vai precisar ("Fechado. Abre
  amanhã às 18h"), mas o app dele ainda não existe; a função fica pronta para ser
  reaproveitada.
- **Histórico e pagamento no acompanhamento público** — decisão do app do cliente.
- **Quem marcou o pagamento** (`paid_by_user_id`) e auditoria por usuário das
  transições — nada no painel pede isso hoje.
- **Numeração por dia** — descartada acima.
- **Decidir se `confirmed` continua separado de `preparing`** (item 5 da parte 1) —
  outra conversa.
