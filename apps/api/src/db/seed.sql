-- Dados de exemplo para popular um ambiente novo.
--
-- Os ids são fixos de propósito: assim o seed é idempotente (`on conflict do
-- nothing`), roda quantas vezes quiser sem duplicar, e todo mundo do time tem
-- os mesmos ids para testar no Insomnia/curl.
--
-- created_at/updated_at ficam com o default (now()) — em ambiente novo os
-- registros são novos mesmo.

insert into restaurants
  (id, name, cuisine_type, street, number, neighborhood, city, state, zip_code, is_delivery, is_qrcode)
values
  ('cb95db58-0ea1-4157-a6fd-64f775f24a6e', 'Tokyo Ramen House', 'Japonesa',
   'Avenida Paulista', '2300', 'Bela Vista', 'São Paulo', 'SP', '01310-300', true, false),
  ('d05591dd-4c74-4d9e-9f62-cb8191d86ec8', 'Cantina da Nona', 'Italiana',
   'Rua Oscar Freire', '1042', 'Jardim Paulista', 'São Paulo', 'SP', '01426-001', true, true)
on conflict (id) do nothing;

insert into products
  (id, restaurant_id, name, category, price_in_cents, description)
values
  ('a54930aa-5548-4668-b545-b7c646757704', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Ramen Shoyu', 'Pratos principais', 4890, 'Caldo de shoyu, chashu e ovo marinado'),
  ('23755745-45ac-47f5-bbed-ad4af525c04a', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Guioza', 'Entradas', 2490, null),
  ('5791e1ee-ad59-4f93-aec2-74f9ce31c5b7', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Spaghetti Carbonara', 'Massas', 5290, 'Massa fresca, guanciale e pecorino'),
  ('442c7ad5-f9a4-4ae2-9e10-61af1c5d4734', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Tiramisù', 'Sobremesas', 3190, null),

  -- Cardápio mais variado, de R$ 8,90 a R$ 74,50: serve para testar ordenação
  -- por preço, faixas de valor e formatação de moeda no cliente.
  ('a48d8d89-bdd9-44dd-98b7-d47472930b7a', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Chá Verde Gelado', 'Bebidas', 890, 'Sencha gelado, 500ml'),
  ('fd5e2172-eda0-46d2-9bf0-580dd8d0b413', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Temaki de Salmão', 'Entradas', 2290, 'Salmão fresco, arroz shari e nori'),
  ('f5ca08e5-1bb0-4f81-8cd7-8c897431bc14', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Yakisoba de Frango', 'Pratos principais', 3890, 'Macarrão salteado com legumes'),
  ('6a39d53c-0791-4ee0-8235-47ce3cb11960', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Bruschetta al Pomodoro', 'Entradas', 1890, 'Pão italiano, tomate e manjericão'),
  ('aa3d4bc2-b2db-4c0d-b2fd-8d1f4db92850', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Ossobuco alla Milanese', 'Pratos principais', 7450, 'Com risoto de açafrão')
on conflict (id) do nothing;
