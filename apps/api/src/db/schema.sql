-- Schema do MenuClick.
-- Idempotente: pode rodar quantas vezes precisar (`pnpm --filter @menuclick/api db:setup`).
-- Requer Postgres >= 13 (gen_random_uuid() é nativo a partir dessa versão).
--
-- ATENÇÃO: `create table if not exists` NÃO altera tabela que já existe. Ao mudar
-- uma coluna aqui, acrescente também o `alter table ... if not exists`
-- correspondente na seção de migrações no fim do arquivo — é o que atualiza
-- bancos que já tinham a tabela. O `db:setup` confere as colunas no fim e falha
-- se algo estiver faltando.

create table if not exists restaurants (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  cuisine_type text        not null,
  logo_url     text,
  -- endereço em colunas planas: dá pra filtrar por cidade/bairro depois
  street       text        not null,
  number       text        not null,
  neighborhood text        not null,
  city         text        not null,
  state        text        not null,
  zip_code     text        not null,
  is_delivery  boolean     not null,
  is_qrcode    boolean     not null,
  -- timestamptz (não `timestamp`): a API devolve ISO-8601 em UTC, e coluna sem
  -- fuso faria o mesmo registro virar horários diferentes conforme o fuso da máquina
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- soft delete: NULL = vivo. Ver .claude/rules/database.md
  deleted_at   timestamptz
);

create table if not exists products (
  id             uuid        primary key default gen_random_uuid(),
  -- sem `on delete cascade`: nada é apagado de verdade, a cascata é feita
  -- marcando deleted_at nos produtos junto com o restaurante (mesma transação)
  restaurant_id  uuid        not null references restaurants (id),
  name           text        not null,
  category       text        not null,
  price_in_cents integer     not null,
  description    text,
  photo_url      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- ===================== Migrações =====================
-- Para bancos que já existiam antes de uma coluna/índice ser criado aqui.

alter table restaurants add column if not exists deleted_at timestamptz;
alter table products    add column if not exists deleted_at timestamptz;

-- A FK de products nasceu com `on delete cascade` numa versão anterior; com soft
-- delete nunca há DELETE de verdade, então a cascata só mascararia um apagão real.
alter table products drop constraint if exists products_restaurant_id_fkey;
alter table products add constraint products_restaurant_id_fkey
  foreign key (restaurant_id) references restaurants (id);

-- ===================== Índices =====================
-- Parciais: as consultas do dia a dia só enxergam linha viva, então o índice
-- também só indexa linha viva (menor e mais rápido conforme a lixeira cresce).

create index if not exists restaurants_active_idx
  on restaurants (created_at, id)
  where deleted_at is null;

create index if not exists products_active_by_restaurant_idx
  on products (restaurant_id, created_at, id)
  where deleted_at is null;
