-- Up Migration
-- Token de acompanhamento do pedido.
--
-- Quem pede não tem conta, então precisa de alguma credencial para ver o
-- próprio pedido. A alternativa era usar o UUID do pedido como segredo — ele já
-- é imprevisível —, e ela foi descartada por dois motivos:
--
--  1. O acompanhamento é por WebSocket, e navegador não manda header no
--     handshake: a credencial vai na URL, que entra em log de acesso, de proxy
--     e no histórico. Com o id fazendo esse papel, não há como revogar.
--  2. Um token separado **não existe** em pedido de salão — e é isso que faz
--     "quem está no salão não acompanha" ser consequência do modelo, em vez de
--     um `if` que alguém pode remover sem perceber.
--
-- A coluna guarda o HASH, nunca o token, pelo mesmo motivo de `sessions`: quem
-- lê um backup ou um dump não consegue se passar por ninguém. SHA-256 puro é
-- correto aqui — o token são 256 bits sorteados, sem dicionário a que seja
-- vulnerável. O que exige KDF caro é segredo escolhido por gente.

alter table orders add column tracking_token_hash text;

-- Nulável de propósito: `dine_in` não recebe token. A regra de qual modalidade
-- ganha token é do serviço, e não um `check` aqui — ela pode mudar sem que a
-- forma do dado mude.

-- Índice único parcial (D6), e é por ele que a busca do handshake acontece.
create unique index orders_tracking_token_active_key
  on orders (tracking_token_hash)
  where tracking_token_hash is not null and deleted_at is null;

-- Down Migration

drop index orders_tracking_token_active_key;
alter table orders drop column tracking_token_hash;
