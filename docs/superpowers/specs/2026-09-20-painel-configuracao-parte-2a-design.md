# Painel da loja, parte 2a — configuração direta — desenho

**Data:** 2026-09-20 · **Estado:** aprovado, não implementado (branch `feat/painel-configuracao`)

## O problema

A parte 1 entregou o que a loja toca todo dia: entrar, receber pedido, mexer no
cardápio. O que ela configura — e que decide se o pedido chega — continua fora
do painel. Hoje, pelo painel, a loja **não consegue**: dizer que horas abre,
ligar ou desligar uma modalidade, escolher as formas de pagamento que aceita,
nem corrigir o próprio endereço.

Duas dessas lacunas são caras de um jeito silencioso:

- **Restaurante criado depois da migration de backfill nasce sem grade de
  horário** — e "dia sem faixa é dia fechado". Sem a tela, a loja nova fica
  fechada nas três modalidades e não tem como abrir.
- **O cadastro criado pelo painel nasce com Entrega desligada** (decisão da
  parte 1, para não entregar de graça). Sem a tela de Modalidades, não há como
  ligá-la depois.

Fontes deste desenho: o handoff (`docs/design/painel-da-loja/README.md`, telas
11, 13 e 15), a spec da parte 1
(`docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md`) e o
contrato em `apps/api/openapi.json`.

## O corte: 2a e 2b

A parte 2 do plano original tinha cinco telas. Entrega e Grupos de opções
concentram quase toda a regra (frete por bairro, "a combinar", pedido mínimo;
CRUD aninhado com as três regras de preço), então elas saem numa parte própria:

| Parte | Telas |
| --- | --- |
| **2a — este documento** | Modalidades e pagamento, Horário de funcionamento, Dados da loja |
| 2b | Entrega, Grupos de opções |

As três desta parte têm em comum a forma: leem o restaurante que a casca já
mantém em cache e escrevem por `PATCH /restaurants/:id` — exceto a grade de
horário, que é outro recurso.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Como salvar | **Misto**: interruptor salva sozinho; grade e formulário têm barra de salvar |
| Vale-refeição | **Entra** como quarto interruptor de pagamento (o handoff desenhou três) |
| Nenhuma modalidade ligada | **Permitido**, com aviso âmbar fixo |
| Sobreposição de faixas de horário | **Não é erro** — a tela só barra o que a API barra |
| Slug em Dados da loja | **Visível e desabilitado**, com o porquê |
| Fuso horário | **Lista fechada** de zonas brasileiras |
| Zona destrutiva | **Entra**, só para `owner`, confirmada digitando o nome da loja |
| Depois de remover a loja | **Encerra a sessão** e volta ao login |

## Arquitetura

### Três telas, um grupo novo no rail

`Configuração` entra abaixo de `Operação`, com **Modalidades**, **Horário** e
**Dados da loja** — nesta ordem. Entrega entra no mesmo grupo na 2b.

Rotas dentro do `PanelLayout` que já existe, cada uma com `handle: { title }`:

| Rota | Título |
| --- | --- |
| `/modalidades` | Modalidades e pagamento |
| `/horario` | Horário de funcionamento |
| `/dados-da-loja` | Dados da loja |

### O que passa a ser compartilhado

Hoje só o formulário de produto tem barra de salvar, e duplicá-la em duas telas
novas seria o começo de três cópias que divergem:

- **`src/ui/SaveBar.tsx`** — a barra fixa com "Alterações não salvas",
  "Cancelar" e o botão de salvar, extraída do `ProductFormPage`, que passa a
  usá-la. Os testes do produto são o que prende essa extração.
- **`src/features/restaurant/useUpdateRestaurant.ts`** — um `useMutation` de
  `PATCH /restaurants/:id` que grava a resposta no cache da query do
  restaurante. Modalidades, Dados da loja e (na 2b) Entrega usam o mesmo.

As três telas leem o restaurante por `useRestaurant()` — a query que a casca já
mantém —, sem buscar de novo. O horário tem query própria,
`["opening-hours", restaurantId]`, porque é outro recurso.

**Papel:** só a zona destrutiva de Dados da loja é de `owner`. O resto é igual
para dono e equipe; a API responde 403 apenas no `DELETE`.

