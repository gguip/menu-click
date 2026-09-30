# App do cliente, parte 2 — entrega, retirada e acompanhamento — desenho

**Data:** 2026-09-30 · **Estado:** aprovado, a implementar (branch `feat/app-cliente-parte-2`)

## O problema

A parte 1 (PR #27) pôs no ar o app do cliente para quem está **no salão**: o QR
da mesa abre o cardápio, e o pedido vai para a cozinha. Quem abre o cardápio
**pelo link** (`/:slug`, sem `?mesa=`) só navega — não há como pedir entrega
nem retirada, e ninguém acompanha pedido nenhum, embora a API já tenha a
criação nas três modalidades, a cotação de frete, o `trackingToken` e o
acompanhamento por WebSocket e HTTP.

Esta spec fecha o app: o finalizar em passos para entrega e retirada, a tela de
enviado com o link de acompanhamento, a página de acompanhamento em tempo real,
e as quatro coisas que a API ainda não tem para isso (complemento do endereço,
motivo do cancelamento, previsão e o que o cardápio público precisa mostrar).

Fontes: a spec da parte 1
(`docs/superpowers/specs/2026-09-29-app-do-cliente-parte-1-design.md`, seção
"Mudanças na API — parte 2"), o handoff em `docs/design/app-do-cliente/` (o
protótipo `App do Cliente.dc.html`, modo link) e o contrato em
`apps/api/openapi.json`.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Pedido em andamento | **Guardado no aparelho** enquanto está em andamento; ao reabrir o cardápio da loja, uma faixa leva ao acompanhamento. Sai quando termina, é cancelado, ou em 24 h. **Nunca vira histórico** de pedidos |
| Pedido mínimo | **Aviso no carrinho, bloqueio só na entrega.** O mínimo vale só em `delivery` na API; o carrinho não trava, e o passo da modalidade desabilita "Entrega" com o motivo |
| Endereço lembrado | **Junto com nome e telefone**: grava depois de um pedido de entrega que deu certo, vence 30 dias depois do último pedido, sai com "Não é você? Limpar dados" |
| Acompanhamento | **WebSocket com recuo para consulta**: socket quando dá, `GET` a cada 20 s quando não, tentando o socket de novo a cada minuto |
| Página de acompanhamento | **Rota própria** `/:slug/pedido/:orderId?t=<token>`, sem cache e `noindex` — o token é credencial (S27) |
| API | Complemento, motivo do cancelamento, previsão, `statusHistory` no acompanhamento público, endereço da loja e bairros atendidos no cardápio público |
| CEP | **Campo "CEP"** no endereço, que o handoff não tem e a API exige (`zipCode`); cidade e UF vêm do endereço da loja |
| Entrega | **Uma branch**, tarefas na ordem API → painel → app |

## Mudanças na API

Cada campo novo que sai numa superfície pública é decisão explícita (S10): entra
no `Pick`/mapper **e** no `schema.response` da rota, e nada além do listado.

### 1. Complemento do endereço

- `orders.complement text` nulável (migration nova), com `check` de até 120
  caracteres e só com endereço presente (espelha o `orders_address_check`).
- Entrada: `deliveryAddress.complement`, opcional, `maxLength: 120`. String só
  com espaços vira `null` (mesma normalização da observação do item).
- ⚠️ O `addressSchema` compartilhado (`routes/schemas.ts`) é usado também no
  cadastro do restaurante e na cotação. O complemento entra **só** no endereço
  do pedido: um schema próprio que estende o compartilhado, não uma mudança no
  value object de todo mundo.
- Saída: `deliveryAddress.complement` (`nullable: true`, F12) no detalhe, na
  listagem, na criação e no acompanhamento.
- Congelado como o resto do endereço: não se edita depois.

### 2. Motivo do cancelamento

- `orders.cancellation_reason text` nulável, `check` de até 200 caracteres e só
  em pedido `cancelled`.
- `POST /restaurants/:restaurantId/orders/:orderId/cancel` aceita corpo opcional
  `{ reason?: string }` (`maxLength: 200`, aparado, vazio vira `null`). Sem
  corpo continua valendo — o painel de hoje e o teste de hoje não quebram.
- Gravado dentro do `transitionTo()`, na mesma transação da mudança de status.
- Saída: `cancellationReason` (`nullable`) no detalhe do painel e no
  acompanhamento público. Na listagem, não.

### 3. Previsão

- `restaurants.prep_time_minutes`, `delivery_time_min_minutes`,
  `delivery_time_max_minutes`: `integer` nuláveis, cada um entre 1 e 240;
  `check (delivery_time_min_minutes <= delivery_time_max_minutes)` e os dois de
  entrega juntos ou nenhum (tudo-ou-nada, como o endereço).
- Editáveis pelo `PATCH /restaurants/:restaurantId` (`nullable: true`, F12 —
  `null` desliga a previsão). **Não** saem no cardápio público.
- O acompanhamento devolve `estimate`, calculado no **serviço** a partir do
  instante do evento `confirmed` em `order_status_events`:
  - `takeaway`: `{ readyAt }` = confirmado + `prep_time_minutes`;
  - `delivery`: `{ from, to }` = confirmado + mínimo / + máximo;
  - `null` antes da confirmação, depois de `completed`/`cancelled`, fora dessas
    duas modalidades, ou sem configuração. **A tela não inventa previsão.**
- Os tempos lidos são os **de agora**, não congelados no pedido: previsão é
  estimativa, e a loja que muda o tempo no meio do almoço quer que ele valha já.

### 4. Horários no acompanhamento público

- `GET /orders/:orderId?token=` passa a trazer `statusHistory`
  (`[{ status, at }]`), a mesma lista que o detalhe do painel já tem. São os
  instantes do próprio pedido de quem tem o token — nada da loja.
- As mensagens do WebSocket **não mudam** (`snapshot` e `status`); o app, ao
  receber uma, refaz o `GET`. Uma fonte só para horários, previsão e motivo.

### 5. Endereço da loja no cardápio público

- `GET /menu/:slug` ganha `address` (rua, número, bairro, cidade, UF, CEP). É o
  endereço que a loja já publica na porta; quem escolhe retirada precisa dele.

### 6. Bairros atendidos no cardápio público

- `GET /menu/:slug` ganha `deliveryNeighborhoods: string[]` — só os **nomes**,
  sem valores — quando `deliveryFeeMode = "neighborhood"`; lista vazia nos
  outros modos.
- Motivo: a cotação exige endereço completo e só devolve `servedNeighborhoods`
  depois de cotar; o seletor de bairro precisa existir antes. Os valores
  continuam saindo só pela cotação, para o endereço da pessoa.

O que **não** muda: cotação de frete, pedido mínimo, troco, formas de
pagamento, `trackingToken`, máquina de status.

## Painel

- **Cancelar:** os três diálogos de cancelamento ganham "Motivo (o cliente vê)",
  opcional, até 200 caracteres, enviado no corpo do `cancel`.
- **Detalhe do pedido:** o complemento junto do endereço; o motivo, em pedido
  cancelado.
- **Modalidades:** bloco "Tempos estimados", com `SaveBar` própria (os
  interruptores seguem salvando sozinhos): "Preparo para retirada: __ min" e
  "Entrega entre __ e __ min". Vazio vai como `null`. Validação no cliente
  espelha a da API (1–240, mínimo ≤ máximo, os dois de entrega juntos).

## App

### Pedido pelo link

Quem abre `/:slug` sem `?mesa=` passa a poder pedir quando a loja está aberta,
não pausada, e aceita **entrega ou retirada** (`isDelivery || isTakeaway`). Com
as duas desligadas, só navega, com o aviso "Esta loja não está recebendo
pedidos pelo app agora". O salão continua como está.

### Carrinho

- Pelo link, o rótulo é **"Itens"** (o frete vem depois); no salão continua
  "Total".
- Loja com entrega e mínimo, subtotal abaixo: "Para entrega, faltam R$ X para o
  pedido mínimo". **Sem travar** o botão.
- Contexto no cabeçalho: "Entrega ou retirada".

### Finalizar em passos

Cabeçalho "Finalizar" com "Passo X de Y" e as barrinhas do handoff. Cada passo é
uma entrada do histórico (o voltar do celular volta um passo). A barra de baixo
diz o que falta, como na parte 1.

1. **Modalidade** — "Como você quer receber?"
   - "Entrega · Chega no seu endereço", desabilitada com "Pedido mínimo para
     entrega: R$ X" quando o subtotal não alcança.
   - "Retirada · Você busca na loja" e o endereço da loja numa linha.
   - Só as que a loja aceita. **Uma só → o passo pula**, e o contador conta um
     passo a menos.
2. **Dados** — nome e telefone (com máscara), preenchidos se lembrados.
3. **Endereço** (só entrega) — "Onde entregar?"
   - **Bairro:** seletor com `deliveryNeighborhoods` no modo por bairro; texto
     livre nos outros.
   - **Rua**, **Número**, **Complemento** ("apto, bloco, referência",
     opcional), **CEP** (máscara `00000-000`, 8 dígitos). Cidade e UF vêm do
     endereço da loja.
   - A **cotação** (`POST /menu/:slug/delivery-quote`) roda quando o endereço
     fica completo e a cada mudança de bairro, e mostra um dos quatro estados do
     handoff: "Entrega: R$ 9,00", "Entrega grátis neste pedido", "A loja combina
     a entrega com você", ou "Esta loja não entrega no seu bairro" com "Trocar
     para retirada" (vai para o passo de pagamento em retirada; só aparece se a
     loja aceita retirada).
   - Avançar exige cotação respondida e que entregue.
