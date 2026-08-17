-- Up Migration
-- Estoque do produto. Sem check de não-negativo de propósito: a rota de
-- compra (routes/products-purchase.ts) é um exemplo didático de race
-- condition, e uma constraint no banco esconderia o sintoma (erro em vez de
-- estoque ficando negativo).

alter table products add column stock integer not null default 0;

-- Down Migration

alter table products drop column stock;