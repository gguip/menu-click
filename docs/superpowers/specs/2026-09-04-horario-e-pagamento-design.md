# Horário de funcionamento, pausa e forma de pagamento

**Data:** 2026-09-04
**Estado:** aprovado, pronto para virar plano de implementação

## O problema

Duas lacunas que o levantamento das plataformas do nicho apontou, e que hoje têm sintoma diário:

**Dá para pedir às 4 da manhã.** `restaurants` não tem nenhuma coluna de horário. O restaurante descobre o pedido quando abre, e o cliente descobre que não vai comer quando ninguém responde.

**O restaurante recebe o pedido sem saber como vai ser pago.** `orders` não tem nenhuma coluna de pagamento. No Brasil o grosso do delivery é pago na entrega — e o entregador sai sem saber se precisa de troco.

As duas são "o restaurante configura, e o pedido respeita", que é o mesmo formato de `isDelivery`/`isTakeaway`/`isQrcode`. Por isso andam juntas.

## O que fica de fora, e por quê

- **Taxa de entrega e geocodificação** — PR própria. É onde mora todo o risco (dependência externa com política que bane quem viola, cache obrigatório, endpoint público novo, três modos de cálculo). Misturá-la aqui faria o revisor da parte perigosa gastar atenção com horário de funcionamento.
- **Pedido mínimo** — comum no mercado, ninguém pediu. Bloqueia pedido como o horário, então cabe aqui no dia em que for pedido.
- **Horário por modalidade** (salão aberto, delivery fechado) — é outro conceito, e nenhum restaurante pediu ainda.
- **Exceções por data** (feriado, férias) — exigiria uma segunda tabela e uma regra de precedência. Decidido conscientemente: as faixas por dia da semana cobrem a operação normal.
- **Pagamento online** — exige gateway, credenciais, webhook, conciliação e estorno. Uma PR inteira, e provavelmente a maior do projeto.

## Decisões fechadas

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Estrutura do horário | **faixas por dia da semana, várias por dia** | restaurante que fecha entre almoço e jantar é o caso comum; com uma faixa por dia ele declararia 11:00–23:00 e aceitaria pedido às 16:00 |
| Pausa manual | **sim**, chave no restaurante | cozinha lotada e falta de insumo são o caso mais frequente; sem ela a única saída é editar o horário e lembrar de desfazer, o que ninguém lembra |
| Fora do horário | **bloqueia no cardápio E na criação** | só recusar no endpoint faria o cliente montar o carrinho inteiro para levar erro no fim — pior que não ter a feature |
| Formas aceitas | **colunas booleanas por forma** | espelha `is_delivery`/`is_takeaway`/`is_qrcode`, que já é o padrão do projeto para "o que este restaurante aceita" |
| Troco | **`change_for_in_cents`, só para dinheiro** | sem ele o entregador sai sem trocado; é informação operacional, não financeira |

## Horário de funcionamento

### Modelo

```sql
create table opening_hours (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references restaurants (id),
  -- 0 = domingo … 6 = sábado, igual ao `extract(dow from ...)` do Postgres.
  -- Alinhar com o Postgres em vez de com o JavaScript não é gosto: a checagem
  -- de "está aberto agora?" roda no banco, e converter no meio seria mais um
  -- lugar para errar por um.
  weekday       integer     not null check (weekday between 0 and 6),
  opens_at      time        not null,
  closes_at     time        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  -- faixa de duração zero não significa nada, e `closes_at < opens_at` já tem
  -- outro significado (ver abaixo), então só a igualdade é proibida
  constraint opening_hours_range_check check (opens_at <> closes_at)
);

create index opening_hours_active_by_restaurant_idx
  on opening_hours (restaurant_id, weekday, opens_at)
  where deleted_at is null;
```

**Dia sem nenhuma faixa é dia fechado.** Não existe flag de "fechado" — a ausência é a informação, e uma flag redundante permitiria o estado incoerente de "fechado, das 11 às 15".

**As horas são locais**, no fuso do restaurante. `restaurants.timezone` já existe desde a PR do painel; sem ele, "18:00" significaria coisas diferentes em Manaus e São Paulo.

