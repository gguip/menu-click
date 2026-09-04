-- Up Migration

-- O horário de funcionamento. Até aqui `restaurants` não tinha nenhuma coluna
-- de horário: dava para pedir às 4 da manhã, e o restaurante descobria o
-- pedido ao abrir.

create table opening_hours (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references restaurants (id),
  -- 0 = domingo … 6 = sábado, igual ao `extract(dow from ...)` do Postgres.
  -- Alinhar com o Postgres e não com o JavaScript não é gosto: a checagem de
  -- "está aberto agora?" roda no banco, e converter no meio seria mais um
  -- lugar para errar por um.
  weekday       integer     not null check (weekday between 0 and 6),
  -- `time`, e NÃO `timestamptz`: isto é hora de parede, deliberadamente sem
  -- fuso. O fuso entra na comparação, vindo de `restaurants.timezone`. A D13
  -- existe para INSTANTES, e aqui não há instante — guardar como timestamptz
  -- exigiria inventar uma data para informação que não tem data.
  opens_at      time        not null,
  closes_at     time        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  -- Faixa de duração zero não significa nada. `closes_at < opens_at` NÃO é
  -- erro: significa que fecha no dia seguinte (18:00–02:00 é a pizzaria que
  -- atende até as duas). Por isso só a igualdade é proibida.
  constraint opening_hours_range_check check (opens_at <> closes_at)
);

create index opening_hours_active_by_restaurant_idx
  on opening_hours (restaurant_id, weekday, opens_at)
  where deleted_at is null;

-- A pausa manual. Fecha a loja na hora, sem tocar no horário cadastrado — é o
-- caso real mais frequente (cozinha lotada, faltou insumo). Sem ela, a única
-- saída do restaurante é editar o horário e lembrar de desfazer depois.
--
-- O nome é positivo (`accepting_orders`, não `paused`) porque é assim que o
-- código o lê o tempo todo, e negativa dupla em condição é onde nasce erro.
alter table restaurants
  add column accepting_orders boolean not null default true;

-- O que o restaurante aceita como pagamento. Colunas planas espelhando
-- `is_delivery`/`is_takeaway`/`is_qrcode`, que já resolveram exatamente esta
-- forma de problema neste projeto.
--
-- `accepts_meal_voucher` nasce false porque vale-refeição exige credenciamento
-- com a bandeira: quem tem, liga; os outros não descobrem um "sim" que não
-- conseguem honrar.
alter table restaurants
  add column accepts_cash             boolean not null default true,
  add column accepts_card_on_delivery boolean not null default true,
  add column accepts_pix              boolean not null default true,
  add column accepts_meal_voucher     boolean not null default false;

-- Como o pedido será pago. O default existe SÓ para a coluna poder nascer
-- `not null` num banco com pedidos; a rota exige o campo. Pedido antigo fica
-- `cash`, o palpite menos errado para delivery brasileiro anterior a isto.
alter table orders
  add column payment_method text not null default 'cash'
    check (payment_method in ('cash', 'card_on_delivery', 'pix', 'meal_voucher')),
  -- "troco para R$ 50". Só faz sentido em dinheiro, e o check garante isso no
  -- banco — sem ele, um pedido no Pix poderia carregar troco e ninguém veria.
  add column change_for_in_cents integer,
  add constraint orders_change_for_check check (
    change_for_in_cents is null
    or (payment_method = 'cash' and change_for_in_cents >= 0)
  );

-- Down Migration

alter table orders
  drop constraint orders_change_for_check,
  drop column change_for_in_cents,
  drop column payment_method;

alter table restaurants
  drop column accepts_meal_voucher,
  drop column accepts_pix,
  drop column accepts_card_on_delivery,
  drop column accepts_cash,
  drop column accepting_orders;

drop index opening_hours_active_by_restaurant_idx;
drop table opening_hours;
