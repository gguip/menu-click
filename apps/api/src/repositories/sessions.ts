import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { AuthContext } from "../domain/session.ts";

/**
 * Repositório de sessões: **só acesso a dados**.
 *
 * O que entra e sai daqui é sempre o **hash** do token, nunca o token. Quem
 * gera o token e calcula o hash é o serviço; o repositório não sabe qual é o
 * segredo, o que também significa que ele nunca aparece num log de query.
 */

/** Grava a sessão e devolve o id. */
export async function insert(
  restaurantUserId: string,
  tokenHash: string,
  expiresAt: Date,
  db: Queryable = pool,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into sessions (restaurant_user_id, token_hash, expires_at)
     values ($1, $2, $3)
     returning id`,
    [restaurantUserId, tokenHash, expiresAt],
  );
  return rows[0].id;
}

/**
 * Resolve o hash de um token em quem está autenticado, ou `null`.
 *
 * Uma query só, com o join que já traz o `restaurant_id` do usuário: é a
 * consulta que roda em toda requisição autenticada, então ela não pode virar
 * duas idas ao banco.
 *
 * Os três filtros importam pelo mesmo motivo — sessão expirada, revogada ou de
 * usuário removido tem que se comportar como token inexistente:
 *   - `s.expires_at > now()` (validade)
 *   - `s.deleted_at is null` (logout)
 *   - `u.deleted_at is null` (usuário removido — este SIM filtra, ao contrário
 *     do join de cliente em pedido, porque aqui não é histórico: é permissão
 *     valendo agora)
 */
export async function findActiveByTokenHash(
  tokenHash: string,
  db: Queryable = pool,
): Promise<AuthContext | null> {
  const { rows } = await db.query<{
    id: string;
    restaurant_user_id: string;
    restaurant_id: string;
    role: AuthContext["role"];
  }>(
    `select s.id, s.restaurant_user_id, u.restaurant_id, u.role
       from sessions s
       join restaurant_users u on u.id = s.restaurant_user_id
      where s.token_hash = $1
        and s.expires_at > now()
        and s.deleted_at is null
        and u.deleted_at is null`,
    [tokenHash],
  );
  if (rows.length === 0) return null;

  return {
    sessionId: rows[0].id,
    userId: rows[0].restaurant_user_id,
    restaurantId: rows[0].restaurant_id,
    role: rows[0].role,
  };
}

/**
 * Revoga uma sessão (o logout). `false` quando não havia sessão viva com esse
 * id — o `and deleted_at is null` é o que impede sobrescrever a data original
 * numa segunda chamada (D1).
 */
export async function revoke(
  sessionId: string,
  db: Queryable = pool,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update sessions set deleted_at = now(), updated_at = now()
      where id = $1 and deleted_at is null`,
    [sessionId],
  );
  return rowCount === 1;
}

/**
 * Revoga TODAS as sessões vivas de um usuário. Ainda não tem rota: existe para
 * troca de senha e desligamento, e é a razão do índice por usuário.
 */
export async function revokeAllForUser(
  restaurantUserId: string,
  db: Queryable = pool,
): Promise<number> {
  const { rowCount } = await db.query(
    `update sessions set deleted_at = now(), updated_at = now()
      where restaurant_user_id = $1 and deleted_at is null`,
    [restaurantUserId],
  );
  return rowCount ?? 0;
}