4. **Pagamento** — "Como você paga?"
   - Entrega: "Dinheiro", "Cartão na entrega", "Pix", "Vale-refeição" — só as
     que a loja aceita. Retirada: "Dinheiro", "Cartão na retirada", "Pix",
     "Vale-refeição".
   - Dinheiro: "Troco para quanto?" (máscara de reais) ou "Não preciso de
     troco, tenho o valor exato". Troco menor que o total: "O troco precisa ser
     no mínimo R$ X", e o envio trava.
   - "A loja cobra na entrega ou na retirada." (dica do handoff).
   - **Resumo:** Itens, Entrega (valor, "Grátis" ou "A combinar"; só em
     entrega) e TOTAL.
   - Botão "Enviar pedido".

O corpo do `POST` é montado por uma função pura por modalidade; o frete nunca
vai no corpo (a API recalcula).

### Enviado

- Título "Pedido enviado"; texto "A loja vai confirmar e avisar quando estiver
  pronto para retirada." (retirada) ou "A loja vai confirmar o pedido e você
  acompanha a entrega por aqui." (entrega).
- Comprovante do **servidor** (itens, Entrega, TOTAL), como na parte 1.
- "Guarde este link — ele não se recupera", com o link completo e um botão de
  copiar; "Acompanhar pedido" (primário) e "Voltar ao cardápio".
