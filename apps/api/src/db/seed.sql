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

-- O `slug` é explícito para a URL pública do exemplo ficar legível:
-- /menu/tokyo-ramen-house.
--
-- Vale para banco NOVO. Num banco que já tinha estes restaurantes, o
-- `on conflict do nothing` não toca na linha existente, e o slug continua
-- sendo o que o backfill da migration gerou (`tokyo-ramen-house-cb95db58`).
-- Isso é o certo: o seed não sobrescreve dado que já está lá.
insert into restaurants
  (id, name, slug, cuisine_type, street, number, neighborhood, city, state, zip_code,
   is_delivery, is_takeaway, is_qrcode)
values
  -- O Tokyo aceita as três modalidades (dá para exercitar as três trilhas de
  -- status sem cadastrar nada) e a Cantina recusa retirada (dá para ver o 409
  -- de modalidade). Como o slug, isso vale para banco NOVO: num banco que já
  -- tinha estes restaurantes, o `on conflict do nothing` não toca na linha
  -- existente, e `is_takeaway` fica com o `false` que o backfill da migration
  -- deixou. É o certo — o seed não sobrescreve dado que já está lá.
  ('cb95db58-0ea1-4157-a6fd-64f775f24a6e', 'Tokyo Ramen House', 'tokyo-ramen-house', 'Japonesa',
   'Avenida Paulista', '2300', 'Bela Vista', 'São Paulo', 'SP', '01310-300', true, true, true),
  -- a Cantina não faz retirada: serve para ver o 409 de modalidade recusada
  ('d05591dd-4c74-4d9e-9f62-cb8191d86ec8', 'Cantina da Nona', 'cantina-da-nona', 'Italiana',
   'Rua Oscar Freire', '1042', 'Jardim Paulista', 'São Paulo', 'SP', '01426-001', true, false, true)
on conflict (id) do nothing;

