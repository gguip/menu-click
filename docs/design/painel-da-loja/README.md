# Handoff: Painel operacional da loja (restaurantes)

## Overview

Painel web usado pela equipe de um restaurante durante todo o expediente: recebe e despacha
pedidos, administra cardápio, configura entrega/horário/mesas. O painel fica aberto o dia
inteiro, em momentos de pico, e é operado com pressa — a prioridade de design é **baixa fadiga
visual, hierarquia de urgência e leitura rápida de números**, não impacto visual.

Superfície alvo: **notebook no caixa, ~1440 px de largura, mouse e teclado**. As telas reflowam
para larguras menores, mas não há layout mobile dedicado. Existe uma exceção desenhada para
tablet: o **Modo cozinha**.

Stack pretendida pelo cliente: **React + Mantine** (ver "Mapa para Mantine" no fim).

---

## About the Design Files

`Painel da Loja.dc.html` neste pacote é uma **referência de design feita em HTML** — um protótipo
que demonstra aparência, hierarquia, copy e comportamento pretendidos. **Não é código de
produção e não deve ser copiado para o app.**

A tarefa é **recriar estas telas no ambiente que já existe no codebase** (React + Mantine, pelo
que foi definido), usando os componentes, o tema e os padrões já estabelecidos lá. Se ainda não
houver ambiente, escolha o framework adequado e implemente as telas nele.

Particularidades do arquivo de referência que **não** devem ser reproduzidas:
- todo o CSS é inline e o arquivo é um componente único de ~1.800 linhas — isso é uma restrição
  da ferramenta de prototipagem, não uma recomendação de arquitetura;
- os dados são arrays literais no topo do arquivo (`ORDERS`, `PRODUCTS`, `STATES`);
- a navegação é `state.screen`, não rotas — no app real, use o roteador do projeto;
- o QR code dos adesivos de mesa é um grid de quadradinhos decorativo, **não** um QR válido:
  gere QR de verdade, com correção de erro média ou alta.

## Fidelity

**Alta fidelidade (hifi).** Cores, tipografia, espaçamento, alturas de controle, estados e **toda
a copy em português** são finais e devem ser reproduzidos. A copy é parte do design: vários textos
existem para evitar erro de operação (ver "Copy que não pode ser reescrita").

---

## Design Tokens

Dois temas. Implemente como tema do Mantine (ou variáveis CSS no `:root` / `[data-theme]`), nunca
como valores soltos.

### Cores — tema claro (padrão)

| Token | Hex | Uso |
|---|---|---|
| `bg` | `#F5F4F1` | fundo da janela |
| `surface` | `#FFFFFF` | cartões, painéis, linhas de tabela |
| `surface2` | `#FAF9F7` | fundo de coluna, cabeçalho de tabela, rodapé de formulário |
| `surface3` | `#EFEDE9` | esqueleto de carregamento, avatar, chip neutro |
| `line` | `#E4E1DB` | borda padrão (substitui sombra) |
| `line-hi` | `#CFCAC2` | borda enfatizada, borda tracejada, trilho de switch desligado |
| `ink` | `#1B1A17` | texto principal e números |
| `ink2` | `#5F5A52` | texto de apoio |
| `ink3` | `#6E6960` | rótulos, metadados (contraste ≥ 4.5:1) |
| `accent` | `#4A6B3A` | ação primária, status "pronto", item de nav ativo |
| `accent-hi` | `#3C5A2D` | hover da ação primária, texto sobre `accent-soft` |
| `accent-soft` | `#EDF1E7` | fundo de badge/nav ativo |
| `accent-line` | `#CBD8BD` | borda de badge/nav ativo |
| `on-accent` | `#FFFFFF` | texto sobre `accent` |
| `warn` | `#8A5A12` | **texto** de alerta |
| `warn-strong` | `#C4841F` | ponto/borda/trilho de alerta |
| `warn-soft` | `#FBF2E2` | fundo de alerta |
| `warn-line` | `#E8D3A8` | borda de alerta |
| `danger` | `#98362A` | texto destrutivo, valor negativo |
| `danger-soft` | `#FAEDEB` | fundo destrutivo |
| `danger-line` | `#E7C6C0` | borda destrutiva |

### Cores — tema escuro

| Token | Hex |
|---|---|
| `bg` | `#15140F` |
| `surface` | `#1E1D19` |
| `surface2` | `#242320` |
| `surface3` | `#2B2A25` |
| `line` | `#332F29` |
| `line-hi` | `#443F37` |
| `ink` | `#EFEDE7` |
| `ink2` | `#A8A29A` |
| `ink3` | `#98928A` |
| `accent` | `#93B375` |
| `accent-hi` | `#A6C489` |
| `accent-soft` | `#232A1C` |
| `accent-line` | `#39452C` |
| `on-accent` | `#14170F` |
| `warn` | `#DFAE5E` |
| `warn-strong` | `#E8BE74` |
| `warn-soft` | `#2B2417` |
| `warn-line` | `#4A3D22` |
| `danger` | `#E08878` |
| `danger-soft` | `#2C1D19` |
| `danger-line` | `#4E2F27` |

