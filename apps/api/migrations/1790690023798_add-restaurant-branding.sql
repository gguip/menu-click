-- Up Migration

-- A loja no app do cliente: a capa do topo do cardápio e a cor da ação (o
-- botão "Adicionar ao carrinho"). Tinta, papel e as cores semânticas ficam
-- FIXAS no app — é o que garante contraste AA; a loja troca só a ação, e a
-- API recusa cor que não contraste com o texto branco do botão.
alter table restaurants add column cover_url text;
alter table restaurants add column brand_color text;

-- Down Migration

alter table restaurants drop column brand_color;
alter table restaurants drop column cover_url;
