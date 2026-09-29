-- Up Migration

-- Quando o pedido entrou em cada status: o "Andamento" do painel, com hora
-- real por etapa. Tabela de eventos, e não uma coluna por status: status novo
-- na máquina não pede migration, e o evento é gravado num lugar só
-- (`ordersRepository.updateStatus`, por onde toda transição passa).
create table order_status_events (
  id          uuid        primary key default gen_random_uuid(),
  order_id    uuid        not null references orders (id),
  status      text        not null,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint order_status_events_status_check check (status in (
    'pending', 'confirmed', 'preparing', 'ready_for_pickup',
    'out_for_delivery', 'completed', 'cancelled'
  ))
);

create index order_status_events_active_by_order_idx
  on order_status_events (order_id, occurred_at, id) where deleted_at is null;

-- Backfill HONESTO: só o que se sabe. A chegada é `created_at`; o status atual
-- é `updated_at`. As etapas do meio não foram registradas e ficam sem evento —
-- o painel mostra "—", em vez de um horário inventado exibido como fato.
insert into order_status_events (order_id, status, occurred_at)
  select id, 'pending', created_at from orders;

insert into order_status_events (order_id, status, occurred_at)
  select id, status, updated_at from orders where status <> 'pending';

-- Down Migration

-- ⚠️ PERDA DE INFORMAÇÃO: o horário de cada transição registrada desde o Up.
-- O schema anterior não tem onde guardá-lo.
drop table order_status_events;