**Regra de uso de cor, mais importante que os valores:** um acento só (oliva). Âmbar é reservado
para *"exige ação agora"* — nunca decorativo. Vermelho é reservado para destrutivo e falha. O
resto da tela é neutro cinza-quente. Isso é o que mantém a coluna "Novos" visível no periférico
depois de oito horas de uso.

**O atributo de tema precisa ficar no `<html>`** (`data-theme="dark"`), não num container interno,
senão o `body` e o overscroll continuam claros.

### Tipografia

**Figtree** (Google Fonts), pesos 400/500/600/700. Fallback: `ui-sans-serif, system-ui, sans-serif`.
`-webkit-font-smoothing: antialiased`. `line-height: 1.45` no corpo. Base 15 px.

| Papel | Tamanho / peso | Tracking |
|---|---|---|
| Total do pedido (drawer) | 24 px / 700 | `-0.025em` |
| Big number do Resumo | 32 px / 700 | `-0.03em` |
| Título de tela (header) | 17 px / 600 | `-0.01em` |
| Nome no cartão de pedido | 16 px / 600 | `-0.01em` |
| Título de seção/card | 15 px / 700 | — |
| Corpo | 14 px / 400 | — |
| Rótulo de campo | 12.5 px / 600 | — |
| Eyebrow / cabeçalho de tabela | 11 px / 700 uppercase | `0.07–0.09em` |
| Grupo de nav | 10.5 px / 700 uppercase | `0.09em` |

**Todo número usa `font-variant-numeric: tabular-nums`** (classe `.n` no protótipo): totais,
contadores, horários e preços precisam alinhar em coluna para serem comparados sem leitura.

No **Modo cozinha** a escala é outra: item 21 px/600, quantidade 21 px/700, opções 17 px,
código do pedido 22 px/700, botão 17 px/700 e 54 px de altura — leitura a um metro de distância.

### Espaçamento, raio, alturas

- Escala de espaço: **4 · 8 · 12 · 16 · 20 · 24**. Padding de tela: `18px 20px`.
- Raio: **6 px** em controles, **10 px** em painéis e cartões grandes, **999 px** em badges/switch.
- Alturas: input/select **36 px**; botão secundário **36–38 px**; botão primário **38 px**;
  CTA de formulário **44–46 px**; linha de tabela **44 px** (38 px no modo compacto);
  ação principal do drawer **46 px**; botão do modo cozinha **54 px**.
- Alvo de toque mínimo: **38 px** de altura. Nada abaixo disso é clicável.
- **Sem sombra em nenhum lugar.** Separação é borda de 1 px + troca de superfície. Sem gradiente.
- Densidade "compacta" (tweak): padding 14→10, linha 44→38, gap 12→8. Nada mais muda.

### Movimento

Praticamente nenhum. Hover troca `background` ou `border-color`, sem transição declarada. A única
animação que o design admite é a chegada de pedido novo (e ela ainda não está no protótipo). Não
adicione transições, fades de página ou skeletons pulsantes: o painel fica aberto o dia inteiro.

---

## Estrutura global

```
┌────────────┬──────────────────────────────────────────────┐
│ nav 212px  │ header 60px (sticky)                         │
│ (sticky,   ├──────────────────────────────────────────────┤
│  100vh)    │ faixa de pausa (condicional)                 │
│            ├──────────────────────────────────────────────┤
│            │ conteúdo da tela                             │
└────────────┴──────────────────────────────────────────────┘
        + drawer de detalhe 472px (fixed, direita, z 40)
        + modal de confirmação (fixed, centro, z 60)
```

### Rail de navegação — 212 px, `flex: 0 0 212px`, `border-right: 1px solid line`, `background: surface`

Topo (padding `16px 16px 12px`, borda inferior): nome da loja 15 px/700; abaixo, ponto de 7 px
(`accent` aberto / `accent` pausado com texto trocado) + "Aberta · fecha 23:30" ou "Pausada agora"
em 12.5 px `ink2`.

Itens em três grupos com cabeçalho uppercase 10.5 px:

- **Operação** — Pedidos (com contador de novos à direita, em `warn` quando > 0), Resumo do dia,
  Produtos, Seções, Grupos de opções
- **Configuração** — Modalidades, Entrega, Horário, Mesas e QR, Dados da loja, Usuários *(só owner)*
- **Protótipo** — Estados, Direção visual, Modo cozinha, Bloqueio de e-mail, Login, Cadastro,
  Recuperar senha
  → **este grupo é andaime de protótipo. Não implemente.** Ele só existe para dar acesso a telas
  fora do fluxo logado. No app real, Estados e Direção visual não existem; as outras são rotas
  públicas ou de bloqueio.

Item: altura ~34 px (`padding: 8px 10px`), raio 6, 13.5 px/500. Ativo: `background: accent-soft`,
`color: accent-hi`. Hover: `background: surface3`.

Rodapé (borda superior): avatar circular de 28 px em `surface3` com iniciais 12 px/700 `ink2`;
nome 12.5 px/600 com ellipsis; papel ("Dono" / "Equipe") 11 px `ink3`.

### Header — 60 px, sticky, `z-index: 20`, `background: surface`, borda inferior, `padding: 0 20px`

