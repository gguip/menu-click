-- Dados de exemplo para popular um ambiente novo.
--
-- Os ids são fixos de propósito: assim o seed é idempotente (`on conflict do
-- nothing`), roda quantas vezes quiser sem duplicar, e todo mundo do time tem
-- os mesmos ids para testar no Insomnia/curl.
--
-- created_at/updated_at ficam com o default (now()) — em ambiente novo os
-- registros são novos mesmo.
--
-- Os produtos vêm com `stock` preenchido: sem isso todo produto nasceria com 0
-- (o default da coluna) e a confirmação de pedido responderia 409 já na
-- primeira chamada num ambiente recém-populado.

insert into restaurants
  (id, name, cuisine_type, street, number, neighborhood, city, state, zip_code, is_delivery, is_qrcode)
values
  ('cb95db58-0ea1-4157-a6fd-64f775f24a6e', 'Tokyo Ramen House', 'Japonesa',
   'Avenida Paulista', '2300', 'Bela Vista', 'São Paulo', 'SP', '01310-300', true, false),
  ('d05591dd-4c74-4d9e-9f62-cb8191d86ec8', 'Cantina da Nona', 'Italiana',
   'Rua Oscar Freire', '1042', 'Jardim Paulista', 'São Paulo', 'SP', '01426-001', true, true)
on conflict (id) do nothing;

insert into products
  (id, restaurant_id, name, category, price_in_cents, description, stock)
values
  ('a54930aa-5548-4668-b545-b7c646757704', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Ramen Shoyu', 'Pratos principais', 4890, 'Caldo de shoyu, chashu e ovo marinado', 30),
  ('23755745-45ac-47f5-bbed-ad4af525c04a', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Guioza', 'Entradas', 2490, null, 45),
  ('5791e1ee-ad59-4f93-aec2-74f9ce31c5b7', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Spaghetti Carbonara', 'Massas', 5290, 'Massa fresca, guanciale e pecorino', 25),
  ('442c7ad5-f9a4-4ae2-9e10-61af1c5d4734', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Tiramisù', 'Sobremesas', 3190, null, 12),

  -- Cardápio mais variado, de R$ 8,90 a R$ 74,50: serve para testar ordenação
  -- por preço, faixas de valor e formatação de moeda no cliente.
  ('a48d8d89-bdd9-44dd-98b7-d47472930b7a', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Chá Verde Gelado', 'Bebidas', 890, 'Sencha gelado, 500ml', 80),
  ('fd5e2172-eda0-46d2-9bf0-580dd8d0b413', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Temaki de Salmão', 'Entradas', 2290, 'Salmão fresco, arroz shari e nori', 18),
  ('f5ca08e5-1bb0-4f81-8cd7-8c897431bc14', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Yakisoba de Frango', 'Pratos principais', 3890, 'Macarrão salteado com legumes', 22),
  ('6a39d53c-0791-4ee0-8235-47ce3cb11960', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Bruschetta al Pomodoro', 'Entradas', 1890, 'Pão italiano, tomate e manjericão', 40),
  ('aa3d4bc2-b2db-4c0d-b2fd-8d1f4db92850', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Ossobuco alla Milanese', 'Pratos principais', 7450, 'Com risoto de açafrão', 8)
on conflict (id) do nothing;

-- Um cliente e dois pedidos: um pendente (para testar a confirmação e ver o
-- estoque cair) e um já confirmado (para a listagem ter os dois status).
--
-- O pedido confirmado NÃO é descontado do `stock` acima: o seed grava estado
-- final, não replay de operações. Quem quiser ver o débito acontecer confirma
-- o pedido pendente pela API.

insert into customers (id, name, phone)
values
  ('8f2c1d3a-7b4e-4c9a-9d1e-2f5a6b8c0d3e', 'Ana Souza', '11999990000')
on conflict (id) do nothing;

insert into orders
  (id, restaurant_id, customer_id, status, total_in_cents,
   street, number, neighborhood, city, state, zip_code)
values
  -- pendente, com entrega (o Tokyo Ramen House tem is_delivery = true)
  ('3e7b9c21-5a48-4f6d-8b02-1c9d4e7a5f83', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   '8f2c1d3a-7b4e-4c9a-9d1e-2f5a6b8c0d3e', 'pending', 12270,
   'Rua Augusta', '1500', 'Consolação', 'São Paulo', 'SP', '01304-001'),
  -- confirmado, de mesa (endereço nulo: tudo-ou-nada, ver orders_address_check)
  ('b41f6d80-2c93-4a17-8e5b-7d0a3f9c6e12', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   '8f2c1d3a-7b4e-4c9a-9d1e-2f5a6b8c0d3e', 'confirmed', 890,
   null, null, null, null, null, null)
on conflict (id) do nothing;

-- name/price_in_cents são cópias congeladas do produto no momento do pedido —
-- por isso repetem o que está em `products` em vez de referenciar.
insert into order_items
  (id, order_id, product_id, name, price_in_cents, quantity)
values
  ('c9a5e731-8f24-4b60-9d18-3e6b2c7a4f05', '3e7b9c21-5a48-4f6d-8b02-1c9d4e7a5f83',
   'a54930aa-5548-4668-b545-b7c646757704', 'Ramen Shoyu', 4890, 2),
  ('7d3c8b12-4e95-4a07-b6f3-9c1a5d0e8b74', '3e7b9c21-5a48-4f6d-8b02-1c9d4e7a5f83',
   '23755745-45ac-47f5-bbed-ad4af525c04a', 'Guioza', 2490, 1),
  ('1a6f4d90-3b78-4c52-8e01-5d9b7a2c6f38', 'b41f6d80-2c93-4a17-8e5b-7d0a3f9c6e12',
   'a48d8d89-bdd9-44dd-98b7-d47472930b7a', 'Chá Verde Gelado', 890, 1)
on conflict (id) do nothing;
