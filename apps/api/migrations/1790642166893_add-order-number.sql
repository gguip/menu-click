-- Up Migration

-- O número do pedido que se fala no balcão: `#1042`, contínuo POR LOJA.
--
-- ⚠️ A coluna é `order_number`, e não `number`: `orders.number` já existe e é
-- o número do endereço de entrega (o endereço é cópia em colunas planas, D15).
--
-- O contador mora na linha do restaurante e é incrementado na MESMA transação
-- que cria o pedido: se a criação falhar depois, o rollback desfaz o
-- incremento, e a numeração não ganha buraco. O custo é que duas criações
-- simultâneas da mesma loja entram em fila no lock dessa linha.
alter table restaurants add column last_order_number integer not null default 0;
alter table orders add column order_number integer;

-- Backfill: numera o que já existe pela ordem de criação (D11), loja a loja.
update orders o
   set order_number = n.rn
  from (
    select id, row_number() over (partition by restaurant_id order by created_at, id) as rn
      from orders
  ) n
 where n.id = o.id;

update restaurants r
   set last_order_number = m.max_number
  from (select restaurant_id, max(order_number) as max_number from orders group by restaurant_id) m
 where m.restaurant_id = r.id;

alter table orders alter column order_number set not null;

-- Parcial (D6): pedido não se apaga, mas a regra de soft delete é absoluta.
create unique index orders_order_number_active_key
  on orders (restaurant_id, order_number) where deleted_at is null;

-- Down Migration

drop index orders_order_number_active_key;
alter table orders drop column order_number;
alter table restaurants drop column last_order_number;
