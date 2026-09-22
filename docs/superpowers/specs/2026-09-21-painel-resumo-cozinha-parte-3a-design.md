# Painel da loja, parte 3a — Resumo do dia e Modo cozinha — desenho

**Data:** 2026-09-21 · **Estado:** implementado (branch `feat/painel-resumo-cozinha`)

## O problema

O painel já recebe, aceita e acompanha pedido, mas deixa dois lugares da loja sem
tela própria:

- **O dono não tem onde ler o dia.** O header mostra "aceitos hoje, faturamento,
  ticket médio" numa linha só, e nada além de hoje. Ontem, a semana e o mês não têm
  onde aparecer, nem a divisão por status.
- **A cozinha usa a tela do caixa.** O kanban de Pedidos traz preço, forma de
  pagamento e telefone — dado que a cozinha não decide e que, no pico, é mais uma
  linha para varrer com o olho num tablet a um metro de distância.

Fontes deste desenho: o handoff (`docs/design/painel-da-loja/README.md`, telas 4 e
7, e o protótipo `Painel da Loja.dc.html`), a spec da parte 1
(`docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md`) e o contrato
em `apps/api/openapi.json`.

## O corte: 3a e 3b

| Parte | Telas | Por quê |
| --- | --- | --- |
| **3a — este documento** | Resumo do dia, Modo cozinha | Só leem os pedidos que o painel já busca; sem dependência nova, sem mudança de contrato |
| 3b | Mesas e QR, Usuários | Criam dado; trazem a biblioteca de QR (`react-qr-code`, já decidida) e o campo de senha provisória no convite (já decidido) |

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Base da branch | **Empilhada na 2b** (`feat/painel-entrega-opcoes`, PR #22 aberta). A PR da 3a só abre, contra a `main`, **depois** do merge da #22 — não empilhada, para não repetir a base que não trocou sozinha na #21 |
| Resumo "Hoje" | **A MESMA query do header** (`useTodaySummary`) |
| Valor em reais por status | **Fica de fora**: a rota de resumo não o devolve; vira pendência de API |
| Onde mora o Modo cozinha | **Tela cheia, fora da casca** (`/cozinha`), entrando por um botão em Pedidos |
| Itens na cozinha | **Detalhe buscado uma vez por pedido**: os itens são congelados na criação |

## Arquitetura

| Rota | Onde | Título |
| --- | --- | --- |
| `/resumo` | dentro do `PanelLayout`; rail em Operação, logo abaixo de Pedidos | Resumo do dia |
| `/cozinha` | **fora** do `PanelLayout`, ainda atrás de `RequireSession` e `RequireVerified` | Modo cozinha |

## Resumo do dia

### O período

Grupo segmentado com os quatro botões que o filtro de Pedidos já usa (`PERIODS` em
`features/orders/orderFilters.ts`): Hoje, Ontem, Últimos 7 dias, Este mês. O período
vai na URL (`?period=`), sem ele é Hoje.

⚠️ **Hoje usa a MESMA query do header** (`useTodaySummary`,
`["orders", "summary", restaurantId, "today"]`). O handoff é explícito: *"Barra
superior e Resumo devem sair do mesmo cálculo … se forem duas fontes, os números
divergem e o operador deixa de confiar nos dois."* Os outros períodos têm query
própria, `["orders", "summary", restaurantId, <período>]` — sob o prefixo
`"orders"`, então qualquer ação num pedido atualiza o Resumo junto. Todas com o
polling de 10 s do projeto; como só um período está na tela por vez, o custo a mais
é uma query só (6 req/min), e nenhum quando o período é Hoje.

A etiqueta de atualização é **"Fechamento parcial · atualizado há X s"** nos períodos
que incluem hoje (Hoje, Últimos 7 dias, Este mês). Em **Ontem**, só **"atualizado há
X s"** — o dia já fechou.

### Os três números

Cartões em `repeat(auto-fit, minmax(230px, 1fr))`, valor 32 px/700 tabular, com o
texto literal do protótipo:

| Número | Valor | Linha de explicação |
| --- | --- | --- |
| Faturamento | `revenueInCents` | "de N pedidos aceitos — inclui o frete cobrado" |
| Pedidos aceitos | `revenueOrderCount` | "N chegaram no período" (a soma de todos os status) |
| Ticket médio | `averageTicketInCents` | "faturamento ÷ pedidos aceitos" |

### Pedidos por status

As cinco linhas do protótipo, agrupadas como as colunas do kanban: **Novos**
(`pending`), **Em preparo** (`confirmed` + `preparing`), **Prontos / em rota**
(`ready_for_pickup` + `out_for_delivery`), **Concluídos** e **Cancelados**. Rótulo
com ponto, contagem 16 px/700 e barra de 8 px num trilho `surface3`, com a **fatia
do total que chegou** no período (período vazio: barras vazias).

⚠️ **Sem a coluna de valor em reais.** O handoff desenhou o valor por status (e os
cancelados em vermelho, "— R$ …"), mas a rota de resumo devolve só a contagem por
status e o faturamento total. Somar no painel buscaria todos os pedidos do período e
arriscaria divergir do faturamento que a API calcula — o contrário do que o handoff
pede. Fica como pendência de API.

### Como ler estes números

As três notas em `surface2`, texto literal do protótipo:

1. **Faturamento conta de aceito em diante.** Pedido novo ainda não é venda e
   cancelado deixou de ser. São as vendas do período, não tudo que chegou.
2. **O frete entra no faturamento.** R$ 30 de comida + R$ 15 de entrega aparecem
   como R$ 45. Está certo para faturamento bruto.
3. **O ticket médio mistura comida e frete.** Por isso ele não serve para decidir
   preço de cardápio — para isso, olhe o preço dos produtos.

### Estados

Carregando e erro **só quando não há dado** (`data === undefined`) — a regra das
partes anteriores: um refetch que falha mantém o dado antigo.

## Modo cozinha

### Onde fica

`/cozinha`, **fora da casca**: sem rail e sem header, que ocupam espaço num tablet e
trazem números de dinheiro. Continua atrás de login e da verificação de e-mail. Na
tela de Pedidos entra um botão **"Modo cozinha"**.

No topo, uma faixa mínima: **"Modo cozinha"**, a nota do protótipo (*"Tela para o
tablet da bancada: só o que a cozinha precisa fazer. Sem preço, sem forma de
pagamento, sem telefone — tipografia grande para leitura a um metro."*), o botão de
ligar o som quando o navegador o bloquear, e **"Sair do modo cozinha"**, que volta a
`/pedidos`.

### As duas colunas

`minmax(330px, 1fr)`, texto literal do protótipo:

| Coluna | Pedidos | Vazio |
| --- | --- | --- |
| Entraram agora | `pending` de hoje — a mesma query do aviso de pedido novo e da coluna Novos do kanban | "Nada novo." |
| Fazendo | `confirmed` e `preparing` | "Bancada limpa." |

### O cartão

`border-left: 4px`, `padding: 16px`: código 22 px/700, tipo 15 px/600 `ink2`, tempo
desde a chegada 17 px/700; itens em 21 px com a quantidade numa coluna de 46 px e as
opções em 17 px, indentadas 58 px.

⚠️ **Não mostra preço, total, forma de pagamento nem telefone** (handoff) — e
também não mostra o nome do cliente: o protótipo não o desenha, e a cozinha não
precisa dele para fazer o prato.

### Um botão por estado

Botão de 54 px, texto literal do protótipo:

| Estado | Tipo | Botão | Transição |
| --- | --- | --- | --- |
| `pending` | qualquer | "Aceitar e começar" | `confirm` + `start-preparing` |
| `confirmed` | qualquer | "Começar preparo" | `start-preparing` |
| `preparing` | entrega | "Pronto — despachar" | `dispatch` |
| `preparing` | retirada | "Pronto para retirada" | `ready` |
| `preparing` | salão | "Pronto — servir" | `complete` |

"Aceitar e começar" é o **mesmo fluxo da parte 1** (`orderActionFlow`): a confirmação
obrigatória ("Aceitar manda o pedido para a cozinha e baixa o estoque dos itens"), o
diálogo de estoque insuficiente, e o encadeamento em que, se o `start-preparing`
falhar, o pedido fica `confirmed` e o cartão oferece "Começar preparo" como rede.

**Cancelar não existe na cozinha.** Continua em Pedidos, com os três textos da parte
1 — é a decisão que mexe em estoque e dinheiro.

### De onde vêm os dados

- **Entraram agora** lê a MESMA query de pendentes do `useNewOrderAlert` — zero
  requisição a mais, e o aviso de pedido novo (bipe, título da aba) continua valendo
  na cozinha, que monta o hook por conta própria (ele mora na casca, e a cozinha está
  fora dela).
- **Fazendo** são duas listas, `status=confirmed` e `status=preparing`, a cada 10 s:
  12 req/min.
- ⚠️ **Os itens vêm do detalhe do pedido, buscado UMA vez.** A listagem da API não
  traz itens, mas eles são congelados na criação (`order_items` guarda cópia de nome
  e preço) e nunca mudam: o detalhe de cada pedido é buscado uma vez e não é refeito
  (`staleTime: Infinity`, sem polling). O estado do pedido vem das listas.
- **Conta:** 6 (pendentes) + 12 (fazendo) = **18 req/min por tablet**, mais **uma**
  requisição por pedido novo — abaixo das 20 da casca normal.

## Testes

**Puros:**

- Resumo — a linha de explicação de cada número (singular e plural); "N chegaram no
  período" como a soma de todos os status; a largura da barra, proporcional ao maior
  status, e zero com tudo zerado; "Fechamento parcial" só nos períodos que incluem
  hoje.
- Cozinha — o botão por estado e tipo (as cinco linhas da tabela); em que coluna cada
  pedido cai.

**Componente:**

- **Resumo** — com Hoje, uma chamada só a `summary?period=today`, dividida com o
  header; trocar para Ontem busca `period=yesterday` e vai para a URL; os três números
  e as três notas com o texto literal; todos os status, inclusive os zerados; um
  refetch que falha não troca os números pela mensagem.
- **Cozinha** — pendente em "Entraram agora", `confirmed`/`preparing` em "Fazendo";
  nenhum "R$" na tela; "Aceitar e começar" confirma e manda `confirm` +
  `start-preparing`; "Pronto — despachar" manda `dispatch` num pedido de entrega; o
  detalhe de cada pedido é buscado uma vez só, mesmo com as listas atualizando; "Sair
  do modo cozinha" volta a `/pedidos`; o botão "Modo cozinha" em Pedidos leva a
  `/cozinha`.

## Onde a implementação diverge do handoff

| O quê | Por quê |
| --- | --- |
| Sem a coluna de valor por status no Resumo | A rota de resumo não devolve o valor por status; somar no painel divergiria do faturamento da API (pendência de API) |
| "atualizado há X s" sem "Fechamento parcial" em Ontem | O protótipo só mostra Hoje; num dia que já fechou, "parcial" seria falso |
| Sem o nome do cliente no cartão da cozinha | O protótipo não o desenha; a cozinha não precisa dele |
| Modo cozinha fora da casca, com botão de entrada em Pedidos | No protótipo ele está no grupo "Protótipo" do rail (andaime), que o handoff manda não implementar |
| O diálogo de aceite da cozinha não mostra nome nem total, e o de estoque insuficiente só tem "Fechar" | A cozinha não decide dinheiro; cancelar e repor estoque continuam em Pedidos |
| Na cozinha, a falha de estoque diz "Avise o caixa: repor o estoque ou recusar o pedido se faz na tela de Pedidos." | Os botões de repor e recusar não existem na cozinha; o texto do painel mandaria fazer o que ali não se pode |
| Cartão da cozinha com "Tentar de novo" quando os itens não carregam, e "Fazendo" mostrando a parte que chegou quando uma das duas listas falha | O detalhe é buscado uma vez só; sem o botão, um erro prenderia o cartão o turno inteiro, e sem a lista parcial uma falha esconderia pedidos que chegaram bem |
| Sem "atualizado há X s" no topo da cozinha | O protótipo o mostra, mas a tela tem três atualizações independentes (pendentes e duas listas); um relógio só mentiria sobre as outras duas |

## Repo

Nenhuma dependência nova. O rail ganha "Resumo do dia" em Operação; o `router.tsx`
ganha `/resumo` dentro da casca e `/cozinha` fora dela. O `CLAUDE.md` ganha duas
regras: o Resumo com "Hoje" usa a mesma query do header; a cozinha fica fora da
casca, busca o detalhe uma vez por pedido e não mostra dinheiro.

## Fora de escopo, de propósito

- **Mesas e QR, Usuários** — parte 3b.
- **Período personalizado (de/até) no Resumo** — o handoff só desenha os quatro
  botões.
- **Cancelar na cozinha** — continua em Pedidos.
- **Impressão de comanda** — fora do handoff.