⚠️ **`opens_at`/`closes_at` são `time`, não `timestamptz` — e isso NÃO viola a D13.**
A regra existe porque `timestamp` sem fuso, usado para marcar um **instante**, é
lido no fuso da máquina e vira horários diferentes em máquinas diferentes. Aqui não
há instante: "18:00" é hora de parede, deliberadamente sem fuso, e o fuso entra na
comparação, vindo de `restaurants.timezone`. Guardar como `timestamptz` exigiria
inventar uma data para uma informação que não tem data.

### ⚠️ A faixa que atravessa a meia-noite

`closes_at < opens_at` significa **fecha no dia seguinte**: `18:00–02:00` é a pizzaria que atende até as duas da manhã. Não é um caso exótico — é metade do mercado de delivery noturno.

Isso torna a checagem de "está aberto?" mais do que uma comparação de intervalo, e é a parte que precisa de teste próprio: à 01:00 de terça, o restaurante está aberto por causa da faixa cadastrada em **segunda**.

### A checagem mora no Postgres

Mesmo motivo do filtro de período do painel: a conta depende do banco de fusos, e o `at time zone` já o consulta. Refazê-la em JavaScript seria uma segunda implementação da mesma regra, discordando da primeira nos dias de virada.

```sql
-- verdadeiro se o instante atual cai em alguma faixa do restaurante
select exists (
  select 1
    from opening_hours h,
         lateral (select now() at time zone $2 as local) agora
   where h.restaurant_id = $1
     and h.deleted_at is null
     and (
       -- faixa normal, dentro do mesmo dia
       (h.closes_at > h.opens_at
         and extract(dow from agora.local) = h.weekday
         and agora.local::time >= h.opens_at
         and agora.local::time <  h.closes_at)
       or
       -- faixa que atravessa a meia-noite: vale no fim do próprio dia,
       -- e na madrugada do dia seguinte
       (h.closes_at < h.opens_at
         and (
           (extract(dow from agora.local) = h.weekday
             and agora.local::time >= h.opens_at)
           or
           (extract(dow from agora.local) = (h.weekday + 1) % 7
             and agora.local::time < h.closes_at)
         ))
     )
);
```

Faixas sobrepostas no mesmo dia (11:00–15:00 e 14:00–18:00) são permitidas: o `exists` responde "aberto", que é a leitura certa. Recusá-las exigiria checagem de sobreposição para ganhar nada.

### A pausa manual

```sql
alter table restaurants
  add column accepting_orders boolean not null default true;
```

`accepting_orders = false` fecha a loja **imediatamente**, sem tocar no horário cadastrado. É uma segunda condição, não uma substituição: a loja está aberta quando **está dentro de uma faixa E não está pausada**.

O nome é `accepting_orders` e não `paused` porque a leitura positiva é a que o código faz o tempo todo (`if (!restaurant.acceptingOrders) recusa`), e negativa dupla em condição é onde nasce erro de lógica.

## Forma de pagamento

### O que o restaurante aceita

Quatro colunas booleanas, espelhando as três de modalidade que já existem:

```sql
alter table restaurants
  add column accepts_cash           boolean not null default true,
  add column accepts_card_on_delivery boolean not null default true,
  add column accepts_pix            boolean not null default true,
  add column accepts_meal_voucher   boolean not null default false;
```

Colunas planas, e não um array ou jsonb, pela D15 e pelo precedente: `is_delivery`/`is_takeaway`/`is_qrcode` já resolveram exatamente esta forma de problema neste projeto.

`accepts_meal_voucher` nasce `false` porque vale-refeição exige credenciamento com a bandeira — o restaurante que tem, liga; os outros não descobrem um "sim" que não conseguem honrar.

### O que o pedido guarda

```sql
alter table orders
  add column payment_method text not null default 'cash'
    check (payment_method in ('cash', 'card_on_delivery', 'pix', 'meal_voucher')),
  -- só faz sentido em dinheiro, e o `check` garante isso no banco
  add column change_for_in_cents integer
    check (change_for_in_cents is null or change_for_in_cents >= 0),
  constraint orders_change_for_check check (
    change_for_in_cents is null or payment_method = 'cash'
  );
```

