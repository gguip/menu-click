-- Up Migration

-- As mesas do salão, e o identificador que vai dentro do QR code colado nelas.
--
-- Até aqui `dine_in` existia sem saber DE ONDE veio o pedido: o slug é um só
-- por restaurante, então o QR da mesa 3 e o da mesa 12 abriam a mesma URL, e o
-- garçom recebia "João, 11 9xxxx" sem nada que dissesse para onde levar o
-- prato. A mesa é a entidade que faltava para o QR code significar alguma
-- coisa.
create table tables (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references restaurants (id),
  -- texto livre: "Mesa 7", "Varanda 2", "Balcão". Quem nomeia o salão é quem
  -- trabalha nele, e numerar não cobre mesa que tem nome.
  label         text        not null,
  -- ⚠️ Guardado EM CLARO, ao contrário de `sessions.token_hash` e do
  -- `tracking_token_hash` do pedido — e a diferença é de natureza, não de
  -- rigor. Aqueles são segredos entregues UMA vez a uma pessoa; este é um
  -- identificador impresso num adesivo colado na parede, à vista de quem
  -- entrar no salão. Ele precisa ser reimprimível (o adesivo descola, rasga,
  -- encardece), e guardar só o hash tornaria isso impossível: o valor
  -- original não existiria em lugar nenhum. O que o protege não é sigilo, é
  -- entropia (128 bits, inadivinhável) e a rotação, que existe para invalidar
  -- um adesivo comprometido.
  hash          text        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- Rótulo único por restaurante, sobre `lower(label)` — mesma decisão de
-- `categories.name`, e pelo mesmo motivo: "Mesa 7" e "mesa 7" convivendo no
-- painel é exatamente a confusão que a entidade existe para não ter. Parcial,
-- para o rótulo voltar a ficar livre quando a mesa for removida (D6).
create unique index tables_label_active_key
  on tables (restaurant_id, lower(label)) where deleted_at is null;

-- Unicidade GLOBAL do hash, não por restaurante: a resolução pública é
-- escopada pelo slug, então por restaurante bastaria, mas global custa o mesmo
-- índice e fecha de vez a chance de um hash significar duas mesas.
create unique index tables_hash_active_key
  on tables (hash) where deleted_at is null;

-- A listagem do painel: vivos daquele restaurante, na ordem determinística do
-- projeto (D5/D11).
create index tables_active_by_restaurant_idx
  on tables (restaurant_id, created_at, id) where deleted_at is null;

-- A mesa no pedido: o vínculo e a CÓPIA CONGELADA do rótulo.
--
-- `table_label` não é redundante com o join. É a mesma disciplina de
-- `order_items` copiar `name` e `price_in_cents` do produto: renomear "Mesa 7"
-- para "Mesa 8" não pode reescrever o histórico, e remover a mesa não pode
-- deixar o pedido antigo sem como se descrever. Com a cópia, nenhuma leitura
-- de pedido precisa juntar `tables`.
alter table orders
  add column table_id    uuid references tables (id),
  add column table_label text;

-- Tudo-ou-nada entre as duas colunas, e só em `dine_in` — espelha o
-- `orders_address_check`, que faz o mesmo com o endereço de entrega. É rede de
-- segurança abaixo do serviço, não a checagem principal.
alter table orders
  add constraint orders_table_check check (
    (table_id is null and table_label is null)
    or
    (table_id is not null and table_label is not null and type = 'dine_in')
  );

-- Down Migration

alter table orders drop constraint orders_table_check;
alter table orders drop column table_label;
alter table orders drop column table_id;

-- ⚠️ PERDA DE INFORMAÇÃO: as mesas cadastradas e, com elas, os hashes que
-- estão impressos nos adesivos colados no salão. Reaplicar o Up sorteia
-- hashes novos, então TODO QR code já impresso deixa de resolver. Não há onde
-- guardar isso — a tabela não existe no schema anterior.
drop table tables;