Esquerda: título da tela 17 px/600.
Direita, com `gap: 22px`: três indicadores do dia, cada um com eyebrow 10.5 px uppercase `ink3` e
valor 16 px/600 tabular — **Aceitos hoje**, **Faturamento**, **Ticket médio**. Depois um divisor
vertical de 1 px × 32 px, e o interruptor de pausa.

**Interruptor de pausa (crítico).** Pill de 38 px de altura, `padding: 7px 14px 7px 11px`, com um
switch desenhado de 34×20 px à esquerda do rótulo. Ligado ("Aceitando pedidos"): trilho `accent`,
botão `on-accent`, alinhado à direita, fundo `surface`, borda `line`. Pausado ("Pausada"): trilho
`warn-line`, botão `warn`, alinhado à esquerda, fundo `warn-soft`, borda `warn-line`, texto `warn`.

Este controle **tem de ficar global e sempre visível** — é o botão de "cozinha afogada". Na
estrutura atual ele estava enterrado dentro de Horário de Funcionamento, o que é um erro de
usabilidade: quem precisa dele está com a cozinha em colapso e não vai procurar em configurações.

Quando pausado, uma faixa aparece logo abaixo do header: `warn-soft`, borda inferior `warn-line`,
`padding: 10px 20px`, texto 13.5 px `warn` — **"Pausada · A loja não está recebendo pedidos novos.
O horário cadastrado não foi alterado."** A segunda frase evita o medo de ter desconfigurado o
horário.

---

## Screens / Views

### 1. Pedidos (home)

A tela onde o operador passa o dia. Kanban de 4 colunas.

**Alerta de entrega (condicional, topo).** `margin: 16px 20px 0`, borda `warn-line` com
`border-left: 3px solid warn-strong`, fundo `warn-soft`, raio 6, `padding: 12px 14px`. Título
13.5 px/700 `warn`: *"Entrega por bairro sem nenhum bairro cadastrado"*. Corpo 13 px `ink2`,
`max-width: 78ch`: *"Não é frete grátis: a loja não consegue calcular o frete e vai recusar
pedidos de entrega. Cadastre os bairros ou mude para taxa fixa."* Botão à direita leva para
Entrega. **Isto era uma mensagem de formulário na estrutura atual — virou alerta persistente,
porque a loja perde pedido sem ninguém perceber.**

**Barra de filtros** (`padding: 16px 20px 14px`, `gap: 10px`, wrap):
- grupo segmentado de período: Hoje · Ontem · Últimos 7 dias · Este mês (36 px, um bloco só com
  divisores de 1 px; ativo em `accent-soft` / `accent-hi`)
- botão tracejado "Intervalo de datas" → quando ativo, mostra "12/09 – 17/09 · limpar"
- select de mesa: "Todas as mesas" + uma opção por mesa cadastrada (quando filtrado, fundo
  `accent-soft`, borda `accent-line`) — mapeia para `tableId` na API
- à direita: "Atualiza sozinho · há 6 s" (ou "Carregando pedidos…") e o select de ordenação
  (Mais recentes / Maior valor)

**Período e intervalo são mutuamente exclusivos.** Escolher um desliga o outro, e quando o
intervalo está ativo aparece a nota: *"Intervalo de datas ativo — o filtro por período fica
desligado. Os dois não se combinam."* Na estrutura atual os dois podiam ficar ligados juntos, com
resultado imprevisível.

**Kanban.** `grid-template-columns: repeat(4, minmax(268px, 1fr))`, `gap: 12px`,
`overflow-x: auto`, `align-items: start`. Colunas: **Novos** (ponto `warn-strong`), **Em preparo**
(`ink3`), **Prontos** (`accent`), **Finalizados** (`line-hi`, agrupa concluídos e cancelados).

Coluna: borda `line`, raio 10, fundo `surface2`, `max-height: calc(100vh - 210px)`, corpo com
scroll. Cabeçalho `padding: 11px 13px`: ponto de 8 px, título 13.5 px/700, contador pill à direita
(em Novos com > 0: `warn-soft` / `warn`; resto: `surface3` / `ink2`).

**Cartão de pedido.** Fundo `surface`, borda `line`, **`border-left: 3px solid`** com a cor do
estado (`warn-strong` novo, `line-hi` em preparo, `accent` pronto, `danger-line` cancelado,
`line` concluído), raio 6, `padding: 14px`, `gap: 8px`, `cursor: pointer`, hover troca a borda
para `line-hi`. Novo também recebe borda geral `warn-line`. Conteúdo, de cima para baixo:

1. `#1042` 12.5 px/700 `ink3` + tempo à direita 12.5 px/600 — **em `warn` se for novo ou se
   passou de 25 min ainda aberto**, senão `ink3`
2. nome do cliente (ou "Mesa 7") 16 px/600, uma linha com ellipsis
3. pill de tipo com ponto colorido (Entrega `accent` / Retirada `#6B7B8C` / Salão `warn-strong`),
   mais o estágio quando pronto ("Saiu para entrega", "Pronto para retirada")
4. forma de pagamento 12.5 px `ink2` à esquerda e **total 18 px/700 tabular** à direita
5. ações: primária ocupando a largura (novo: `accent` cheio, "Aceitar"; demais: contorno,
   "Despachar" / "Pronto" / "Concluir") e, só em novo, "Recusar" ao lado. Concluído e cancelado
   **não têm ações.**

