-- Up Migration
-- Modalidade do pedido e a máquina de status completa.
--
-- O que motiva as duas mudanças juntas: acompanhar o pedido só faz sentido em
-- entrega e retirada. Quem pediu pelo QR code está sentado no salão e não tem o
-- que acompanhar. E as três jornadas têm passos diferentes — retirada termina
-- em "disponível para retirada", entrega em "saiu para entrega" —, então a
-- máquina de status depende da modalidade.
--
-- A modalidade PRECISA virar coluna. Até agora ela era inferida do endereço:
-- pedido com `street` era entrega, sem endereço era mesa. Retirada quebra essa
-- inferência, porque também não tem endereço e não é mesa.

-- O restaurante declara o que aceita. Sem esta flag, todo restaurante passaria
-- a aceitar retirada por omissão — inclusive um que só entrega.
--
-- Nasce `false` (falha fechado) e depois perde o default, para ficar igual ao
-- `is_delivery`/`is_qrcode`: inserção nova é obrigada a dizer o que aceita, em
-- vez de herdar um padrão que ninguém escolheu.
alter table restaurants add column is_takeaway boolean not null default false;
alter table restaurants alter column is_takeaway drop default;

-- Como no slug: adiciona nulável, preenche, e só então exige `not null` — a
-- tabela já tem dado.
alter table orders add column type text;

-- Backfill pela regra antiga. Nenhum pedido existente é 'takeaway', porque a
-- modalidade não existia quando eles foram criados.
update orders
   set type = case when street is null then 'dine_in' else 'delivery' end;

alter table orders alter column type set not null;

alter table orders add constraint orders_type_check
  check (type in ('dine_in', 'takeaway', 'delivery'));

-- O endereço deixa de ser "tudo ou nada" e passa a depender da modalidade:
-- obrigatório na entrega, proibido nas outras duas. Antes, um pedido de mesa
-- com endereço passava pelo check — agora o banco recusa, e o endereço volta a
-- significar uma coisa só.
alter table orders drop constraint orders_address_check;
alter table orders add constraint orders_address_check check (
  (type = 'delivery'
    and street is not null and number is not null and neighborhood is not null
    and city is not null and state is not null and zip_code is not null)
  or
  (type <> 'delivery'
    and street is null and number is null and neighborhood is null
    and city is null and state is null and zip_code is null)
);

-- A máquina completa. `confirmed` deixa de ser terminal — era decisão
-- consciente de quando os pedidos entraram, e é justamente ela que se inverte.
--
-- `completed` (e não `delivered`) porque é um estado só para as três trilhas:
-- "entregue" é vocabulário de delivery e obrigaria o painel a dizer isso de um
-- prato servido na mesa. Quem escolhe a palavra é o front, pela modalidade.
alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check check (
  status in (
    'pending',
    'confirmed',
    'preparing',
    'ready_for_pickup',   -- só takeaway
    'out_for_delivery',   -- só delivery
    'completed',
    'cancelled'
  )
);

-- Down Migration
--
-- ⚠️ PERDA DE INFORMAÇÃO: pedidos que estiverem nos estados novos são jogados
-- de volta para 'confirmed', porque o check antigo não os aceita. Não há como
-- evitar — os estados simplesmente não existem no schema anterior. O que dá
-- para garantir é que o `down` não falhe pela metade, deixando a tabela com
-- constraint velha e dado novo.

update orders
   set status = 'confirmed'
 where status in ('preparing', 'ready_for_pickup', 'out_for_delivery', 'completed');

alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('pending', 'confirmed', 'cancelled'));

alter table orders drop constraint orders_address_check;
alter table orders add constraint orders_address_check check (
  (street is null and number is null and neighborhood is null
    and city is null and state is null and zip_code is null)
  or
  (street is not null and number is not null and neighborhood is not null
    and city is not null and state is not null and zip_code is not null)
);

alter table orders drop constraint orders_type_check;
alter table orders drop column type;

alter table restaurants drop column is_takeaway;
