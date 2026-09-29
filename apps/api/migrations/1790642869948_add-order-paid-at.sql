-- Up Migration

-- Se o pedido foi pago. Não há pagamento online: quem marca é a loja, na mão,
-- em qualquer forma de pagamento — o sistema não presume que o pix caiu nem
-- que o concluído foi pago. Nulo = não marcado. É outro eixo que o status: o
-- pix se paga antes de sair, o dinheiro depois.
alter table orders add column paid_at timestamptz;

-- Down Migration

alter table orders drop column paid_at;
