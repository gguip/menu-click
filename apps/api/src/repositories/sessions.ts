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
 * Uma query só, com os joins que já trazem o `restaurant_id` do usuário e a
 * verificação de e-mail da loja: é a consulta que roda em toda requisição
 * autenticada, então ela não pode virar duas idas ao banco.
 *
 * ⚠️ O join com `restaurants` NÃO é de graça, e vale dizer o preço em vez de
 * escondê-lo: `email_verified_at` mora no restaurante, não no usuário (ver a
 * migration da verificação de e-mail), então carregar `emailVerified` na
 * sessão custa um join a mais — por chave primária, então barato, mas é o
 * caminho mais quente do painel. Continua sendo **uma** ida ao banco, que é o
 * que importa: a alternativa seria uma segunda consulta em `authenticate.ts`.
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
    email_verified: boolean;
  }>(
    `select s.id, s.restaurant_user_id, u.restaurant_id, u.role,
            r.email_verified_at is not null as email_verified
       from sessions s
       join restaurant_users u on u.id = s.restaurant_user_id
       join restaurants r on r.id = u.restaurant_id
      where s.token_hash = $1
        and s.expires_at > now()
        and s.deleted_at is null
        and u.deleted_at is null
        -- ⚠️ O join com restaurants NAO filtra r.deleted_at, e isso e
        -- deliberado -- foi questionado numa revisao, entao fica escrito.
        --
        -- Remover o restaurante NAO derruba a sessao do dono: a cascata marca
        -- produtos, categorias, grupos, horarios e bairros, mas nao o usuario.
        -- Com a sessao viva, toda rota escopada responde 404 pelo ensureExists
        -- ("sumiu"), que e a mensagem certa para quem acabou de apagar a
        -- propria loja. Filtrando aqui, ela passaria a responder 401 ("quem e
        -- voce?"), e quem apagou de proposito acharia que deu problema no
        -- login. Ha teste prendendo o 404.
        --
        -- Nada vaza por isso: o /auth/me devolve o USUARIO, que de fato
        -- continua existindo, e nenhum campo do restaurante sai por ali.
        -- O join esta aqui so para trazer email_verified_at.`,
    [tokenHash],
  );
  if (rows.length === 0) return null;

  return {
    sessionId: rows[0].id,
    userId: rows[0].restaurant_user_id,
    restaurantId: rows[0].restaurant_id,
    role: rows[0].role,
    emailVerified: rows[0].email_verified,
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
 * Revoga as sessões vivas de um usuário, opcionalmente poupando uma.
 *
 * É a razão do índice por usuário, e o que dá sentido à sessão opaca: revogar
 * é apagar linhas, e não manter lista negra — que seria justamente o estado no
 * banco que o JWT queria evitar.
 *
 * `exceptSessionId` existe para a troca de senha: derrubar tudo derrubaria
 * também quem acabou de trocar, e a pessoa seria deslogada por uma ação que
 * ela mesma acabou de fazer.
 */
export async function revokeAllForUser(
  restaurantUserId: string,
  exceptSessionId: string | undefined = undefined,
  db: Queryable = pool,
): Promise<number> {
  const values: unknown[] = [restaurantUserId];
  let excecao = "";
  if (exceptSessionId !== undefined) {
    values.push(exceptSessionId);
    excecao = ` and id <> $${values.length}`;
  }

  const { rowCount } = await db.query(
    `update sessions set deleted_at = now(), updated_at = now()
      where restaurant_user_id = $1 and deleted_at is null${excecao}`,
    values,
  );
  return rowCount ?? 0;
}
