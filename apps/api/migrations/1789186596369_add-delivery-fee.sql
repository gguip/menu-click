-- Up Migration

-- O modo de cobrança. Um restaurante cobra de UMA forma: vários modos
-- simultâneos exigiriam uma regra de precedência que ninguém pediu e que o dono
-- não saberia explicar ao cliente.
--
-- ⚠️ O default 'fixed' com taxa 0 preserva EXATAMENTE o comportamento de hoje:
-- delivery hoje é de graça, e todo restaurante já cadastrado continua assim até
-- o dono configurar. A migration anterior de horário ensinou isso do jeito
-- caro — ela criou a tabela vazia e um bloqueio posterior fechou todo
-- restaurante existente no deploy. Aqui o default É o backfill.
alter table restaurants
  add column delivery_fee_mode text not null default 'fixed'
    check (delivery_fee_mode in ('neighborhood', 'distance', 'fixed')),
  -- zero é entrega grátis, não "não configurado"
  add column delivery_fixed_fee_in_cents integer not null default 0
    check (delivery_fixed_fee_in_cents >= 0),
  -- nulo = a promoção não existe. Vale nos três modos.
  add column free_delivery_above_in_cents integer
    check (free_delivery_above_in_cents is null or free_delivery_above_in_cents >= 0),
  -- o "a combinar": quando a cotação não consegue decidir, aceita mesmo assim
  add column delivery_fee_to_arrange boolean not null default false;

-- Bairros atendidos, com o preço de cada um.
create table delivery_neighborhoods (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id),
  -- o nome como o dono digitou, que é o que volta na resposta
  name text not null,
  -- a chave de comparação: sem acento e em minúsculas. Sem ela, "Jardim
  -- América" e "jardim america" conviveriam como dois bairros — o mesmo
  -- problema que fez `categories` indexar por lower(name).
  normalized_name text not null,
  fee_in_cents integer not null check (fee_in_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- unicidade parcial (D6): índice comum impediria recadastrar um bairro removido
create unique index delivery_neighborhoods_active_name_key
  on delivery_neighborhoods (restaurant_id, normalized_name)
  where deleted_at is null;

create index delivery_neighborhoods_active_by_restaurant_idx
  on delivery_neighborhoods (restaurant_id, name)
  where deleted_at is null;

-- O frete congelado no pedido. Nulável, e os três estados são distintos:
-- valor > 0 é o frete, 0 é entrega grátis, null é "a combinar" (ou pedido que
-- não é delivery). Confundir grátis com a-combinar entregaria de graça por
-- acidente.
alter table orders
  add column delivery_fee_in_cents integer
    check (delivery_fee_in_cents is null or delivery_fee_in_cents >= 0);

-- Só pedido de entrega pode ter frete. É a mesma rede que o endereço já tem.
alter table orders
  add constraint orders_delivery_fee_check
    check (delivery_fee_in_cents is null or type = 'delivery');

-- Down Migration
--
-- ⚠️ PERDA DE INFORMAÇÃO: a configuração de frete de todos os restaurantes, a
-- lista inteira de bairros atendidos e o frete cobrado em cada pedido de
-- entrega desaparecem. Não há onde guardar — as colunas não existem no schema
-- anterior.
--
-- O total dos pedidos NÃO é recalculado: ele fica com o frete embutido e sem o
-- campo que explicava a diferença. Se o objetivo for só parar de cobrar frete,
-- ponha os restaurantes em modo 'fixed' com taxa 0 em vez de descer a migration.

alter table orders
  drop constraint orders_delivery_fee_check,
  drop column delivery_fee_in_cents;

drop index delivery_neighborhoods_active_by_restaurant_idx;
drop index delivery_neighborhoods_active_name_key;
drop table delivery_neighborhoods;

alter table restaurants
  drop column delivery_fee_to_arrange,
  drop column free_delivery_above_in_cents,
  drop column delivery_fixed_fee_in_cents,
  drop column delivery_fee_mode;
