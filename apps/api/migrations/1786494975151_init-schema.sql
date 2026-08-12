-- Up Migration
-- Schema inicial do MenuClick: restaurantes e produtos, com soft delete.
-- Requer Postgres >= 13 (gen_random_uuid() é nativo a partir dessa versão).

create table restaurants (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  cuisine_type text        not null,
  logo_url     text,
  is_delivery  boolean     not null,
  is_qrcode    boolean     not null,
  -- endereço em colunas planas: dá pra filtrar por cidade/bairro depois
  street       text        not null,
  number       text        not null,
  neighborhood text        not null,
  city         text        not null,
  state        text        not null,
  zip_code     text        not null,
  -- timestamptz (não `timestamp`): a API devolve ISO-8601 em UTC, e coluna sem
  -- fuso faria o mesmo registro virar horários diferentes conforme o fuso da máquina
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- soft delete: NULL = vivo. Ver .claude/rules/database.md
  deleted_at   timestamptz
);

create table products (
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

-- Índices parciais: as consultas do dia a dia só enxergam linha viva, então o
-- índice também só indexa linha viva (não engorda junto com a lixeira).

create index restaurants_active_idx
  on restaurants (created_at, id)
  where deleted_at is null;

create index products_active_by_restaurant_idx
  on products (restaurant_id, created_at, id)
  where deleted_at is null;

-- Down Migration
-- products primeiro por causa da FK. Os índices caem junto com as tabelas.

drop table products;
drop table restaurants;