- O pedido vira **pedido em andamento** no aparelho, e nome, telefone e
  endereço (na entrega) são lembrados.

### Acompanhamento — `/:slug/pedido/:orderId?t=<token>`

Página própria do App Router, **dinâmica e sem cache** (nada do token em cache
compartilhado), `robots: noindex`. O servidor busca só o cardápio público da
loja (nome, cor, endereço); o pedido é buscado **no navegador**.

- **Topo:** "Atualizando em tempo real" (socket conectado) ou "Atualizado há X s"
  (consulta); a etapa atual em destaque; a previsão — "Pronto por volta de
  19:25" (retirada) ou "Previsão de entrega: 19:40 – 19:55" (entrega), no fuso
  da loja. Antes de confirmar: "Aguardando a loja confirmar".
- **Trilha**, com o horário de cada etapa vindo do `statusHistory` ("—" onde não
  há registro):
  - entrega: Pedido aceito → Preparando → Saiu para entrega → Entregue;
  - retirada: Pedido aceito → Preparando → Pronto para retirada → Retirado.
- **Retirada:** o número do pedido ("Pedido #1042", o que se fala no balcão) e o
  endereço da loja.
- **Seu pedido:** itens com opções e observação, Entrega e TOTAL.
- **Cancelado:** "Pedido cancelado" e o motivo; sem motivo, "A loja cancelou
  este pedido.".
- **Token inválido ou pedido de outra loja:** "Não encontramos este pedido" e
  "Voltar ao cardápio".

**Transporte** (um módulo que a tela só assina):

- Abre o WebSocket `/orders/:orderId/track?token=`. Cada mensagem → refaz o
  `GET`. Pedido terminado → fecha e para tudo.
- Socket não abre ou cai → consulta o `GET` a cada **20 s**, e tenta o socket de
  novo a cada **60 s**.
- Aba volta a ficar visível → `GET` na hora.
- Estado exposto: `{ order, mode: "live" | "polling", updatedAt, error }`.

### Pedido em andamento no aparelho

- `localStorage`, chave por loja: `order:<slug>` = `{ orderId, token, savedAt }`.
  Um por loja — o mais recente.