Vazio por coluna, 13 px `ink3` centralizado: "Nada esperando aceite." / "A cozinha está livre." /
"Nada aguardando saída." / "Nenhum pedido encerrado hoje."

Carregando (tweak `carregando`): 2 esqueletos por coluna — três barras de 11/15/11 px em
`surface3`, larguras 45%/75%/60%, **sem animação**; contador vira "—".

### 2. Detalhe do pedido (drawer)

`position: fixed`, direita, `width: 472px`, `max-width: 92vw`, `z-index: 40`, fundo `surface`,
`border-left: 1px solid line`. Sem overlay escuro: o kanban continua legível ao lado, de propósito.

Cabeçalho: `#1042` + pill de tipo + "há 2 min"; nome 20 px/700; telefone tabular e endereço/mesa
em 13.5 px `ink2`; botão de fechar 34×34.

Corpo, com scroll:
- itens — quantidade tabular 15 px/700 em coluna de 32 px, nome 15 px/600, preço 15 px/600 à
  direita; opções escolhidas indentadas 42 px em 13 px `ink2` ("Sabores: Calabresa, Portuguesa",
  "Borda: Catupiry +R$ 8,00"); cada item separado por borda inferior
- totais — "Itens", linha de frete, e **Total em 24 px/700** acima de borda `line-hi`; depois a
  linha de pagamento ("Pix · pago", "Dinheiro · troco para R$ 50,00")
- **Andamento** — caixa `surface2`, eyebrow uppercase, uma linha por etapa: ponto de 9 px
  (`accent` cumprida, `warn-strong` atual, `line-hi` futura), rótulo 13.5 px (700 na atual) e
  **horário real à direita, "—" quando ainda não aconteceu**. As etapas mudam por tipo:
  entrega tem "Saiu para entrega", retirada tem "Pronto para retirada", salão pula direto para
  "Concluído".

