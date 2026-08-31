-- Up Migration
-- Autenticação: usuários do restaurante e sessões.
--
-- Duas decisões que o schema sozinho não explica:
--
--  1. O usuário pertence a UM restaurante (`restaurant_id` not null). Isso faz
--     a autorização virar a mesma comparação que as rotas de produto já fazem
--     (`where restaurant_id = $1`), em vez de uma tabela de vínculo consultada
--     a cada requisição. Rede/franquia com um usuário em várias lojas não é
--     caso que existe hoje — quando existir, é uma tabela nova, não uma
--     reescrita desta.
--
--  2. A sessão guarda o HASH do token, não o token. Quem lê o banco (backup,
--     dump, log de query, DBA) não consegue se passar por ninguém. Aqui o
--     SHA-256 é suficiente e correto, ao contrário do que vale para senha: o
--     token tem 256 bits de entropia aleatória, então não há dicionário nem
--     rainbow table a que ele seja vulnerável — o que exige KDF caro (bcrypt) é
--     segredo escolhido por gente.

create table restaurant_users (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references restaurants (id),
  name          text        not null,
  email         text        not null,
  -- só o hash bcrypt; a senha em si nunca chega ao banco nem ao log
  password_hash text        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table sessions (
  id                 uuid        primary key default gen_random_uuid(),
  restaurant_user_id uuid        not null references restaurant_users (id),
  -- sha256 hex do token que o cliente recebeu (ver comentário 2 acima)
  token_hash         text        not null,
  expires_at         timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- logout é soft delete, como todo o resto do projeto
  deleted_at         timestamptz
);

-- Índices parciais (D5) e unicidade parcial (D6).

-- E-mail único entre os vivos: `unique (email)` comum impediria recadastrar
-- alguém que foi removido, queimando o endereço para sempre.
create unique index restaurant_users_email_active_key
  on restaurant_users (email)
  where deleted_at is null;

create index restaurant_users_active_by_restaurant_idx
  on restaurant_users (restaurant_id, created_at, id)
  where deleted_at is null;

-- A busca de toda requisição autenticada é por este índice.
create unique index sessions_token_hash_active_key
  on sessions (token_hash)
  where deleted_at is null;

-- Serve para revogar tudo de um usuário de uma vez (troca de senha, demissão).
create index sessions_active_by_user_idx
  on sessions (restaurant_user_id)
  where deleted_at is null;

-- Down Migration
-- sessions primeiro por causa da FK. Os índices caem junto com as tabelas.

drop table sessions;
drop table restaurant_users;
