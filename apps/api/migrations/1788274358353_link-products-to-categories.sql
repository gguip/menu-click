-- Up Migration

-- O produto passa a apontar para a entidade `categories`, e a coluna de texto
-- livre morre. É o segundo tempo da migration anterior: lá a categoria passou a
-- existir, aqui ela vira a única verdade sobre a seção do cardápio.

alter table products add column category_id uuid references categories (id);

-- Backfill: cada texto distinto que já existe vira uma categoria do restaurante
-- que o usava.
--
-- Só os produtos **vivos** entram nesta conta. Fosse pelos removidos também,
-- um produto que ninguém mais vê criaria uma seção vazia no cardápio público.
-- A `position` sai da ordem em que a seção apareceu no cardápio, que é um
-- palpite melhor do que a alfabética — e o restaurante reordena depois.
--
-- O agrupamento é por `lower(category)` porque é assim que o índice único da
-- tabela nova enxerga: "Bebidas" e "bebidas" no mesmo restaurante eram a mesma
-- seção digitada de dois jeitos, e viram uma linha só. A grafia que sobrevive é
-- a do produto mais antigo.
--
-- O `on conflict do nothing` não é preguiça: entre esta migration e a que criou
-- a tabela cabe um deploy inteiro, e nele alguém pode ter criado "Bebidas" pela
-- API. Nesse caso a categoria que já existe é a certa, e o `update` abaixo liga
-- os produtos nela — falhar seria recusar o cenário normal de duas migrations
-- em commits diferentes. Vale também para um `down` seguido de `up`: as
-- categorias sobrevivem ao down, porque a tabela é da migration anterior.
--
-- Quando isso acontece, a `position` calculada aqui pode empatar com a de uma
-- categoria já existente. Não é erro: a listagem desempata por nome.
insert into categories (restaurant_id, name, position)
select
  agrupado.restaurant_id,
  agrupado.name,
  row_number() over (
    partition by agrupado.restaurant_id order by agrupado.primeiro_uso
  ) - 1
from (
  select distinct on (p.restaurant_id, lower(p.category))
    p.restaurant_id,
    p.category as name,
    min(p.created_at) over (
      partition by p.restaurant_id, lower(p.category)
    ) as primeiro_uso
  from products p
  where p.deleted_at is null
  order by p.restaurant_id, lower(p.category), p.created_at, p.id
) as agrupado
on conflict do nothing;

-- Liga os produtos — inclusive os removidos, para não perder o vínculo de quem
-- pode ser restaurado depois (D7). Um produto removido cujo texto não tem mais
-- nenhum irmão vivo fica sem categoria: é a única perda desta migration, e é
-- assumida (a alternativa era poluir o cardápio com seções vazias).
update products p
   set category_id = c.id
  from categories c
 where c.restaurant_id = p.restaurant_id
   and lower(c.name) = lower(p.category)
   and c.deleted_at is null;

alter table products drop column category;

-- O cardápio público lê os produtos de um punhado de categorias por vez
-- (`where category_id = any(...)`), e sempre só os vivos (D5).
create index products_active_by_category_idx
  on products (category_id, created_at, id)
  where deleted_at is null;

-- Down Migration

drop index products_active_by_category_idx;

alter table products add column category text;

update products p
   set category = c.name
  from categories c
 where c.id = p.category_id;

-- A coluna era `not null`, e produto sem categoria é estado legítimo desde a
-- migration de cima. Estes ganham um rótulo para caber no contrato antigo — a
-- volta não é perfeita, e não tem como ser: a ausência de categoria não existia
-- no schema anterior.
update products set category = 'Sem categoria' where category is null;

alter table products alter column category set not null;

alter table products drop column category_id;