## Horário de funcionamento

### O modelo, e por que ele é traduzido

A API guarda uma lista plana de `{ weekday, opensAt, closesAt }` e o `PUT`
**substitui a grade inteira**. A tela pensa em sete dias, cada um com N faixas.

Um módulo puro, `features/settings/openingHours.ts`, faz a tradução e a regra:
`fromApi`, `toApi`, adicionar e remover faixa, alterar hora, `crossesMidnight`,
`validate`, e o resumo do dia ("Fechado" / "Aberto" / "2 faixas"). Nada de
React mora nele — é onde ficam os testes.

⚠️ **A API numera `0 = domingo`** (é o `dow` do Postgres), e a tela mostra a
semana começando na segunda, como o handoff. A conversão vive no módulo, num
lugar só.

### A grade

Uma linha por dia: nome do dia com o estado embaixo, e à direita as faixas —
dois campos de hora com "até" entre eles, "Remover faixa", e o chip **"vira a
madrugada"** quando o fim é menor que o começo. Fecha com "+ Adicionar faixa"
tracejado.

**Dia sem faixa é dia fechado.** Não existe interruptor de "fechado": ele
permitiria o estado incoerente de "fechado, das 11 às 15", e a ausência já é
informação suficiente.

### A validação é só o que a API recusa

O banco tem **um** check: `opens_at <> closes_at` (faixa de duração zero não
significa nada). **Sobreposição entre faixas do mesmo dia não é erro para a
API**, então a tela não a barra — inventar uma regra que o servidor aceita cria
uma proibição fantasma que ninguém consegue explicar.

A tela barra, antes do `PUT`: hora vazia ou incompleta, e a igualdade — com a
mensagem nomeando o dia.

⚠️ **Faixa invertida é normal, não erro** — `18:00–02:00` é a pizzaria que
atende até as duas. A nota fixa do handoff diz isso, e o chip reforça.

### Salvar

`PUT` da grade inteira, pela `SaveBar`. Nada sai enquanto a pessoa digita: uma
hora pela metade (`1`, `18:`) viraria uma grade quebrada no servidor, e o `PUT`
substitui tudo o que estava lá.

### A pausa manual no rodapé

É o **mesmo** `PauseSwitch` do header, dentro do bloco âmbar, com o texto de que
não mexe no horário cadastrado. Um segundo controle com estado próprio seria uma
segunda fonte de verdade para a mesma coluna.

## Modalidades e pagamento

`max-width: 720px`, sete interruptores em dois blocos, com a ajuda literal do
handoff:

| Interruptor | Ajuda |
| --- | --- |
| Entrega | Frete e área atendida ficam na tela de Entrega |
| Retirada no balcão | O cliente busca no endereço da loja |
| Salão | Pedido pela mesa, com QR code |
| Pix | Pago antes da confirmação |
| Cartão | Na entrega ou no caixa |
| Dinheiro | Habilita o campo de troco no pedido |
| **Vale-refeição** | Exige credenciamento com a bandeira — ligue só se a loja já aceita |

⚠️ **Vale-refeição não está no handoff**, que desenhou três formas de pagamento.
A API tem a quarta flag (`acceptsMealVoucher`), e sem o interruptor a loja não
teria como ligá-la por lugar nenhum. Ele nasce desligado, como no cadastro.

**Cada interruptor salva sozinho**: o estado novo aparece na hora e volta atrás
se o `PATCH` falhar, com a mensagem ao lado do controle — o mesmo comportamento
da pausa do header. Barra de salvar aqui obrigaria dois cliques para ligar uma
modalidade.

**Nenhuma modalidade ligada é um estado permitido**, com o aviso âmbar fixo do
handoff: *"Sem nenhuma modalidade ligada a loja não recebe pedido nenhum, mesmo
dentro do horário. Ao menos uma precisa ficar ativa."* A API aceita, e travar o
último interruptor brigaria com quem está suspendendo as vendas.

**Entrega ligada sem frete configurado** mostra a mesma condição que o kanban já
vigia (modo bairro sem nenhum bairro), reaproveitando o `useDeliveryAlert` da
parte 1: o pedido de entrega seria recusado em silêncio. O link para a tela de
Entrega aparece quando ela existir, na 2b.

