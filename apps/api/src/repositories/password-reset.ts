import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { PasswordResetToken } from "../domain/password-reset.ts";

/**
 * Repositório de recuperação de senha: **só acesso a dados**.
 *
 * Todo o SQL da tabela `password_reset_tokens` está aqui, e soft delete em
 * toda consulta (`deleted_at is null`) — ver `.claude/rules/database.md`. O
 * que entra e sai daqui é sempre o **hash** do token, nunca o token: quem
 * gera o valor e calcula o hash é o serviço (`src/tokens.ts`).
 */

/** Linha da tabela `password_reset_tokens`, em snake_case como vem do Postgres. */
type PasswordResetTokenRow = {
  id: string;
  restaurant_user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase usado fora daqui (D12). */
function toPasswordResetToken(row: PasswordResetTokenRow): PasswordResetToken {
  return {
    id: row.id,
    restaurantUserId: row.restaurant_user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at.toISOString(),
    usedAt: row.used_at === null ? null : row.used_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Cria o pedido de recuperação. Recebe o hash pronto — nunca o token. */
export async function insert(
  data: { restaurantUserId: string; tokenHash: string; expiresAt: Date },
  db: Queryable = pool,
): Promise<PasswordResetToken> {
  const { rows } = await db.query<PasswordResetTokenRow>(
    `insert into password_reset_tokens (restaurant_user_id, token_hash, expires_at)
     values ($1, $2, $3)
     returning *`,
    [data.restaurantUserId, data.tokenHash, data.expiresAt],
  );
  return toPasswordResetToken(rows[0]);
}

/**
 * O token vivo com esse hash — nem removido, nem já usado, nem expirado.
 *
 * "Vivo" aqui é mais estrito que o soft delete comum: os três filtros
 * precisam valer juntos para o link ainda autorizar a troca (Task 4). Um
 * token expirado ou já usado tem que se comportar como token inexistente,
 * exatamente como uma sessão expirada em `sessions.findActiveByTokenHash`.
 */
/**
 * O token vivo de um hash, ou `null`.
 *
 * As três condições são o filtro inteiro — o serviço não repete nenhuma.
 *
 * ⚠️ `used_at is null` aqui é saída antecipada, NÃO é o que garante uso único.
 * Verificado por mutação: removendo esta condição, a suíte continua verde,
 * porque quem de fato impede a segunda troca é o `update ... where used_at is
 * null` do `markUsed` — e é ele, e só ele, que serializa duas trocas correndo
 * no mesmo token. Está escrito porque um leitor veria as duas e suporia que
 * qualquer uma bastasse; só a segunda basta.
 *
 * `expires_at > now()` é diferente: removê-la derruba teste, porque é a única
 * coisa que recusa token vencido.
 */
export async function findLiveByHash(
  tokenHash: string,
  db: Queryable = pool,
): Promise<PasswordResetToken | null> {
  const { rows } = await db.query<PasswordResetTokenRow>(
    `select * from password_reset_tokens
      where token_hash = $1
        and deleted_at is null
        and used_at is null
        and expires_at > now()`,
    [tokenHash],
  );
  return rows.length === 0 ? null : toPasswordResetToken(rows[0]);
}

/**
 * Marca o token como consumido. `false` = não existia mais um token vivo com
 * esse id (já usado, removido, ou id que não existe).
 *
 * Separado do soft delete de propósito (ver a migration): "esta recuperação
 * aconteceu" e "este token foi invalidado sem ser usado" são fatos
 * diferentes.
 */
export async function markUsed(
  id: string,
  db: Queryable = pool,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update password_reset_tokens set used_at = now(), updated_at = now()
      where id = $1 and deleted_at is null and used_at is null`,
    [id],
  );
  return rowCount === 1;
}

/**
 * Invalida (soft delete) todo token ainda vivo de um usuário.
 *
 * É o que faz um pedido novo substituir os anteriores: sem isso, três
 * tentativas deixariam três tokens vivos espalhados pela caixa de entrada.
 * Recebe o `client` porque só faz sentido na mesma transação do `insert` do
 * token novo — as duas escritas valem juntas.
 */
export async function softDeleteLiveForUser(
  restaurantUserId: string,
  db: Queryable = pool,
): Promise<void> {
  await db.query(
    `update password_reset_tokens set deleted_at = now(), updated_at = now()
      where restaurant_user_id = $1
        and deleted_at is null
        -- ⚠️ used_at is null importa: marcar como removido um token JA USADO
        -- borraria a distincao que as duas colunas existem para guardar --
        -- deleted_at significa "invalidado SEM ter sido usado". Quem ja foi
        -- usado fica como esta, e o historico continua legivel para quem
        -- precisar entender um acesso indevido depois.
        and used_at is null`,
    [restaurantUserId],
  );
}
