-- Up Migration

-- "Apto 42, bloco B": o complemento do endereço de entrega. Congelado com o
-- resto do endereço, e só existe junto dele — a rede de segurança do serviço,
-- como o `orders_address_check`.
alter table orders add column complement text;
alter table orders
  add constraint orders_complement_check check (
    complement is null or (street is not null and char_length(complement) <= 120)
  );

-- Down Migration

-- ⚠️ PERDA DE INFORMAÇÃO: os complementos dos pedidos feitos desde o Up.
alter table orders drop constraint orders_complement_check;
alter table orders drop column complement;
