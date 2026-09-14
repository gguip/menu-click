-- Up Migration

-- Quando a loja provou o e-mail. Nulo é "não provou".
--
-- A coluna vai no RESTAURANTE e não no usuário de propósito: quem fica
-- bloqueado e invisível é a loja. Com a marca no usuário, o hook precisaria
-- descobrir se o DONO verificou (não o usuário da sessão), e o `findBySlug` do
-- cardápio público — o caminho mais quente da API, o que o QR code abre —
-- passaria a juntar com `restaurant_users`.
alter table restaurants add column email_verified_at timestamptz;

-- ⚠️ Todo restaurante que JÁ existe nasce verificado, e isto é o backfill.
--
-- Sem esta linha, o bloqueio da Task 2 trancaria toda loja do banco no instante
-- do deploy — o defeito exato que a feature de taxa de entrega quase embarcou,
-- e que só a revisão da branch inteira pegou. A exigência vale para cadastro
-- novo; quem já está aqui não muda de comportamento.
--
-- ⚠️ REAPLICAR esta migration depois de um `down` verifica quem nunca provou
-- nada. Medido num banco de sonda, na sequência realista de operação (deploy,
-- problema, rollback, correção, deploy de novo): todo cadastro feito na janela
-- entre os dois deploys volta VERIFICADO, e o pedido de verificação em aberto
-- dele some junto, porque a tabela é recriada vazia. O backfill está certo na
-- primeira aplicação e não tem como distinguir a segunda — a coluna que
-- guardaria a diferença é justamente a que acabou de ser criada. É consequência
-- de operação, não defeito de SQL: nenhum teste possível a mostra.
update restaurants set email_verified_at = now() where deleted_at is null;

-- Espelha `password_reset_tokens`: mesma forma de token, mesmo soft delete.
create table email_verification_tokens (
  id                 uuid        primary key default gen_random_uuid(),
  -- aponta para o USUÁRIO, porque é a caixa de entrada dele que prova algo.
  -- Verificar marca o RESTAURANTE dele.
  restaurant_user_id uuid        not null references restaurant_users (id),
  -- sha256 hex, nunca o token: a mesma decisão de `sessions`, do
  -- `trackingToken` e da recuperação de senha
  token_hash         text        not null,
  expires_at         timestamptz not null,
  -- consumido na verificação. Separado do `deleted_at` pelo mesmo motivo da
  -- recuperação: "isto aconteceu" e "foi invalidado sem acontecer" são fatos
  -- diferentes, e colapsá-los apaga o que importa numa investigação.
  used_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- A busca é sempre pelo hash, e sempre entre os vivos. NÃO é único, pelo mesmo
-- motivo do índice equivalente da recuperação: o índice existe para velocidade,
-- e `unique` não compraria garantia que um gerador de 256 bits já não dê.
create index email_verification_tokens_active_hash_idx
  on email_verification_tokens (token_hash)
  where deleted_at is null;

create index email_verification_tokens_active_by_user_idx
  on email_verification_tokens (restaurant_user_id)
  where deleted_at is null;

-- Down Migration
--
-- ⚠️ PERDA DE INFORMAÇÃO: some o registro de quais lojas provaram o e-mail e
-- quando, mais os pedidos de verificação em aberto. Não há onde guardar — nem a
-- coluna nem a tabela existem no schema anterior.
--
-- Descer isto NÃO devolve ninguém ao estado anterior: as lojas voltam a operar
-- sem verificação, que é o comportamento de antes da feature — então o `Down` é
-- seguro de rodar, só não é reversível.

drop index email_verification_tokens_active_by_user_idx;
drop index email_verification_tokens_active_hash_idx;
drop table email_verification_tokens;

alter table restaurants drop column email_verified_at;
