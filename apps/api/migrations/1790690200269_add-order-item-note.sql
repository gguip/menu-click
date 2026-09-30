-- Up Migration

-- "Sem cebola", "bem passado": a observação que o cliente escreve no item.
-- Congelada como nome e preço — é o que foi pedido, não o cardápio de hoje.
alter table order_items add column note text;

-- Down Migration

-- ⚠️ PERDA DE INFORMAÇÃO: as observações dos pedidos feitos desde o Up.
alter table order_items drop column note;
