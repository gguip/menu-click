-- Up Migration

-- O porquê do cancelamento, escrito pela loja para o cliente ler no
-- acompanhamento. Só existe em pedido cancelado.
alter table orders add column cancellation_reason text;
alter table orders
  add constraint orders_cancellation_reason_check check (
    cancellation_reason is null
    or (status = 'cancelled' and char_length(cancellation_reason) <= 200)
  );

-- Down Migration

-- ⚠️ PERDA DE INFORMAÇÃO: os motivos dos cancelamentos feitos desde o Up.
alter table orders drop constraint orders_cancellation_reason_check;
alter table orders drop column cancellation_reason;