O `default 'cash'` existe **só** para a coluna poder nascer `not null` num banco com pedidos; a rota exige o campo. Pedido antigo fica como `cash`, que é o palpite menos errado para delivery brasileiro anterior a esta feature.

### As regras

- **Forma que o restaurante não aceita → 409**, com a mesma forma do `assertRestauranteAceita` que já recusa modalidade. É a mesma pergunta ("este restaurante aceita isso?") e merece o mesmo formato de resposta.
- **`changeFor` em forma que não é dinheiro → 400.** Não é conflito de estado, é corpo incoerente.
- **`changeFor` menor que o total → 400.** Pedir troco para R$ 20 numa conta de R$ 45 não é um pedido, é um engano — e o entregador descobriria na porta.
- **`changeFor` ausente em dinheiro é válido:** significa "tenho o valor certo". Exigi-lo obrigaria quem paga exato a inventar um número.

⚠️ **O `changeFor` é comparado com o total calculado no servidor**, nunca com um total vindo do corpo — que nem existe no schema. Comparar com um número do cliente deixaria a validação inteira sem sentido.

## 🚨 Todas as superfícies que isto toca

A PR anterior terminou com um defeito que passou por **nove revisões**: o recibo do cliente ficou sem as opções escolhidas, porque o plano listou a rota do restaurante e esqueceu a do cliente. Cada revisor conferiu fielmente o diff que recebeu; ninguém tinha mandato para o conjunto.

Esta seção existe para isso não repetir. **Todo lugar que lê pedido ou restaurante, listado de uma vez:**

| Superfície | O que muda | Por quê |
| --- | --- | --- |
| `GET /menu/:slug` (público) | `isOpen`, `acceptingOrders`, `openingHours`, `paymentMethods` | a tela precisa decidir se mostra o botão, dizer quando abre, e oferecer as formas certas |
| `POST /restaurants/:restaurantId/orders` (público) | aceita `paymentMethod` e `changeForInCents`; recusa fechado/pausado/forma não aceita | é onde a decisão acontece |
| `GET /restaurants/:restaurantId/orders/:orderId` | `paymentMethod`, `changeForInCents` | **é a razão da feature existir**: o restaurante precisa saber como será pago e se leva troco |
| `GET /restaurants/:restaurantId/orders` (listagem) | `paymentMethod`, `changeForInCents` | a fila da cozinha decide o troco antes de despachar; abrir o detalhe de cada pedido para descobrir é trabalho manual que a listagem existe para evitar |
| `GET /orders/:orderId?token=` (público, cliente) | `paymentMethod`, `changeForInCents` | é o recibo de quem pediu; ele escolheu, e o recibo tem que confirmar a escolha |
| `GET /restaurants/:restaurantId` e `PATCH` | `acceptingOrders` e as 4 flags de forma aceita | o painel lê e edita a própria configuração |
| WebSocket `/orders/:orderId/track` | **nada** | o canal transmite mudança de estado, não conteúdo do pedido; a leitura HTTP é que o completa |

O `openapi.json` versionado é a rede: um campo esquecido em `schema.response` some da documentação **e** da resposta ao mesmo tempo, então divergência aparece no diff.

## Como o bloqueio aparece nas duas pontas

### No cardápio público

`GET /menu/:slug` ganha:

```json
{
  "isOpen": false,
  "acceptingOrders": true,
  "openingHours": [
    { "weekday": 1, "opensAt": "18:00", "closesAt": "02:00" }
  ],
  "paymentMethods": ["cash", "pix"]
}
```

`isOpen` é o resultado das duas condições juntas (dentro da faixa **e** não pausado) — é o que a tela precisa para decidir se mostra o botão. `acceptingOrders` vem separado para a tela poder distinguir "fechado agora, abre às 18h" de "a loja pausou os pedidos", que são mensagens diferentes para o cliente.

`openingHours` sai para a tela conseguir dizer **quando** abre. Sem ela, "fechado" é um beco sem saída.

