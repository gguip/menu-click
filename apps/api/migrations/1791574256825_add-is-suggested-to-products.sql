-- Up Migration

-- "Sugerir no carrinho": a loja marca o produto e o app do cliente o oferece
-- em "Que tal adicionar?". O default é o backfill — produto que já existe
-- nasce NÃO sugerido, e o carrinho de nenhuma loja muda no deploy.
--
-- Sem índice: a coluna nunca é filtro de consulta. O cardápio público já traz
-- todos os produtos, e quem separa os sugeridos é o app.
alter table products add column is_suggested boolean not null default false;

-- Down Migration

alter table products drop column is_suggested;