- Ao abrir o cardápio da loja: se há pedido guardado com menos de 24 h, um `GET`
  confere; em andamento → faixa "Você tem um pedido em andamento · Acompanhar";
  404, `completed`, `cancelled` ou mais de 24 h → **sai do aparelho**.
- A página de acompanhamento também tira o pedido guardado quando ele termina.

### Lembrado no aparelho

`lib/customer.ts` ganha o endereço (bairro, rua, número, complemento, CEP) além
de nome e telefone, com as mesmas regras: grava só depois de pedido que deu
certo (endereço só em entrega), vence 30 dias depois do último pedido, "Não é
você? Limpar dados" apaga tudo.

## Erros

| Onde | O que acontece | O que a tela faz |
| --- | --- | --- |
| Cotação | rede, 5xx, 429 | "Não deu para calcular a entrega." + "Tentar de novo"; avançar trava |
| Criação | 409 "não entrega nesse endereço" | volta ao passo do endereço com a mensagem |
| Criação | 409 pedido mínimo, loja fechada ou pausada | a mensagem da API; carrinho intacto |
| Criação | 404/400 de cardápio velho | a regra da parte 1 (mensagem sem id, "Atualizar o cardápio") |
| Criação | 400 de troco | a mensagem da API, no passo do pagamento |
| Acompanhamento | 404 | "Não encontramos este pedido" |
| Acompanhamento | sem rede | último estado + "Atualizado há X s"; a consulta continua |
| Pedido guardado | 404 ou terminado | sai do aparelho, sem faixa |

## Onde a implementação diverge do handoff

| Handoff | Aqui | Por quê |
| --- | --- | --- |
| Mínimo trava o carrinho | aviso no carrinho, trava só a entrega | o mínimo vale só em `delivery` |
| Sem campo de CEP | campo "CEP" | a API exige `zipCode` |
| "Complemento" com selo "em breve" | campo ativo | implementado na API |
| `/pedido/8F2K-91DA` (código curto) | `/:slug/pedido/:orderId?t=<token>` | o token é a credencial (S27) |
| "Pronto em cerca de 25 min" | "Pronto por volta de 19:25" | a hora de parede não envelhece enquanto a tela fica aberta |
| Cartão sempre "na entrega" | "Cartão na retirada" na retirada | o texto dizia um lugar que não é o da retirada |
| Sem número do pedido no acompanhamento | "Pedido #1042" na retirada | é o que se fala no balcão |

## Testes

- **API** (integração): complemento (entrada, `check`, saída nas quatro
  superfícies, só em entrega); motivo (com e sem corpo, só em cancelado, saída no
  detalhe e no acompanhamento, fora da listagem); tempos (PATCH, `check`s,
  `null` desliga); `estimate` (antes/depois de confirmar, sem configuração,
  terminado, nas duas modalidades); `statusHistory` público; `address` e
  `deliveryNeighborhoods` no cardápio (e nada além). `openapi.json` regerado.
- **Painel:** motivo no cancelar, complemento e motivo no detalhe, formulário
  de tempos (validação e `null`).
- **App — puras:** passos do finalizar (quais, contagem, pulo de modalidade
  única), estados da cotação, troco, corpo do `POST` por modalidade, previsão
  formatada no fuso da loja, trilha com horários, pedido em andamento (24 h,
  terminado), lembrados com endereço.
- **App — transporte:** WebSocket falso: mensagem → `GET`; socket cai →
  consulta a cada 20 s; reconecta; pedido terminado fecha tudo.
- **App — fluxos:** entrega completa (com cotação e troco) e retirada completa
  com `fetch` simulado; "não entrega no seu bairro" → "Trocar para retirada";
  faixa de pedido em andamento.
- **Ponta a ponta** no navegador a 390 px: uma entrega e uma retirada até o fim,
  com o status avançado no painel e o acompanhamento mudando sozinho.

## Fora de escopo, de propósito

- **Histórico de pedidos e conta do cliente** — decisão desta spec: o aparelho
  guarda só o pedido em andamento.
- **Pagamento online** — a API não tem.
- **Entrega por distância (`distance`)** — a API ainda não deixa a loja
  escolher; chega com a geocodificação.
- **Notificação push** quando o status muda — o acompanhamento é a página.
- **Busca de CEP** (preencher rua pelo CEP) — seria a primeira dependência
  externa do app.
- **Hospedagem e deploy.**