-- As seções do cardápio. A `position` é a ordem em que aparecem no cardápio
-- público (a sequência da refeição), não a alfabética — por isso "Bebidas" é a
-- última do Tokyo mesmo começando com B.
insert into categories (id, restaurant_id, name, position)
values
  ('1a9c4e37-52b8-4d06-9f31-7e0a5c284b6d', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e', 'Entradas', 0),
  ('2b8d5f46-63c9-4e17-8a42-6f1b4d395c7e', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e', 'Pratos principais', 1),
  ('3c7e6a55-74da-4f28-9b53-5a2c3e406d8f', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e', 'Bebidas', 2),
  ('4d6f7b64-85eb-4a39-8c64-4b3d2f517e90', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8', 'Entradas', 0),
  ('5e508c73-96fc-4b40-9d75-3c4e1a628f01', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8', 'Massas', 1),
  ('6f419d82-a70d-4c51-8e86-2d5f0b739012', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8', 'Pratos principais', 2),
  ('7a32ae91-b81e-4d62-9f97-1e6a9c84a123', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8', 'Sobremesas', 3)
on conflict (id) do nothing;

insert into products
  (id, restaurant_id, name, category_id, price_in_cents, description, stock)
values
  ('a54930aa-5548-4668-b545-b7c646757704', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Ramen Shoyu', '2b8d5f46-63c9-4e17-8a42-6f1b4d395c7e', 4890, 'Caldo de shoyu, chashu e ovo marinado', 30),
  ('23755745-45ac-47f5-bbed-ad4af525c04a', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Guioza', '1a9c4e37-52b8-4d06-9f31-7e0a5c284b6d', 2490, null, 45),
  ('5791e1ee-ad59-4f93-aec2-74f9ce31c5b7', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Spaghetti Carbonara', '5e508c73-96fc-4b40-9d75-3c4e1a628f01', 5290, 'Massa fresca, guanciale e pecorino', 25),
  ('442c7ad5-f9a4-4ae2-9e10-61af1c5d4734', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Tiramisù', '7a32ae91-b81e-4d62-9f97-1e6a9c84a123', 3190, null, 12),

  -- Cardápio mais variado, de R$ 8,90 a R$ 74,50: serve para testar ordenação
  -- por preço, faixas de valor e formatação de moeda no cliente.
  ('a48d8d89-bdd9-44dd-98b7-d47472930b7a', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Chá Verde Gelado', '3c7e6a55-74da-4f28-9b53-5a2c3e406d8f', 890, 'Sencha gelado, 500ml', 80),
  ('fd5e2172-eda0-46d2-9bf0-580dd8d0b413', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Temaki de Salmão', '1a9c4e37-52b8-4d06-9f31-7e0a5c284b6d', 2290, 'Salmão fresco, arroz shari e nori', 18),
  ('f5ca08e5-1bb0-4f81-8cd7-8c897431bc14', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Yakisoba de Frango', '2b8d5f46-63c9-4e17-8a42-6f1b4d395c7e', 3890, 'Macarrão salteado com legumes', 22),
  ('6a39d53c-0791-4ee0-8235-47ce3cb11960', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Bruschetta al Pomodoro', '4d6f7b64-85eb-4a39-8c64-4b3d2f517e90', 1890, 'Pão italiano, tomate e manjericão', 40),
  ('aa3d4bc2-b2db-4c0d-b2fd-8d1f4db92850', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Ossobuco alla Milanese', '6f419d82-a70d-4c51-8e86-2d5f0b739012', 7450, 'Com risoto de açafrão', 8)
on conflict (id) do nothing;

-- O quarto nível do cardápio (Categoria -> Produto -> Grupo -> Opção), só no
-- Tokyo. A pizza é "sushi pizza" — prato real de temakeria brasileira, base de
-- arroz gratinado — para o cardápio japonês continuar coerente e ainda existir
-- pizza de verdade para testar o meio a meio à mão.
insert into products
  (id, restaurant_id, name, category_id, price_in_cents, description, stock)
values
  ('6467a6be-eb91-485c-a27c-c403f6adc49e', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Pizza Sushi', '2b8d5f46-63c9-4e17-8a42-6f1b4d395c7e', 3200,
   'Base de arroz gratinado ao estilo das temakerias — escolha tamanho, sabor e adicionais', 20)
on conflict (id) do nothing;

-- O grupo pertence ao RESTAURANTE, não ao produto: os três abaixo ficam
-- disponíveis para a próxima pizza sem recriar opção nenhuma.
insert into option_groups (id, restaurant_id, name, min_options, max_options, price_rule)
values
  -- obrigatório (min 1), uma escolha só (max 1) — tamanho não se combina.
  ('61395f22-0b52-4df9-9bbb-df9381fde66e', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Tamanho', 1, 1, 'sum'),
  -- obrigatório (min 1), até duas escolhas (max 2): uma é pizza inteira, duas
  -- é meio a meio. `highest` cobra o sabor mais caro dos dois, nunca a soma —
  -- é o que torna o meio a meio testável à mão.
  ('591a8ba8-b41b-40f4-b098-412fef6845b2', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Sabores', 1, 2, 'highest'),
  -- opcional (min 0), até três adicionais
  ('89ab4bad-2308-4692-927d-9dfaacd94694', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Adicionais', 0, 3, 'sum')
on conflict (id) do nothing;

insert into options (id, option_group_id, name, price_in_cents, max_quantity, position)
values
  ('05395bb9-effa-4792-b8f8-4a3fc83f001c', '61395f22-0b52-4df9-9bbb-df9381fde66e',
   'Média', 0, 1, 0),
  ('95b91fd9-3ba6-4b6c-be27-18e9dadb7453', '61395f22-0b52-4df9-9bbb-df9381fde66e',
   'Grande', 1200, 1, 1),
  -- preços diferentes de propósito: pedir os dois sabores exercita o
  -- `highest` cobrando o mais caro (Camarão), não a soma dos dois
  ('6a1c0e04-f511-4b35-8c59-587c5707cf37', '591a8ba8-b41b-40f4-b098-412fef6845b2',
   'Salmão', 0, 1, 0),
  ('2e588309-845c-4d84-bf15-cbc965fdb9f6', '591a8ba8-b41b-40f4-b098-412fef6845b2',
   'Camarão', 1500, 1, 1),
  -- max_quantity 3: dá para pedir "bacon triplo" e ver o `sum` multiplicar
  ('9c1dd827-a1d2-4fa5-96f9-8cf9baaf3ba8', '89ab4bad-2308-4692-927d-9dfaacd94694',
   'Bacon', 500, 3, 0)
on conflict (id) do nothing;

insert into product_option_groups (id, product_id, option_group_id, position)
values
  ('765d32c2-cf3b-44bb-aad2-a5e8b8367d27', '6467a6be-eb91-485c-a27c-c403f6adc49e',
   '61395f22-0b52-4df9-9bbb-df9381fde66e', 0),
  ('cf0450f7-f827-4b94-9148-b1341e864b6b', '6467a6be-eb91-485c-a27c-c403f6adc49e',
   '591a8ba8-b41b-40f4-b098-412fef6845b2', 1),
  ('2dfe82df-feac-479a-9a69-44d41bbbaccc', '6467a6be-eb91-485c-a27c-c403f6adc49e',
   '89ab4bad-2308-4692-927d-9dfaacd94694', 2)
on conflict (id) do nothing;

-- Um usuário por restaurante, para dar em quem entrar num ambiente novo.
--
-- A senha é `senha-de-exemplo-123` nos dois, e o hash abaixo é bcrypt custo 12
-- dela. Isto NÃO é o mesmo caso do `.env.example` (que nunca carrega senha
-- real, nem de dev): aqui é dado de exemplo de um banco de exemplo, do mesmo
-- naipe do "Tokyo Ramen House". Ambiente real cadastra pelo /auth/register.
insert into restaurant_users (id, restaurant_id, name, email, password_hash)
values
  ('2f8a1c04-9d3e-4b57-8a26-0c5e7b91d4f3', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   'Dono do Tokyo Ramen', 'dono@tokyoramen.com.br',
   '$2b$12$AVy5NxxvXd1kfy09F8jRSednE5STi1tPr3Ddsy4CDwIY7e6YW.a8u'),
  ('6b1d9e75-2a48-4f30-b9c1-8d0f3a5e7c26', 'd05591dd-4c74-4d9e-9f62-cb8191d86ec8',
   'Dona da Cantina', 'dona@cantinadanona.com.br',
   '$2b$12$AVy5NxxvXd1kfy09F8jRSednE5STi1tPr3Ddsy4CDwIY7e6YW.a8u')
on conflict (id) do nothing;

-- Um cliente e três pedidos, um por modalidade: um delivery pendente (para
-- testar a confirmação e ver o estoque cair), um de salão já confirmado, e uma
-- retirada em preparo (para o estado "disponível para retirada" ter de onde
-- sair).
--
-- O pedido confirmado NÃO é descontado do `stock` acima: o seed grava estado
-- final, não replay de operações. Quem quiser ver o débito acontecer confirma
-- o pedido pendente pela API.

insert into customers (id, name, phone)
values
  ('8f2c1d3a-7b4e-4c9a-9d1e-2f5a6b8c0d3e', 'Ana Souza', '11999990000')
on conflict (id) do nothing;

insert into orders
  (id, restaurant_id, customer_id, type, status, total_in_cents,
   street, number, neighborhood, city, state, zip_code)
values
  -- entrega pendente: só ela leva endereço (ver orders_address_check)
  ('3e7b9c21-5a48-4f6d-8b02-1c9d4e7a5f83', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   '8f2c1d3a-7b4e-4c9a-9d1e-2f5a6b8c0d3e', 'delivery', 'pending', 12270,
   'Rua Augusta', '1500', 'Consolação', 'São Paulo', 'SP', '01304-001'),
  -- salão, já aceito
  ('b41f6d80-2c93-4a17-8e5b-7d0a3f9c6e12', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   '8f2c1d3a-7b4e-4c9a-9d1e-2f5a6b8c0d3e', 'dine_in', 'confirmed', 890,
   null, null, null, null, null, null),
  -- retirada em preparo: o próximo passo dela é `ready_for_pickup`
  ('5c2a8f14-6b39-4e70-91d5-7a0e3b6c8d42', 'cb95db58-0ea1-4157-a6fd-64f775f24a6e',
   '8f2c1d3a-7b4e-4c9a-9d1e-2f5a6b8c0d3e', 'takeaway', 'preparing', 2490,
   null, null, null, null, null, null)
on conflict (id) do nothing;

-- name/price_in_cents são cópias congeladas do produto no momento do pedido —
-- por isso repetem o que está em `products` em vez de referenciar.
-- unit_price_in_cents repete price_in_cents porque nenhum destes itens tem
-- opção: sem opção, o preço unitário é só o preço do produto (ver a migration
-- add-option-groups).
insert into order_items
  (id, order_id, product_id, name, price_in_cents, unit_price_in_cents, quantity)
values
  ('c9a5e731-8f24-4b60-9d18-3e6b2c7a4f05', '3e7b9c21-5a48-4f6d-8b02-1c9d4e7a5f83',
   'a54930aa-5548-4668-b545-b7c646757704', 'Ramen Shoyu', 4890, 4890, 2),
  ('7d3c8b12-4e95-4a07-b6f3-9c1a5d0e8b74', '3e7b9c21-5a48-4f6d-8b02-1c9d4e7a5f83',
   '23755745-45ac-47f5-bbed-ad4af525c04a', 'Guioza', 2490, 2490, 1),
  ('1a6f4d90-3b78-4c52-8e01-5d9b7a2c6f38', 'b41f6d80-2c93-4a17-8e5b-7d0a3f9c6e12',
   'a48d8d89-bdd9-44dd-98b7-d47472930b7a', 'Chá Verde Gelado', 890, 890, 1),
  ('e0b7c352-9d41-4a86-b3f7-2c5e8a1d094b', '5c2a8f14-6b39-4e70-91d5-7a0e3b6c8d42',
   '23755745-45ac-47f5-bbed-ad4af525c04a', 'Guioza', 2490, 2490, 1)
on conflict (id) do nothing;
