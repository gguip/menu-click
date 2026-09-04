# Grupos de opções no cardápio

**Data:** 2026-09-01
**Estado:** aprovado, pronto para virar plano de implementação

## O problema

O cardápio do MenuClick tem três níveis: `Categoria → Produto`. As plataformas do
mesmo nicho têm quatro: `Categoria → Item → Grupo de opções → Opção`.

A diferença não é cosmética. Sem o quarto nível, o sistema **não consegue vender**:

- pizza — que no padrão do mercado tem quatro grupos obrigatórios (tamanho, massa,
  borda, sabores);
- hambúrguer com "adicionar bacon +R$ 5";
- açaí com acompanhamentos;
- combo com "escolha o refrigerante";
- nem "ponto da carne", que não tem preço nenhum — é só uma escolha obrigatória.

É a diferença entre um cardápio de demonstração e um cardápio que uma pizzaria
consegue usar.

O levantamento que motivou esta spec está registrado em [Fontes](#fontes).

## Por que agora, e não depois do front

Grupos de opções mexem nas **duas tabelas centrais** — `products` ganha os grupos e
`order_items` precisa congelar as escolhas — e a montagem do carrinho é a tela mais
complexa do front. Construir o front contra o modelo de três níveis e migrar depois
significaria refazer o carrinho, o cálculo do total e a tela de acompanhamento.

Já taxa de entrega, horário de funcionamento e forma de pagamento (as outras
lacunas do levantamento) são aditivos: entram como campos e checagens, sem
reescrever o que existe. Por isso vêm depois, numa PR própria.

## Decisões fechadas

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Propriedade do grupo | **Reutilizável**, do restaurante, ligado aos produtos por tabela de junção | Reuso é o caso comum: "Tamanho", "Borda" e "Sabores" valem para todas as pizzas. Com grupo por produto, cadastrar a décima pizza recriaria 4 grupos e ~20 opções à mão, e mudar o preço do bacon viraria editar 30 lugares. |
| Regras de preço | `sum`, `highest`, `average` | `sum` é o caso comum; `highest` e `average` existem para meio a meio, e as duas práticas convivem no mercado. Fica de fora o `menor` da Delivery Direto: nenhum cardápio real usa, e seria comportamento com teste e documentação pendurados nele. |
| Repetir a mesma opção | **Sim**, quantidade por opção | Pedido do dono do projeto. "2× bacon" numa linha só, em vez de obrigar o cadastro de "Bacon duplo". |
| O que `min`/`max` do grupo contam | **Opções distintas**, com teto de unidades por opção | Dá controle fino ("até 2 sabores, no máximo 1 de cada") sem sobrecarregar um único número com dois sentidos. |
| Estoque de opção | **Não** — só `available` | A transação de confirmação é o código mais delicado do projeto (dois níveis de `select … for update` ordenados, com teste de corrida que precisou aquecer o pool). Uma terceira tabela travada ali é custo alto, e contar fatias de bacon é controle de insumo, não de cardápio. É também o que as plataformas do nicho fazem. |
| Formato no cardápio público | **Normalizado** | Como os grupos são reutilizáveis, eles são poucos (uma dezena por restaurante). Incluir cada um uma vez é barato; repeti-los dentro de cada produto multiplicaria a resposta — que já mede 1,9 MB numa seção grande do banco de dev. |

## Modelo de dados

Quatro tabelas novas. Três para o cardápio, uma para o congelamento no pedido.
Todas seguem as regras de `.claude/rules/database.md`: `timestamptz`, `uuid` com
`gen_random_uuid()`, soft delete em todas, índices parciais.

```sql
create table option_groups (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references restaurants (id),
  name          text        not null,
  -- 0 = grupo opcional; >= 1 = obrigatório. Um campo em vez de dois, e é a
  -- convenção do iFood ("grupo com mínimo 1 é obrigatório").
  min_options   integer     not null default 0,
  -- conta opções DISTINTAS, não unidades
  max_options   integer     not null,
  price_rule    text        not null check (price_rule in ('sum', 'highest', 'average')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table options (
  id              uuid        primary key default gen_random_uuid(),
  option_group_id uuid        not null references option_groups (id),
  name            text        not null,
  -- 0 cobre a escolha obrigatória sem custo ("ponto da carne"). O check não
  -- é decoração: o arredondamento de `average` é meio-para-cima em direção a
  -- +infinito, e portanto assimétrico no negativo. Ver "Aritmética de dinheiro".
  price_in_cents  integer     not null default 0 check (price_in_cents >= 0),
  -- teto de unidades DESTA opção. Default 1 faz "Sabores" já nascer impedindo
  -- 2x o mesmo sabor sem ninguém configurar nada.
  max_quantity    integer     not null default 1,
  available       boolean     not null default true,
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create table product_option_groups (
  id              uuid        primary key default gen_random_uuid(),
  product_id      uuid        not null references products (id),
  option_group_id uuid        not null references option_groups (id),
  -- a ordem em que o grupo aparece NAQUELE produto
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create table order_item_options (
  id              uuid        primary key default gen_random_uuid(),
  order_item_id   uuid        not null references order_items (id),
  -- referência histórica: o pedido NÃO a consulta para se exibir
  option_id       uuid        not null references options (id),
  -- cópias congeladas
  group_name      text        not null,
  name            text        not null,
  price_in_cents  integer     not null,
  quantity        integer     not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
```

### Índices

```sql
create unique index option_groups_name_active_key
  on option_groups (restaurant_id, lower(name)) where deleted_at is null;

create index option_groups_active_by_restaurant_idx
  on option_groups (restaurant_id, name, id) where deleted_at is null;

create index options_active_by_group_idx
  on options (option_group_id, position, name, id) where deleted_at is null;

create unique index product_option_groups_active_key
  on product_option_groups (product_id, option_group_id) where deleted_at is null;

create index product_option_groups_active_by_product_idx
  on product_option_groups (product_id, position, id) where deleted_at is null;

create index order_item_options_by_item_idx
  on order_item_options (order_item_id, id) where deleted_at is null;
```

O único parcial do nome de grupo usa `lower(name)` pelo mesmo motivo do de
categoria: "Adicionais" e "adicionais" no mesmo restaurante são a mesma coisa
digitada duas vezes.

### A junção leva `deleted_at`

`product_option_groups` é um vínculo, não um registro com história — desvincular
"Adicionais" de um hambúrguer não perde nada, porque pedidos antigos guardam
cópias. Ainda assim ela carrega `deleted_at`, porque a D1 é absoluta: nenhum
`delete from` no código da aplicação. O custo é o índice único **parcial**, sem o
qual desvincular e revincular colidiria (D6).

Carvar exceção na regra custaria mais do que o índice.

## Cálculo de preço

Por grupo escolhido dentro de um item:

| `price_rule` | Contribuição do grupo |
| --- | --- |
| `sum` | Σ (preço da opção × quantidade) |
| `highest` | o maior **preço unitário** entre as opções escolhidas (a quantidade não entra) |
| `average` | Σ(preço × qtd) ÷ Σ(qtd) — a única que produz fração |

```
preçoUnitárioDoItem = arredonda( produto.preço + Σ contribuição exata de cada grupo )
totalDoItem         = preçoUnitárioDoItem × item.quantidade
```

Dois hambúrgueres com bacon cobram o bacon duas vezes — que é o esperado.

`highest` e `average` sobre uma opção repetida degradam para o preço dela — "até 2
sabores" com 2× Calabresa dá uma pizza inteira de calabresa pelo preço da
calabresa, que é o resultado certo.

O total do pedido continua **calculado no servidor**. `totalInCents` não existe no
schema do corpo, e as opções não mudam isso.

## Aritmética de dinheiro

Só a regra `average` produz fração de centavo, e ela **não é caso raro**: em preços
realistas de cardápio (R$ 5 a R$ 120, terminados em 0 ou 5 centavos), metade das
combinações de dois sabores cai em meio centavo exato. Cada decisão abaixo foi
medida, não deduzida.

### O arredondamento acontece UMA vez, no preço unitário

Três lugares eram possíveis, e os outros dois estão errados por motivos diferentes:

| Onde | O que acontece |
| --- | --- |
| por grupo, antes de somar | **viés sistemático para cima**: 1 centavo por grupo em meio centavo, por unidade. Medido: 3 grupos × 10 unidades = 10 centavos a mais. |
| no total do item | o recibo **deixa de fechar**: `unitário × quantidade ≠ total`. Medido: até 5 centavos de divergência com 10 unidades, crescendo linearmente. |
| **no preço unitário, uma vez** | o recibo fecha, e o desvio fica limitado a meio centavo por unidade. |

O critério que desempata é o recibo. Toda nota fiscal do mundo mostra
`quantidade × preço unitário = total`, e um total que não bate com essa conta é lido
como erro por quem confere — além de ser o preço unitário que foi mostrado na tela
no momento da escolha.

### A conta é feita em inteiros, sem passar por float

Verificado que `Math.round(n / d)` concorda com aritmética inteira exata em 103 mil
combinações nas nossas magnitudes — inclusive nos quocientes que caem exatamente em
`.5`, que a divisão IEEE-754 representa sem erro. Ou seja: o float **não** é o
problema aqui.

Mesmo assim a implementação usa inteiros:

```ts
/** Arredonda n/d para o inteiro mais próximo, meio para cima, sem float. */
function dividirArredondando(n: number, d: number): number {
  return Math.floor(n / d) + (2 * (n % d) >= d ? 1 : 0);
}
```

Não é desconfiança do resultado medido — é remover a classe inteira de dúvida de
graça. Uma equivalência verificada hoje, em faixas de valor de hoje, é mais frágil
que uma propriedade que não depende de faixa nenhuma.

### Preço de opção não pode ser negativo

`options.price_in_cents` ganha `check (price_in_cents >= 0)`.

O motivo é o arredondamento: `Math.round` é meio-para-**cima em direção a +∞**, e
portanto assimétrico no negativo — `Math.round(-2.5)` é `-2`, não `-3`. Com preços
não-negativos essa assimetria nunca é alcançada, e o `check` transforma isso numa
garantia estrutural em vez de uma coincidência.

⚠️ Isso fecha a porta para "sem queijo −R$ 2,00" como opção de desconto. É
consciente: desconto é outro assunto (cupom, promoção), e abrir preço negativo
aqui obrigaria a revisitar o arredondamento antes.

Note que este `check` **não** contradiz a ausência deliberada de
`check (stock >= 0)` em `products`: lá a constraint esconderia o sintoma de uma
race condition que o teste precisa enxergar. Aqui não há corrida nenhuma — preço
negativo é entrada sem sentido, e recusá-la no banco não esconde nada.

### O recibo não pode somar os preços das opções

Para `sum`, os preços das opções são parcelas e somam. Para `highest` e `average`,
eles são **entradas de uma fórmula**, não parcelas.

Medido: uma pizza de R$ 30,00 com sabores de R$ 45,05 e R$ 50,00 custa R$ 77,53 na
regra `average`. Um cliente que montasse o recibo somando as opções cobraria
R$ 125,05 — **R$ 47,52 a mais**.

Por isso `order_items` ganha `unit_price_in_cents`: o preço unitário **já calculado
e congelado**, ao lado do `price_in_cents` do produto. A API devolve os dois, e
nenhum cliente precisa (nem deve) recompor a conta. O total do pedido passa a ser
verificável como `Σ (unit_price_in_cents × quantity)`.

## Congelamento no pedido

`order_items` ganha uma coluna:

```sql
alter table order_items
  -- o preço unitário JÁ com as opções, calculado e congelado. Sem ele, ler o
  -- pedido exigiria refazer as regras de preço no cliente — e somar as opções
  -- (o caminho ingênuo) erra por R$ 47,52 numa pizza. Ver "Aritmética de dinheiro".
  add column unit_price_in_cents integer not null default 0;
```

`price_in_cents` **continua sendo o preço do produto**, sem as opções; o novo
`unit_price_in_cents` é o que foi efetivamente cobrado por unidade. Os dois juntos
tornam a conta conferível sem recompô-la:
`total do pedido = Σ (unit_price_in_cents × quantity)`.

As escolhas ficam nas linhas filhas de `order_item_options`, com o nome do grupo
copiado junto.

É o formato de um cupom fiscal:

```
1x Pizza Grande ............ R$ 77,53      ← unit_price_in_cents
   produto .................. R$ 30,00      ← price_in_cents
   Sabores: Calabresa, Portuguesa           (regra 'average': não somam)
   Adicionais: 2× Bacon                     (regra 'sum': somam)
```

Sem a cópia de `group_name` não dá para reconstruir o agrupamento na tela de
acompanhamento — só a lista solta de opções.

Vale a mesma regra do item: nenhuma leitura de pedido junta `options`. Reajustar o
preço de um adicional não mexe em pedido antigo.

## 🚨 A regra de fusão de linhas muda

Hoje `services/orders.ts` funde duas linhas do mesmo produto numa só, somando a
quantidade. O comentário no código explica o porquê: evitar travar e debitar o
mesmo produto duas vezes na mesma transação de confirmação.

**Com opções, essa fusão passa a estar errada.** "1× hambúrguer com bacon" e
"1× hambúrguer sem bacon" são duas linhas legítimas; fundi-las produziria
"2× hambúrguer" e o cliente receberia dois iguais.

A chave de fusão passa a ser **produto + conjunto de opções escolhidas**
(normalizado: os pares `optionId:quantidade` ordenados por `optionId`). Linhas
idênticas em tudo continuam fundindo; linhas que diferem nas opções, não.

### Consequência na confirmação de estoque

Como agora podem existir várias linhas do mesmo produto no mesmo pedido, a
conferência de estoque tem que **somar a quantidade por produto** antes de comparar
com o disponível — em vez de conferir linha a linha.

Sem isso, duas linhas de 3 unidades passariam por uma checagem de "tem 4?" que cada
uma vê como suficiente, e o débito levaria o estoque a −2.

O débito em si já roda com a linha travada, então continua correto; o que precisa
mudar é a **conferência prévia**, que é justamente a que o projeto faz "antes de
qualquer débito" para deixar a regra explícita.

⚠️ Isto precisa de teste próprio: um pedido com duas linhas do mesmo produto,
opções diferentes, somando mais que o estoque. Ele deve dar 409.

## Cascatas de remoção

Todas explícitas e transacionais (D3) — não há `on delete cascade` no projeto,
porque ele nunca dispararia.

| Remover | Marca junto, na mesma transação |
| --- | --- |
| restaurante | os grupos dele, as opções desses grupos e os vínculos dos produtos dele |
| grupo de opções | as opções dele e os vínculos dele com qualquer produto |
| opção | nada |
| produto | os vínculos dele com grupos |

A remoção do restaurante hoje já cascateia para produtos e categorias; passa a
alcançar também os grupos. Sem isso, um grupo órfão continuaria vivo apontando para
um restaurante removido.

Uma opção removida **não** desaparece dos pedidos que já a continham: as linhas de
`order_item_options` guardam cópias, e a `option_id` é referência histórica que
nenhuma leitura de pedido consulta.

## Cardápio público

`GET /menu/:slug/products` ganha os grupos **normalizados**, fora dos produtos:

```json
{
  "data": [
    {
      "id": "…",
      "name": "Pizzas",
      "products": [
        {
          "id": "…",
          "name": "Pizza Grande",
          "priceInCents": 4500,
          "available": true,
          "optionGroupIds": ["grupo-tamanho", "grupo-sabores"]
        }
      ]
    }
  ],
  "optionGroups": [
    {
      "id": "grupo-sabores",
      "name": "Sabores",
      "minOptions": 1,
      "maxOptions": 2,
      "priceRule": "highest",
      "options": [
        { "id": "…", "name": "Calabresa", "priceInCents": 0, "maxQuantity": 1 }
      ]
    }
  ],
  "limit": 20,
  "offset": 0,
  "total": 3
}
```

`optionGroups` traz só os grupos referenciados pelos produtos **daquela página**, e
cada um uma vez. Opção indisponível não sai — o cliente não deve ver o que não pode
escolher.

### Disponibilidade do produto

`available` deixa de ser só `stock > 0`:

```
available = stock > 0
            E todo grupo obrigatório do produto tem ao menos
              `min_options` opções disponíveis
```

É a regra do iFood ("o item nem aparece à venda enquanto não houver opção para o
usuário selecionar"). Uma pizza cujo grupo "Sabores" ficou sem nenhuma opção
disponível não pode ser pedida, e o cardápio precisa dizer isso antes de a pessoa
montar o carrinho.

## Criação de pedido

### Corpo

```json
{
  "type": "delivery",
  "customer": { "name": "…", "phone": "…" },
  "items": [
    {
      "productId": "…",
      "quantity": 1,
      "options": [{ "optionId": "…", "quantity": 2 }]
    }
  ]
}
```

`options` é opcional e default `[]`.

### Validação

Por item, contra os grupos ligados àquele produto:

| Situação | Resposta |
| --- | --- |
| opção que não pertence a nenhum grupo do produto | **400** |
| grupo obrigatório sem `min_options` escolhas distintas | **400** |
| mais opções distintas que o `max_options` do grupo | **400** |
| quantidade acima do `max_quantity` da opção | **400** |
| opção com `available = false` | **400** |
| `optionId` fora do formato uuid | **400** |

Tudo `ValidationError` → **400**, e não 404: o corpo do pedido é uma montagem que o
cliente fez a partir do cardápio, então o que falha é a montagem, não um recurso
ausente. (O produto inexistente continua **404**, como hoje.)

Opções repetidas dentro do mesmo item **somam a quantidade antes** de checar o
teto — mesma política que já vale para produtos repetidos.

## Rotas

```
POST   /restaurants/:restaurantId/option-groups
GET    /restaurants/:restaurantId/option-groups
GET    /restaurants/:restaurantId/option-groups/:id
PATCH  /restaurants/:restaurantId/option-groups/:id
DELETE /restaurants/:restaurantId/option-groups/:id

POST   /restaurants/:restaurantId/option-groups/:groupId/options
PATCH  /restaurants/:restaurantId/option-groups/:groupId/options/:id
DELETE /restaurants/:restaurantId/option-groups/:groupId/options/:id

PUT    /restaurants/:restaurantId/products/:id/option-groups
```

Todas exigem sessão (o padrão do projeto) e nenhuma é `ownerOnly`: mexer no
cardápio é trabalho de quem opera, não só do dono — igual a produtos e categorias.

O parâmetro **precisa** chamar `restaurantId`: é o nome que o hook procura para
comparar com a sessão (S18).

**Não há rota de leitura de opção isolada.** `GET .../option-groups` e
`GET .../option-groups/:id` já trazem as opções de cada grupo aninhadas — uma opção
fora do grupo dela não significa nada, e uma rota para buscá-la sozinha só existiria
para ser ignorada. A listagem de grupos segue o envelope paginado das demais.

### Validação de entrada dos grupos

- `max_options >= 1` e `max_options >= min_options` — o inverso descreveria um
  grupo impossível de satisfazer, e ele só apareceria como um pedido que nunca
  fecha. **400.**
- `min_options >= 0`.
- `max_quantity >= 1` na opção.
- nome de grupo repetido no restaurante (sem diferenciar maiúscula) → **409**,
  mesma política de categoria.

### O `PUT` do vínculo

`PUT /restaurants/:restaurantId/products/:id/option-groups` recebe
`{ "optionGroupIds": ["…", "…"] }` e define a **lista ordenada completa** de grupos
daquele produto: soft delete nos vínculos ausentes, insert nos novos, tudo na mesma
transação.

Uma rota em vez de três (vincular, desvincular, reordenar) porque é como uma tela
faz — marca as caixas e arrasta a ordem —, é idempotente, e a posição sai do índice
do array sem campo extra. Revincular um grupo desvinculado insere linha nova, o que
o índice único parcial permite.

- Grupo de outro restaurante na lista → **404**, como todo recurso alheio (S19).
- Id repetido na lista → **400**: a mesma tela não consegue produzir isso, e
  aceitar em silêncio (deduplicando) esconderia um erro do cliente.
- Lista vazia é válida e desvincula tudo.

## Testes

Além do caminho feliz de cada rota:

- **As três regras de preço**, com números conferidos à mão.
- **A aritmética de dinheiro**, com os casos medidos nesta spec: que o
  arredondamento acontece uma vez no unitário (e não por grupo nem no total), que
  `unitário × quantidade` fecha com o total do pedido, e que `dividirArredondando`
  concorda com a divisão exata. Um teste que percorre uma faixa de preços e
  compara as duas estratégias vale mais que três exemplos escolhidos a dedo.
- **Preço negativo de opção é recusado** pelo banco.
- **A fusão de linhas**: mesmo produto com opções diferentes gera duas linhas;
  mesmo produto com opções idênticas funde.
- **A conferência de estoque somada por produto**: duas linhas do mesmo produto,
  opções diferentes, somando mais que o estoque → 409.
- **Cada regra de validação**, uma a uma.
- **Disponibilidade**: produto com grupo obrigatório sem opção disponível sai como
  `available: false` no cardápio e é recusado na criação.
- **Congelamento**: mudar o preço de uma opção não muda pedido já criado.
- **Escopo**: grupo e opção de outro restaurante são 404.
- **Cascatas**: remover o restaurante alcança grupos, opções e vínculos; remover um
  grupo alcança as opções e os vínculos dele; remover um produto alcança os
  vínculos dele.
- **`authorization.test.ts`** cobre as rotas novas automaticamente (elas não entram
  na lista de públicas).

Cada garantia acima passa pelo teste de mutação do projeto: quebrar o código que a
sustenta tem que fazer o teste falhar. Garantia cuja mutação não acusa é
documentada como tal, em vez de prometer o que não entrega.

## Fora de escopo

Deliberadamente adiados, e nenhum deles bloqueia esta implementação:

- **Estoque por opção** (decidido acima).
- **Regra de preço `menor`** da Delivery Direto.
- **Módulo de pizza dedicado**, onde o preço sai da relação tamanho × sabor em vez
  de das regras genéricas. As três regras cobrem o caso comum; a matriz é outro
  desenho.
- **Grupos condicionais** (um grupo que só aparece se outra opção foi escolhida).
- **Taxa de entrega, horário de funcionamento e forma de pagamento** — a PR
  seguinte, e a razão de ela vir depois está em [Por que agora](#por-que-agora-e-não-depois-do-front).

## Fontes

- [Delivery Direto — modelo de dados do cardápio](https://developers.deliverydireto.com.br/docs/entidades-processos/menu/) — a estrutura `Categoria → Item → Variação → Opção` e os tipos de cálculo
- [iFood Developer — catálogo](https://developer.ifood.com.br/pt-BR/docs/guides/catalog/v1/) — grupo com mínimo 1 é obrigatório, e o item não aparece à venda sem opção
- [iFood Developer — ciclo de vida do pedido](https://developer.ifood.com.br/en-US/docs/guides/order/workflow/) — confirma que a máquina de status atual já está alinhada
- [Saipos — cadastro de pizzas](https://meajuda.saipos.com/hc/pt-br/articles/20211669958676-Cadastro-de-pizzas-no-card%C3%A1pio) — os quatro grupos obrigatórios de uma pizza
