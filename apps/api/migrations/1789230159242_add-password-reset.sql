-- Up Migration

-- Espelha `sessions` de propósito: mesma forma de token, mesmo soft delete.
create table password_reset_tokens (
  id                 uuid        primary key default gen_random_uuid(),
  restaurant_user_id uuid        not null references restaurant_users (id),
  -- sha256 hex do token que foi por e-mail. O token em si não existe no banco:
  -- mesma decisão de `sessions` e do trackingToken. SHA-256 puro é o certo aqui
  -- porque o token são bits sorteados, sem dicionário a que seja vulnerável —
  -- e continua proibido para senha, que é segredo escolhido por gente.
  token_hash         text        not null,
  expires_at         timestamptz not null,
  -- consumido na troca. SEPARADO do deleted_at de propósito: "esta recuperação
  -- aconteceu" e "este token foi invalidado sem ser usado" são fatos
  -- diferentes, e colapsá-los apagaria a distinção que importa se alguém
  -- precisar entender um acesso indevido depois.
  used_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- A busca é sempre pelo hash, e sempre entre os vivos.
--
-- ⚠️ NÃO é único, e a omissão é deliberada. O índice existe para VELOCIDADE de
-- busca (`where token_hash = $1 and deleted_at is null`), não para garantir
-- unicidade: o token são 256 bits sorteados, então duas linhas vivas com o
-- mesmo hash é evento de probabilidade desprezível. Um `unique` não compraria
-- garantia nenhuma que o gerador já não dê, e transformaria esse evento
-- impossível num 500 em vez de em nada.
create index password_reset_tokens_active_hash_idx
  on password_reset_tokens (token_hash)
  where deleted_at is null;

-- Invalidar os anteriores de um usuário é a outra consulta quente.
create index password_reset_tokens_active_by_user_idx
  on password_reset_tokens (restaurant_user_id)
  where deleted_at is null;

-- Down Migration
--
-- ⚠️ PERDA DE INFORMAÇÃO: os pedidos de recuperação em aberto somem, e com eles
-- o registro de quais recuperações aconteceram. Não há onde guardar — a tabela
-- não existe no schema anterior. Quem estiver com um link no e-mail não
-- consegue usá-lo depois de descer esta migration.

drop index password_reset_tokens_active_by_user_idx;
drop index password_reset_tokens_active_hash_idx;
drop table password_reset_tokens;
