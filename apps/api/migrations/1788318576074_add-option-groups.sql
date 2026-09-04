-- Up Migration

-- O quarto nível do cardápio. Até aqui era `Categoria -> Produto`; as
-- plataformas do mesmo nicho têm `Categoria -> Item -> Grupo -> Opção`, e sem
-- ele o sistema não vende pizza, hambúrguer com adicional nem combo.
--
-- O grupo pertence ao RESTAURANTE, não ao produto: "Sabores" vale para todas as
-- pizzas. Com grupo por produto, cadastrar a décima pizza recriaria quatro
-- grupos e vinte opções à mão, e mudar o preço do bacon viraria editar trinta
-- lugares.

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
  deleted_at    timestamptz,
  -- um grupo que exige mais escolhas do que aceita nunca poderia ser satisfeito,
  -- e o sintoma seria um pedido que não fecha, não um erro
  constraint option_groups_limits_check check (min_options >= 0 and max_options >= 1 and max_options >= min_options)
);

create table options (
  id              uuid        primary key default gen_random_uuid(),
  option_group_id uuid        not null references option_groups (id),
  name            text        not null,
  -- 0 cobre a escolha obrigatória sem custo ("ponto da carne"). O check não é
  -- decoração: o arredondamento do `average` é meio-para-cima em direção a
  -- +infinito, logo assimétrico no negativo, e com preço >= 0 essa assimetria
  -- nunca é alcançada. Isso fecha a porta para opção de desconto, de propósito.
  --
  -- NÃO é o mesmo caso do `stock` de products, que de propósito não tem check:
  -- lá a constraint esconderia o sintoma de uma race condition que o teste
  -- precisa enxergar. Aqui não há corrida — preço negativo é entrada sem sentido.
  price_in_cents  integer     not null default 0 check (price_in_cents >= 0),
  -- teto de unidades DESTA opção. Default 1 faz "Sabores" já nascer impedindo
  -- 2x o mesmo sabor sem ninguém configurar nada.
  max_quantity    integer     not null default 1 check (max_quantity >= 1),
  available       boolean     not null default true,
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- A junção. Ela é um vínculo, não um registro com história — desvincular
-- "Adicionais" de um hambúrguer não perde nada, porque pedido antigo guarda
-- cópias. Carrega `deleted_at` mesmo assim, porque a D1 é absoluta.
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

-- O congelamento. Mesma disciplina do `order_items`: cópias, nunca leitura de
-- `options` na hora de mostrar o pedido.
create table order_item_options (
  id              uuid        primary key default gen_random_uuid(),
  order_item_id   uuid        not null references order_items (id),
  -- referência histórica: nenhuma leitura de pedido a consulta
  option_id       uuid        not null references options (id),
  -- o nome do grupo entra congelado porque sem ele não dá para reconstruir o
  -- agrupamento no recibo — sobraria uma lista solta de opções
  group_name      text        not null,
  name            text        not null,
  price_in_cents  integer     not null,
  quantity        integer     not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- O preço unitário JÁ com as opções, calculado e congelado.
--
-- Sem ele, ler o pedido exigiria refazer as regras de preço no cliente. E o
-- caminho ingênuo — somar os preços das opções — erra: em `highest` e
-- `average` os preços são ENTRADAS de uma fórmula, não parcelas. Medido: uma
-- pizza de R$ 30,00 com sabores de R$ 45,05 e R$ 50,00 custa R$ 77,53, e a
-- soma ingênua daria R$ 125,05.
--
-- O default 0 existe só para a coluna poder nascer `not null` num banco com
-- pedidos; o backfill logo abaixo põe o valor certo.
alter table order_items
  add column unit_price_in_cents integer not null default 0;

-- Pedido antigo não tem opção nenhuma, então o unitário é o preço do produto.
update order_items set unit_price_in_cents = price_in_cents;

create unique index option_groups_name_active_key
  on option_groups (restaurant_id, lower(name))
  where deleted_at is null;

create index option_groups_active_by_restaurant_idx
  on option_groups (restaurant_id, name, id)
  where deleted_at is null;

create index options_active_by_group_idx
  on options (option_group_id, position, name, id)
  where deleted_at is null;

create unique index product_option_groups_active_key
  on product_option_groups (product_id, option_group_id)
  where deleted_at is null;

create index product_option_groups_active_by_product_idx
  on product_option_groups (product_id, position, id)
  where deleted_at is null;

create index order_item_options_by_item_idx
  on order_item_options (order_item_id, id)
  where deleted_at is null;

-- Down Migration

drop index order_item_options_by_item_idx;
drop index product_option_groups_active_by_product_idx;
drop index product_option_groups_active_key;
drop index options_active_by_group_idx;
drop index option_groups_active_by_restaurant_idx;
drop index option_groups_name_active_key;

alter table order_items drop column unit_price_in_cents;

drop table order_item_options;
drop table product_option_groups;
drop table options;
drop table option_groups;
