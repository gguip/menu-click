-- Up Migration

-- Dá a todo restaurante JÁ CADASTRADO uma grade que cobre a semana inteira.
--
-- Por que isto existe: a migration anterior criou `opening_hours` vazia, e o
-- bloqueio de "loja fechada" (409 na criação de pedido) entrou depois, na mesma
-- branch. "Dia sem faixa é dia fechado" é o desenho certo para restaurante
-- novo — mas aplicado ao banco existente significaria que, no instante do
-- deploy, TODO restaurante para de aceitar pedido nas três modalidades até
-- alguém abrir o painel e cadastrar a grade. Um recurso de configuração não
-- pode derrubar quem nunca pediu para ser configurado.
--
-- A grade 24x7 preserva exatamente o comportamento de antes (sempre aceitando)
-- e deixa cada dono restringir quando quiser. É o mesmo motivo do
-- `payment_method ... default 'cash'` da migration anterior: o default existe
-- para o que já estava lá, não para o que vem depois.
--
-- São DUAS faixas por dia, não uma. `isOpenNow` compara `local::time <
-- closes_at`, então `00:00–23:59` sozinha deixaria o minuto das 23:59 de fora —
-- a loja fecharia um minuto por dia, todo dia. A segunda faixa tem
-- `closes_at < opens_at`, cai no ramo que atravessa a meia-noite e cobre
-- exatamente esse minuto.
--
-- `not exists` protege quem já tiver grade: a migration roda uma vez só, mas o
-- backfill não deve sobrescrever configuração de ninguém.
insert into opening_hours (restaurant_id, weekday, opens_at, closes_at)
select r.id, dia.weekday, faixa.opens_at, faixa.closes_at
  from restaurants r
  cross join generate_series(0, 6) as dia(weekday)
  cross join (values ('00:00'::time, '23:59'::time),
                     ('23:59'::time, '00:00'::time)) as faixa(opens_at, closes_at)
 where r.deleted_at is null
   and not exists (
     select 1 from opening_hours h
      where h.restaurant_id = r.id and h.deleted_at is null
   );

-- Down Migration

-- ⚠️ PERDA DE INFORMAÇÃO, e com uma ressalva: remove as faixas no formato exato
-- que o `Up` criou (`00:00–23:59` e `23:59–00:00`). Se um restaurante tiver
-- cadastrado essa mesma grade à mão depois do deploy, ela vai junto — não há
-- como distinguir a linha semeada da digitada. O `delete` aqui é literal, e não
-- soft delete, porque desfazer um backfill é apagar o que ele inseriu, não
-- marcar como removido o que o usuário criou.
delete from opening_hours
 where (opens_at, closes_at) in (('00:00'::time, '23:59'::time),
                                 ('23:59'::time, '00:00'::time));