Rodapé: ação principal de 46 px em `accent` ("Aceitar pedido" / "Saiu para entrega" / "Pronto para
retirada" / "Concluir pedido"); abaixo, à esquerda a nota de consequência em 12.5 px `ink3` e à
direita o cancelamento em `danger` com contorno. Pedido encerrado troca tudo isso por uma caixa
`surface2`: *"Pedido concluído às 20:10. Não há mais ação possível."*

### 3. Modal de confirmação

Overlay `rgba(20,18,14,0.42)`, `z-index: 60`. Caixa de 460 px, fundo `surface`, borda `line`,
raio 10, `padding: 22px`. Título 18 px/700, corpo 14 px `ink2`, faixa de aviso opcional em
`warn-soft`/`warn` 13.5 px/700, e duas ações à direita ("Voltar" contornado, 40 px; confirmação
40 px na cor do risco).

Três usos, com textos diferentes — ver "Copy que não pode ser reescrita".

### 4. Modo cozinha

Tela para o tablet da bancada. Duas colunas (`minmax(330px, 1fr)`): **Entraram agora** e
**Fazendo**. Cartão com `border-left: 4px`, `padding: 16px`: código 22 px/700, tipo 15 px/600
`ink2`, tempo 17 px/700; itens em 21 px com quantidade em coluna de 46 px e opções em 17 px
indentadas 58 px; botão de 54 px ("Aceitar e começar" / "Pronto — despachar").

**Não mostra preço, total, forma de pagamento nem telefone.** A cozinha não decide dinheiro, e
cada dado a mais é uma linha para varrer com o olho no pico.

### 5. Produtos

Busca (260 px), chips de seção (pill 36 px, ativo `accent-soft`), "Novo produto" à direita em
`accent`.

Tabela em cartão de raio 10:
`grid-template-columns: minmax(150px,3fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr)`,
`gap: 12px`, `padding: 0 16px`, linha de 44 px, cabeçalho em `surface2` com rótulos 11 px
uppercase. Colunas: Produto (thumb 34 px `surface3` + nome 14 px/600 + descrição 12.5 px `ink3`),
Seção, **Preço** (direita, tabular/600), **Estoque** (direita — `danger` quando "esgotado",
`warn` quando ≤ 5, senão `ink`), Status (badge "Disponível" `accent-soft` / "Esgotado"
`danger-soft`).

Rodapé com contagem ("10 de 10 produtos") e paginação. Abaixo da tabela, 12.5 px `ink3`:
*"O estoque aparece só aqui. No cardápio público o cliente vê apenas disponível ou esgotado."*

### 6. Produto (criar/editar)

Duas colunas `minmax(0,1.15fr) minmax(0,1fr)`, `gap: 16px`, `max-width: 1180px`. Link "← Produtos"
acima.

**Esquerda — Dados do produto:** Nome; Descrição (textarea 3 linhas); linha de Preço / Estoque /
Seção em `minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr)`; URL da foto com a nota *"Ainda não há
upload de imagem: cole o endereço de uma foto já publicada."*

**Direita — Grupos de opções:** nota de que a ordem aqui é a ordem que o cliente vê e que os
grupos pertencem à loja. Cada grupo é um bloco `surface2` com setas ↑↓ de 26×22 à esquerda, nome
+ intervalo ("escolhe 1 a 2"), a regra em destaque ("**Mais caro** — cobra só a opção mais cara
das escolhidas") e **um exemplo em reais** em caixa `surface3`: "Margherita R$ 62 + Calabresa
R$ 72 → R$ 72,00". Depois, botão tracejado "Adicionar grupo já cadastrado".

Barra de salvamento sticky no rodapé: "Alterações não salvas" em `ink3`, "Cancelar" contornado,
"Salvar produto" em `accent`.

### 7. Resumo do dia

Grupo segmentado de período e "Fechamento parcial · atualizado há 6 s".

Três big numbers (`repeat(auto-fit, minmax(230px,1fr))`, cartão `padding: 16px 18px`): eyebrow,
valor 32 px/700 tabular, e uma linha de explicação — **Faturamento** ("de 6 pedidos aceitos —
inclui o frete cobrado"), **Pedidos aceitos** ("9 chegaram no período"), **Ticket médio**
("faturamento ÷ pedidos aceitos").

Tabela "Pedidos por status": `minmax(0,1.1fr) 64px minmax(0,3fr) 130px` — rótulo com ponto,
contagem 16 px/700, barra de 8 px em trilho `surface3`, e valor à direita (cancelados com
`— R$ …` em `danger`).

Rodapé "Como ler estes números", três notas em `surface2`:
1. **Faturamento conta de aceito em diante.** Pedido novo ainda não é venda e cancelado deixou de
   ser. São as vendas do período, não tudo que chegou.
2. **O frete entra no faturamento.** R$ 30 de comida + R$ 15 de entrega aparecem como R$ 45.
3. **O ticket médio mistura comida e frete.** Por isso ele não serve para decidir preço de
   cardápio.

**Barra superior e Resumo devem sair do mesmo cálculo.** No protótipo isso é uma função
`stats()` única; se forem duas fontes, os números divergem e o operador deixa de confiar nos dois.

### 8. Seções

`max-width: 760px`. Nota: *"A ordem é a ordem da refeição, não alfabética — e é exatamente o que o
cliente vê no cardápio."* Lista em cartão: setas ↑↓, posição tabular, nome 15 px/600 + contagem de
produtos, "Renomear" e "Remover" (`danger`). Rodapé `surface2` com campo + "Adicionar".

Nome repetido bloqueia, **ignorando maiúsculas**, com erro em `danger-soft` e borda do campo em
`danger-line`: *"Já existe uma seção «Bebidas». O nome não diferencia maiúsculas."*

Remover pede confirmação que diz o que **não** acontece: *"Os produtos dela não são apagados:
passam para um grupo «Sem categoria» no fim do cardápio, e continuam à venda."*

### 9. Grupos de opções

Cartão explicativo "Regra de preço — a escolha que muda o valor final", com as três regras lado a
lado, cada uma com exemplo em reais:
- **Somar** — "Bacon R$ 6,00 + Ovo R$ 3,00 = R$ 9,00" · adicionais, borda, bebida extra
- **Mais caro** — "Margherita R$ 62 + Calabresa R$ 72 = R$ 72,00" · meio a meio pelo sabor mais caro
- **Média** — "Margherita R$ 62 + Calabresa R$ 72 = R$ 67,00" · a outra convenção de meio a meio

Depois, um cartão por grupo: cabeçalho com nome 15.5 px/700, pill de intervalo, **pill da regra em
`accent-soft`** e "usado em 3 produtos" à direita; tabela de opções
(`minmax(0,2fr) 120px 120px 90px`) com Opção / Preço / Qtd. máx. / Editar; rodapé com
"+ Adicionar opção" tracejado.

### 10. Entrega

Alerta no topo quando o modo é bairro e a lista está vazia (mesmo texto do alerta de Pedidos).

**Como o frete é calculado** — três cartões-radio (`minmax(230px,1fr)`, 78 px de altura mínima):
Por bairro / Taxa fixa / **Por distância desabilitado** ("Ainda não disponível nesta versão",
`surface2`, `cursor: not-allowed`). Selecionado: fundo `accent-soft`, borda `accent-line`, bolinha
preenchida.

**Por bairro:** tabela `minmax(0,2fr) 130px 90px` com bairro, frete tabular e "Remover"; contagem
no cabeçalho; rodapé `surface2` com campo de bairro + campo de frete (110 px) + "Adicionar bairro".
Vazio: bloco central com *"Nenhum bairro cadastrado"* em `warn` e o texto de que **isto não é
entrega grátis**.

**Taxa fixa:** um campo de 40 px, `max-width: 320px`.

**Regras de valor** (`minmax(260px,1fr)`):
- Entrega grátis acima de — *"Compara com o valor dos itens, sem o frete. Uma sacola de R$ 115 +
  R$ 9 de frete não ganha a isenção."*
- Pedido mínimo — *"Vale só para entrega. Zero significa sem mínimo — retirada e salão nunca são
  afetados."*
- switch **Aceitar pedido com frete a combinar**, com ajuda que muda conforme o estado: ligado
  explica que o pedido entra sem o frete e o valor é acertado por telefone; desligado explica que
  o pedido de entrega é recusado na hora.

### 11. Horário de funcionamento

`max-width: 880px`. Nota: um dia pode ter mais de uma faixa; dia sem faixa é dia fechado.

Uma linha por dia: nome 14.5 px/600 em coluna de 104 px com o estado abaixo ("Fechado" `ink3`,
"Aberto" ou "2 faixas" em `accent-hi`); à direita, as faixas, cada uma com dois campos de hora de
82 px centralizados, "até" entre eles, "Remover faixa", e **quando o fim é menor que o início, o
chip "vira a madrugada"**; por fim "+ Adicionar faixa" tracejado.

Nota fixa: *"Faixa que termina antes de começar é normal, não erro: 18:00 até 02:00 é a pizzaria
que atende até as duas da manhã."*

No rodapé, o bloco âmbar "Parar de aceitar pedidos agora", que **é o mesmo interruptor do header**
— com o texto de que não mexe no horário cadastrado.

### 12. Mesas e QR

Nota: *"Renomear a mesa não invalida o adesivo: o QR continua funcionando. O que invalida é gerar
um código novo."*

Grid `repeat(auto-fill, minmax(215px,1fr))`. Cartão: checkbox de 18 px + rótulo 15 px/700;
QR de 104×104 em `surface2`; URL 11.5 px `ink3`; rodapé com "Renomear" e "Novo código" (`danger`),
divididos por borda. Selecionado: borda `accent-line`.

Barra de ações: "Selecionar todas" / "Limpar seleção" e **"Imprimir 3 adesivos"** — desabilitado
visualmente ("Selecione para imprimir", `surface2`/`ink3`) sem seleção. Último cartão do grid é o
formulário tracejado de cadastro.

"Novo código" pede confirmação forte: *"O adesivo que está na mesa para de funcionar imediatamente.
Quem apontar a câmera para o QR antigo não abre o cardápio."* + aviso *"Só faça isso se você vai
reimprimir e trocar o adesivo agora."*

Nota final: *"Para o adesivo impresso, use correção de erro média ou alta — o QR vai pegar gordura,
risco e luz ruim no salão."*

### 13. Modalidades e pagamento

`max-width: 720px`. Seis switches de 42×24 com rótulo 14.5 px/600 e ajuda 12.5 px: Entrega,
Retirada no balcão, Salão, Pix, Cartão, Dinheiro ("Habilita o campo de troco no pedido").
Nota: *"Sem nenhuma modalidade ligada a loja não recebe pedido nenhum, mesmo dentro do horário.
Ao menos uma precisa ficar ativa."*

### 14. Usuários (só owner)

Nota: *"Dono e equipe operam o painel do mesmo jeito. A diferença é só esta tela e a remoção do
restaurante."* Linhas de 58 px: avatar 32 px, nome + e-mail, badge de papel (Dono em `accent-soft`),
e "Remover" — **a própria conta mostra "você" em vez do botão**. Rodapé com convite (nome, e-mail,
select de papel, "Convidar"). Nota: *"Sem papel informado, o usuário nasce como equipe. Ninguém
remove a própria conta."*

### 15. Dados da loja

Duas colunas `repeat(auto-fit, minmax(300px,1fr))`.

**Identificação:** nome da loja; tipo de cozinha e fuso horário lado a lado; URL do logo (com a
mesma nota de ausência de upload); endereço.

**Zona destrutiva (só owner):** cartão com borda `danger-line`, título em `danger`, texto de que
apaga cardápio, mesas, usuários e histórico, e que o cardápio público sai do ar na hora; botão
"Remover restaurante" em `danger-soft`.

### 16. Login

Duas colunas iguais. Esquerda, coluna de 352 px: marca, "Entrar" 26 px/700, subtítulo, campos de
42 px, CTA de 46 px, e dois links ("Esqueci a senha", "Criar conta da loja"). Direita, painel
`surface2` com borda esquerda, explicando que sem e-mail confirmado o painel fica bloqueado.

### 17. Cadastro

Card de 620 px em duas seções separadas por divisor: **O restaurante** (nome, tipo de cozinha) e
**Seu acesso** (nome, e-mail, senha). O e-mail carrega a advertência: *"É para cá que vai o link
de confirmação, e não há como trocar depois pelo painel. Confira antes de criar."* CTA "Criar loja
e continuar" → tela de bloqueio.

### 18. Confirme o e-mail (bloqueio)

Coluna de 560 px, centralizada, **sem rail e sem header** — o painel está bloqueado, e mostrar a
navegação desabilitada só frustra.

Eyebrow âmbar "Painel bloqueado"; título 27 px/700; explicação de que nenhuma tela carrega até o
link ser aberto. Cartão com o endereço cadastrado (16 px/600) e o botão "Não recebi, reenviar".

Reenvio: mensagem de sucesso neutra; **a partir do 4º, o botão trava** em "Reenviar em 0:38"
(`surface2`/`ink3`) e aparece o aviso âmbar *"Aguarde um instante: são no máximo 3 reenvios por
minuto. O último link continua valendo."*

Bloco "O endereço está errado?": *"Não é possível trocar o e-mail pelo painel. Duas saídas: falar
com o suporte, ou aguardar 7 dias — nesse prazo o cadastro é liberado automaticamente e você entra
sem confirmar."* + "Falar com o suporte" (marcado com ↗) e "Sair da conta". No pé: "Já confirmou em
outra aba? **Verificar de novo**".

### 19. Esqueci / Nova senha

Duas colunas. **Etapa 1:** campo de e-mail, "Enviar link", e a resposta deliberadamente idêntica
exista a conta ou não: *"Se existir uma conta com esse e-mail, o link de redefinição chega em
alguns minutos."* — com a explicação de que isso é de propósito, para não revelar quem tem
cadastro. **Etapa 2:** nova senha + repetição, "Salvar e entrar", e a faixa âmbar *"Link expirado
ou já usado: peça outro na etapa 1. Cada link vale uma vez."*

### 20. Estados (página de referência — não implemente)

Catálogo dos nove estados desenhados, para consulta: bloqueio de e-mail, limite de reenvio, dois
vazios (sem pedidos / cardápio vazio), sessão expirada, sem internet, estoque acabou ao aceitar,
seção duplicada, permissão negada. **Implemente os estados nas telas onde eles ocorrem**, usando
estes textos.

Dois que merecem atenção porque não têm tela própria:
- **Sem internet** — *"A lista abaixo é de 40 segundos atrás e pode estar desatualizada. Aceitar e
  despachar ficam bloqueados até a conexão voltar — assim nada é aceito duas vezes."*
- **Estoque acabou ao aceitar** — *"Pizza Grande ficou sem unidades entre a chegada do pedido e o
  aceite. O pedido não foi aceito e o estoque não mudou. Reponha o estoque ou recuse explicando ao
  cliente."*

### 21. Direção visual (página de referência — não implemente)

Swatches, escala tipográfica e componentes base. Serve de fonte para o tema; não é tela de produto.

---

## Interactions & Behavior

- **Rail** troca de tela e fecha o drawer. No app real: rotas.
- **Cartão de pedido** abre o drawer; os botões do cartão **param a propagação** (`stopPropagation`)
  para não abrir o drawer ao aceitar.
- **Avanço de status** é linear: novo → preparo → pronto → concluído, com o rótulo do botão
  dependendo do tipo (entrega despacha, retirada fica pronta para retirada, salão vai direto a
  concluir).
- **Aceitar** sempre confirma. **Cancelar** sempre confirma, com texto diferente depois de pronto.
- **Drawer** fecha pelo ✕. Sem overlay, o kanban atrás continua clicável — intencional.
- **Reordenação** (seções, grupos, faixas de horário) por setas ↑↓, não drag — mais confiável no
  pico e acessível por teclado. Drag pode ser adicionado como atalho, nunca como único caminho.
- **Hover**: apenas `background`/`border-color`. Sem transform, sem sombra, sem transição.
- **Atualização**: o kanban se atualiza sozinho ("há 6 s"); o vazio de pedidos diz explicitamente
  *"A tela se atualiza sozinha e avisa com som quando o primeiro chegar. Não é preciso recarregar."*
- **Responsivo**: todas as trilhas de grid usam `minmax(0, …)` e os campos `width: 100%; min-width: 0`.
  O kanban rola na horizontal abaixo de ~1150 px em vez de comprimir os cartões.

## State Management

Estado do protótipo, por área:

| Estado | Tipo | Observação |
|---|---|---|
| `screen` | string | vira rota no app real |
| `detailId` | id \| null | pedido aberto no drawer |
| `confirm` | objeto \| null | `{kind, id, title, body, warn, cta, cores}` — quatro `kind`: `accept`, `cancel`, `secao`, `qr` |
| `period` / `rangeOn` | string / bool | mutuamente exclusivos |
| `mesaFiltro` | string | `'todas'` ou rótulo da mesa → `tableId` |
| `query` / `section` | string | busca e chip de Produtos |
| `paused` | bool | pausa manual, global |
| `groups` | array | ordem dos grupos no produto |
| `secs` | array | seções (ordem = ordem do cardápio) |
| `newSection` / `secError` | string | validação de duplicata |
| `freteMode` / `bairros` / `combinar` | string / array / bool | Entrega |
| `dias` | array | `[{name, faixas: [[from, to], …]}]` |
| `mesas` / `mesaSel` / `novaMesa` | array / array / string | Mesas e QR |
| `toggles` | objeto | modalidades e pagamento |
| `resends` / `resendLeft` / `resendMsg` | number / number / string | rate limit do reenvio |

Props externas (tweaks) que no app viram preferência do usuário ou estado de rede:
`theme` (claro/escuro), `density` (confortável/compacta), `role` (owner/staff), `paused`,
`alertaEntrega`, `carregando`.

Dados a buscar: pedidos com polling (ou websocket) e filtros de período/mesa; produtos com busca e
paginação; seções; grupos de opções; configuração de entrega, horário, modalidades; mesas com
token de QR; usuários. Os números do Resumo e do header devem vir do mesmo endpoint/cálculo.

---

## Copy que não pode ser reescrita

Estes textos existem porque a leitura errada custa dinheiro ou pedido. Traduza-os para o app
**literalmente**.

**Aceitar pedido** — "Aceitar manda o pedido para a cozinha e baixa o estoque dos itens." + aviso
"Não existe desconfirmar. Depois de aceito, só cabe cancelar."

**Cancelar antes de pronto** — "O pedido 1042 sai da lista e as unidades voltam para o estoque."
CTA: "Cancelar e devolver estoque".

**Cancelar depois de pronto** — "A comida do pedido 1035 já ficou pronta. As unidades usadas não
voltam para o estoque — só o pedido sai da lista." + aviso "O estoque NÃO será devolvido."
CTA: "Cancelar sem devolver". **Na estrutura atual os dois casos tinham o mesmo texto — é o erro
mais caro do fluxo.**

**Entrega sem bairro** — "Não é frete grátis: a loja não consegue calcular o frete e vai recusar
pedidos de entrega."

**Pausa manual** — "A loja não está recebendo pedidos novos. O horário cadastrado não foi alterado."

**Entrega grátis acima de X** — "Compara com o valor dos itens, sem o frete."

**Novo QR** — "O adesivo que está na mesa para de funcionar imediatamente."

**Remover seção** — "Os produtos dela não são apagados."

**Recuperação de senha** — resposta idêntica exista a conta ou não, de propósito.

---

## Problemas da estrutura atual corrigidos neste design

Vale preservar as correções na implementação:

1. Pausa manual saiu de Horário de Funcionamento e virou controle global no header.
2. Cancelamento passou a ter dois textos e duas confirmações, conforme o estoque volte ou não.
3. Aceite ganhou confirmação explícita de irreversibilidade.
4. Período e intervalo de datas passaram a ser mutuamente exclusivos na própria UI.
5. Entrega sem bairro virou alerta persistente em Pedidos, não erro de formulário.
6. Andamento do pedido passou a mostrar horário real por etapa, com "—" no que não aconteceu.
7. Pedido encerrado deixou de oferecer ações impossíveis.
8. Header e Resumo passaram a usar o mesmo cálculo, e o rótulo mudou de "Pedidos" para
   "Aceitos hoje" (antes contava os chegados e divergia do Resumo).
9. Modalidades e pagamento ganhou tela própria, com o aviso de que sem nenhuma ativa a loja não
   recebe pedido.
10. Frete passou a ter três representações distintas (cobrado / grátis R$ 0,00 / a combinar).

## Fora de escopo, de propósito

O que a API atual não oferece e por isso não foi desenhado: upload de imagem (só URL), impressão
de comanda, relatório histórico além do período, conta por mesa, chamar garçom, entrega por
distância. Se algum destes entrar, peça o desenho antes de improvisar.

---

## Mapa para Mantine

O protótipo **não usa Mantine** — é HTML com estilo inline, para renderizar num arquivo único.
A equivalência pretendida:

| Elemento do design | Mantine |
|---|---|
| Ação primária | `Button variant="filled" color="olive"` |
| Secundária | `Button variant="default"` |
| Destrutiva | `Button variant="light" color="red"` |
| Terciária / link | `Button variant="subtle"` |
| Badge de status | `Badge variant="light"` / `variant="outline"` |
| Pill de tipo com ponto | `Badge leftSection={<Indicator/>}` |
| Filtro de período | `SegmentedControl` |
| Chips de seção | `Chip.Group` |
| Campos | `TextInput`, `Textarea`, `NumberInput`, `Select`, `TimeInput` |
| Switch (pausa, modalidades, frete a combinar) | `Switch` |
| Cartões-radio de modo de frete | `Radio.Card` |
| Coluna do kanban / cartão | `Paper withBorder radius="md"` |
| Drawer do pedido | `Drawer position="right" size={472} withOverlay={false}` |
| Confirmações | `Modal` (ou `modals.openConfirmModal`) |
| Alertas | `Alert color="yellow"` / `color="red"` |
| Tabelas | `Table` |
| Andamento | `Timeline` ou lista própria |
| Esqueletos | `Skeleton animate={false}` |
| Rail | `AppShell.Navbar` + `NavLink` |
| Header | `AppShell.Header` |

Ajustes de tema necessários: `primaryColor` oliva (`#4A6B3A` como shade 6), `fontFamily: 'Figtree'`,
`defaultRadius: 'sm'` (6 px) com `radius="md"` (10 px) em painéis, `shadows` zerados,
`Table` com `verticalSpacing` que resulte em linha de 44 px, e `tabular-nums` aplicado a
números via classe utilitária.

---

## Assets

Nenhuma imagem no protótipo. Thumbnails de produto, logo e fotos são placeholders em `surface3`.
Fonte Figtree via Google Fonts (`https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700`)
— no app, auto-hospede ou use o pipeline de fontes do projeto.

Ícones: o protótipo usa caracteres (`↑ ↓ ✕ ← ↗ ✓`). Substitua pelo set de ícones do projeto
(`@tabler/icons-react`, que é o padrão do Mantine).

## Files

- `Painel da Loja.dc.html` — protótipo completo, 21 telas. Abre direto no navegador.
  A navegação fica no rail; o grupo "Protótipo" no fim dá acesso às telas fora do fluxo logado.
- `painel-da-loja.txt` — texto extraído do PDF de estrutura original (fonte da verdade sobre o
  que existe hoje: telas, fluxos, campos e endpoints).
