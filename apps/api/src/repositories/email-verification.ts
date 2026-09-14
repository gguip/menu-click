import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { EmailVerificationToken } from "../domain/email-verification.ts";

/**
 * Repositório de verificação de e-mail: **só acesso a dados**.
 *
 * Espelha `repositories/password-reset.ts`: todo o SQL de
 * `email_verification_tokens` está aqui, soft delete em toda consulta
 * (`deleted_at is null`), e o que entra e sai daqui é sempre o **hash** do
 * token, nunca o valor — quem gera o token e calcula o hash é o serviço
 * (`src/tokens.ts`).
 *
 * ⚠️ Faltando de propósito, por agora: `softDeleteLiveForUser`. A recuperação
 * de senha tem uma porque o reenvio (`/auth/forgot-password`) pode acontecer
 * várias vezes e cada pedido novo invalida o anterior. Aqui o caminho mínimo
 * (cadastro → um token → verificação) não reenvia; o reenvio, e a função que
 * o acompanha, é trabalho da Task 4 do plano.
 */

/** Linha da tabela `email_verification_tokens`, em snake_case. */
type EmailVerificationTokenRow = {
  id: string;
  restaurant_user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase usado fora daqui (D12). */
function toEmailVerificationToken(
  row: EmailVerificationTokenRow,
): EmailVerificationToken {
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

/** Cria o token de verificação. Recebe o hash pronto — nunca o token. */
export async function insert(
  data: { restaurantUserId: string; tokenHash: string; expiresAt: Date },
  db: Queryable = pool,
): Promise<EmailVerificationToken> {
  const { rows } = await db.query<EmailVerificationTokenRow>(
    `insert into email_verification_tokens (restaurant_user_id, token_hash, expires_at)
     values ($1, $2, $3)
     returning *`,
    [data.restaurantUserId, data.tokenHash, data.expiresAt],
  );
  return toEmailVerificationToken(rows[0]);
}

/**
 * O token vivo com esse hash — nem removido, nem já usado, nem expirado.
 * Mesma forma (e mesmo raciocínio) de `password-reset.findLiveByHash`: as
 * três condições são o filtro inteiro, e o serviço não repete nenhuma.
 */
export async function findLiveByHash(
  tokenHash: string,
  db: Queryable = pool,
): Promise<EmailVerificationToken | null> {
  const { rows } = await db.query<EmailVerificationTokenRow>(
    `select * from email_verification_tokens
      where token_hash = $1
        and deleted_at is null
        and used_at is null
        and expires_at > now()`,
    [tokenHash],
  );
  return rows.length === 0 ? null : toEmailVerificationToken(rows[0]);
}

/**
 * Marca o token como consumido. `false` = não havia mais um token vivo com
 * esse id (já usado, removido, ou id que não existe).
 *
 * É este `update ... where used_at is null` — não a checagem em
 * `findLiveByHash` — que serializa duas verificações concorrentes com o
 * MESMO token: a primeira a chegar aqui vence, e a segunda recebe `false`.
 */
export async function markUsed(
  id: string,
  db: Queryable = pool,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update email_verification_tokens set used_at = now(), updated_at = now()
      where id = $1 and deleted_at is null and used_at is null`,
    [id],
  );
  return rowCount === 1;
}
