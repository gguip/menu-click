-- Up Migration

-- O valor mínimo do pedido, e ele vale SÓ em entrega.
--
-- O mínimo existe porque entrega tem custo de piso: sai entregador, sai
-- veículo. Retirada e salão não custam nada a mais à loja, e recusar um café
-- de R$ 5 no balcão só perderia venda.
--
-- ⚠️ Zero significa "sem mínimo", e é por isso que a coluna NÃO é nulável.
-- O `free_delivery_above_in_cents` é nulável e precisou de `nullable: true` no
-- schema da rota para a loja conseguir DESLIGAR a promoção — uma lacuna que só
-- a revisão da branch daquela feature pegou. Aqui desligar é pôr zero, e o
-- caminho de volta existe sem tratamento especial.
alter table restaurants
  add column minimum_order_in_cents integer not null default 0
    check (minimum_order_in_cents >= 0);

-- Down Migration
--
-- ⚠️ PERDA DE INFORMAÇÃO: o valor mínimo configurado por cada restaurante
-- desaparece. Não há onde guardar — a coluna não existe no schema anterior.
-- Pedidos já criados não mudam: o mínimo é conferido na criação e nunca fica
-- gravado no pedido, porque não é algo que se congela (ao contrário do frete,
-- que é cobrado).

alter table restaurants
  drop column minimum_order_in_cents;