`paymentMethods` é o array das formas aceitas — derivado das quatro colunas pelo mapper, porque o cliente precisa saber o que pode escolher antes de escolher.

### Na criação do pedido

`POST /restaurants/:restaurantId/orders` recusa com **409** quando a loja está fechada ou pausada, com mensagens distintas pelo mesmo motivo de cima.

Vale para **as três modalidades**, incluindo `dine_in`: se a loja está fechada, não há ninguém no salão para servir. Horário por modalidade é outro conceito e está fora de escopo.

⚠️ **A checagem na criação não é redundante com a do cardápio.** O cardápio informa; a criação decide. Entre uma e outra cabe o tempo de montar o carrinho — e cabe também um cliente que chame a API direto, sem passar por tela nenhuma.

## Rotas

```
PUT    /restaurants/:restaurantId/opening-hours
GET    /restaurants/:restaurantId/opening-hours
PATCH  /restaurants/:restaurantId                 (ganha acceptingOrders e as 4 flags)
```

O `PUT` define a **semana inteira** de uma vez, como o vínculo produto↔grupo faz: é como uma tela de horário funciona (a pessoa edita a grade e salva), é idempotente, e evita três rotas para criar, editar e remover faixa.

Corpo:

```json
{ "openingHours": [ { "weekday": 1, "opensAt": "18:00", "closesAt": "02:00" } ] }
```

- `weekday` fora de 0–6 → **400**
- `opensAt` igual a `closesAt` → **400**
- hora fora do formato `HH:MM` → **400**
- lista vazia é válida: significa **fechado todos os dias**
- `weekday` repetido é permitido: são as várias faixas do mesmo dia

A substituição é **soft delete de tudo e insert do que veio**, na mesma transação —
igual ao `replaceProductLinks` do vínculo produto↔grupo, e pelo mesmo motivo: é
tabela de configuração, a rotatividade de linha não custa nada, e código que calcula
diferença é onde mora o bug que ninguém vê.

`GET` devolve `{ "openingHours": [...] }` sem envelope de paginação: uma semana tem
um punhado de faixas, e paginar a grade de horário não faria sentido nenhum.

As rotas exigem sessão, e nenhuma é `ownerOnly` — mexer no horário é trabalho de quem opera, como cardápio e pedidos.

## Testes

Além do caminho feliz de cada rota:

- **A faixa que atravessa a meia-noite**, nos dois lados: às 23:00 de segunda e à 01:00 de terça, com a faixa cadastrada em segunda, a loja está aberta; às 03:00 de terça, fechada.
- **O fuso decide**, como no filtro de período: dois restaurantes com o mesmo horário cadastrado e fusos diferentes respondem `isOpen` diferente no mesmo instante.
- **Dia sem faixa é fechado.**
- **A pausa fecha a loja mesmo dentro da faixa**, e `acceptingOrders` sai separado de `isOpen` no cardápio.
- **A criação recusa com 409** fora do horário e pausado, nas três modalidades, com mensagens distintas.
- **Forma não aceita → 409**; `changeFor` sem dinheiro → 400; `changeFor` menor que o total → 400; `changeFor` ausente em dinheiro → 201.
- **O `changeFor` é comparado com o total do servidor** — um corpo que tente mandar o próprio total não muda a validação.
- `PUT` com lista vazia fecha a semana; `weekday` inválido e `opensAt == closesAt` são 400.

Cada garantia passa pelo teste de mutação: quebrar o código que a sustenta tem que fazer o teste falhar. Garantia cuja mutação não acusa é **documentada como tal**, nunca prometida.

## Consequência conhecida, e assumida

O resumo do painel soma `total_in_cents`, que não inclui frete — e nesta PR frete ainda não existe. Nada muda aqui; o registro fica para a PR do frete, onde pedidos com "frete a combinar" passarão a sub-reportar por decisão consciente.

## Fontes

- [Goomer — horário de funcionamento e áreas de entrega](https://ajuda.goomer.com.br/goomergo/painel/goomergo/areas-e-taxas-de-entregas/taxa-por-bairro)
- [Cardápio Web — formas de pagamento para delivery](https://cardapioweb.com/blog/formas-de-pagamento-para-delivery/)