## Dados da loja

**Duas colunas.** À esquerda, **Identificação**: nome, tipo de cozinha e fuso
lado a lado, URL do logo (com a nota de que não há upload nesta versão) e o
endereço em seis campos.

**O slug aparece desabilitado**, com o endereço público da loja e a nota de que
ele é a URL dentro do QR code impresso. A API não o aceita no `PATCH` de
propósito; mostrá-lo em cinza explica por quê, e escondê-lo deixaria a pessoa
procurando onde se muda.

**O fuso é uma lista fechada** das zonas brasileiras (`America/Sao_Paulo`,
`America/Bahia`, `America/Fortaleza`, `America/Recife`, `America/Belem`,
`America/Manaus`, `America/Cuiaba`, `America/Porto_Velho`,
`America/Rio_Branco`, `America/Noronha`), com a nota de que é ele que decide
onde o dia começa — "pedidos de hoje" e o faturamento do header mudam junto.
Texto livre aqui só serviria para digitar um nome que o Postgres recusa.

**Salvar** pela `SaveBar`, mandando só os campos alterados; o endereço vai
inteiro, porque a API o recebe como objeto.

### A zona destrutiva

Só para `owner` — para `staff` o cartão **não é renderizado**, já que a API
responde 403 e um botão morto é pior que a ausência.

Cartão com borda vermelha e o texto do handoff sobre o que se perde: cardápio,
mesas, usuários e histórico, com o cardápio público fora do ar na hora.

**A confirmação pede o nome da loja digitado**, não um "tem certeza?": é a única
ação do painel que não tem volta.

⚠️ **Depois do `DELETE`, o painel encerra a sessão e vai para `/login`** com o
aviso de que o restaurante foi removido. A remoção marca o restaurante e as
filhas, mas **não** toca no usuário nem na sessão (ver `remove()` em
`services/restaurants.ts`): ficar no painel deixaria a pessoa numa casca pedindo
um restaurante que já não existe.

## Testes

**Puros** (`openingHours.ts` e os helpers): ida e volta `fromApi`/`toApi` sem
perder nada; adicionar e remover faixa; dia sem faixa sai do corpo do `PUT`;
`crossesMidnight`; validação de hora incompleta e de igualdade; a ordem
segunda-a-domingo contra a numeração `0 = domingo`.

**Componente:**

- **Horário** — acrescentar faixa manda o `PUT` com a grade inteira; igualdade
  bloqueia antes da chamada; o chip aparece em `18:00–02:00`; dia esvaziado não
  aparece no corpo.
- **Modalidades** — o interruptor manda o `PATCH` com um campo só; a falha volta
  o estado e mostra o erro; com tudo desligado, o aviso âmbar aparece; o
  interruptor de vale-refeição existe.
- **Dados da loja** — o slug está desabilitado; o `PATCH` leva só o que mudou; a
  zona destrutiva não é renderizada para `staff`; a confirmação só libera com o
  nome certo; o `DELETE` bem-sucedido limpa a sessão e leva ao `/login`.

**Regressão consciente:** a `SaveBar` sai de dentro do formulário de produto. Os
testes do produto continuam como estão e são o que prende a extração — se ela
quebrar algo, quebra lá primeiro.

## Repo

Nenhuma dependência nova. O CI já roda o painel. O rail ganha o grupo
`Configuração`, o `router.tsx` ganha três rotas, e a seção do painel no
`CLAUDE.md` ganha três regras: a grade de horário é `PUT` inteiro (por isso tem
barra de salvar), interruptor salva sozinho com volta atrás, e remover a loja
encerra a sessão.

## Fora de escopo, de propósito

- **Entrega e Grupos de opções** — parte 2b.
- **Mesas e QR, Usuários, Resumo do dia, Modo cozinha** — parte 3.
- **Trocar o e-mail de um usuário** e **editar o slug**: a API não tem rota, e a
  spec da parte 1 já registra os dois como pergunta de produto em aberto.
- **Upload de imagem**: logo continua sendo uma URL colada.
