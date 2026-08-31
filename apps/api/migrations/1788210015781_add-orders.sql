-- Up Migration
-- Domínio de pedidos: clientes, pedidos e itens do pedido.
--
-- Três decisões de modelagem que valem o comentário, porque o schema sozinho
-- não as explica:
--
--  1. `order_items` COPIA nome e preço do produto em vez de só referenciá-lo.
--     Um pedido é o registro do que foi combinado; se o restaurante reajustar o
--     cardápio amanhã, o pedido de ontem não pode mudar de valor. A FK para
--     `products` continua existindo (rastreabilidade), mas ninguém lê preço por
--     ela.
--
--  2. O endereço de entrega também é cópia, e pelo mesmo motivo — mais o fato
--     de que ele é opcional: pedido feito pelo QR code na mesa não tem entrega.
--     Ou as seis colunas vêm preenchidas, ou as seis vêm nulas (check abaixo);
--     meio endereço é pior que nenhum.
--
--  3. Não há cascata de soft delete de `customers`/`restaurants` para `orders`.
--     A cascata do projeto vale para catálogo (restaurante -> produtos): o que
--     saiu de circulação some da vitrine. Pedido não é vitrine, é histórico —
--     remover um cliente impede que ele faça pedidos NOVOS (nenhuma leitura
--     enxerga cliente removido), mas não reescreve o que já aconteceu.

create table customers (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  -- o telefone É a identidade do cliente: não há login, quem escaneia o QR
  -- code não tem conta. Ver o índice único parcial mais abaixo.
  phone      text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table orders (
  id             uuid        primary key default gen_random_uuid(),
  restaurant_id  uuid        not null references restaurants (id),
  customer_id    uuid        not null references customers (id),
  -- text + check em vez de enum do Postgres: adicionar um status novo depois é
  -- uma migration que troca o check, não um ALTER TYPE que não roda em
  -- transação. (Do lado do TS é união `as const`: o projeto proíbe `enum`.)
  status         text        not null default 'pending',
  -- total congelado junto com os itens. Redundante com a soma de
  -- `order_items`, de propósito: a listagem paginada de pedidos não pode fazer
  -- um agregado por linha só para mostrar o valor.
  total_in_cents integer     not null,
  -- endereço de entrega copiado; nulo no pedido de mesa
  street         text,
  number         text,
  neighborhood   text,
  city           text,
  state          text,
  zip_code       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint orders_status_check
    check (status in ('pending', 'confirmed', 'cancelled')),
  constraint orders_total_check
    check (total_in_cents >= 0),
  -- tudo ou nada: entrega tem endereço completo, mesa não tem nenhum
  constraint orders_address_check check (
    (street is null and number is null and neighborhood is null
      and city is null and state is null and zip_code is null)
    or
    (street is not null and number is not null and neighborhood is not null
      and city is not null and state is not null and zip_code is not null)
  )
);

create table order_items (
  id             uuid        primary key default gen_random_uuid(),
  order_id       uuid        not null references orders (id),
  product_id     uuid        not null references products (id),
  -- cópias congeladas do produto no momento do pedido (ver comentário 1)
  name           text        not null,
  price_in_cents integer     not null,
  quantity       integer     not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint order_items_quantity_check check (quantity > 0),
  constraint order_items_price_check    check (price_in_cents >= 0)
);

-- Índices parciais (D5): as consultas só enxergam linha viva, o índice também.

-- Unicidade parcial (D6): `unique (phone)` comum impediria recadastrar um
-- cliente que foi removido — o telefone ficaria queimado para sempre.
create unique index customers_phone_active_key
  on customers (phone)
  where deleted_at is null;

create index orders_active_by_restaurant_idx
  on orders (restaurant_id, created_at, id)
  where deleted_at is null;

-- a listagem filtra por status (?status=pending no painel do restaurante)
create index orders_active_by_restaurant_status_idx
  on orders (restaurant_id, status, created_at, id)
  where deleted_at is null;

create index orders_active_by_customer_idx
  on orders (customer_id, created_at, id)
  where deleted_at is null;

create index order_items_active_by_order_idx
  on order_items (order_id, created_at, id)
  where deleted_at is null;

-- Down Migration
-- Ordem inversa por causa das FKs. Os índices caem junto com as tabelas.

drop table order_items;
drop table orders;
drop table customers;
