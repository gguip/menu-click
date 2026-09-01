import { pool } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { RestaurantUser, UserRole } from "../domain/restaurant-user.ts";

/**
 * Repositório de usuários do restaurante: **só acesso a dados**.
 *
 * Ver `restaurants.ts` para as convenções gerais. A particularidade aqui é o
 * cuidado com o `password_hash`: ele existe no tipo de linha (é uma coluna) e
 * numa função só — `findByEmailWithHash`, usada exclusivamente pelo login. O
 * mapper público não o copia, então nenhum caminho de leitura normal consegue
 * carregá-lo por acidente.
 */

type RestaurantUserRow = {
  id: string;
  restaurant_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase (D12). Sem o hash. */
function toRestaurantUser(row: RestaurantUserRow): RestaurantUser {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Violação de unicidade no Postgres (aqui: e-mail já cadastrado). */
const UNIQUE_VIOLATION = "23505";

/**
 * Cria o usuário — ou devolve `null` se o e-mail já está em uso.
 *
 * Recebe o hash pronto: calcular bcrypt é decisão do serviço (é ele que sabe o
 * custo e valida o tamanho em bytes), o repositório só grava o que chega.
 */
export async function insert(
  restaurantId: string,
  data: { name: string; email: string; passwordHash: string; role: UserRole },
  db: Queryable = pool,
): Promise<RestaurantUser | null> {
  try {
    const { rows } = await db.query<RestaurantUserRow>(
      `insert into restaurant_users (restaurant_id, name, email, password_hash, role)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [restaurantId, data.name, data.email, data.passwordHash, data.role],
    );
    return toRestaurantUser(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
    throw error;
  }
}

/**
 * Usuário vivo com esse e-mail, **com o hash da senha**. Só o login usa.
 *
 * Está separado de um `findByEmail` comum justamente para o hash sair do banco
 * apenas quando alguém precisa conferir senha — e para essa intenção ficar
 * escrita no nome da função, não escondida num campo a mais.
 */
export async function findByEmailWithHash(
  email: string,
  db: Queryable = pool,
): Promise<(RestaurantUser & { passwordHash: string }) | null> {
  const { rows } = await db.query<RestaurantUserRow>(
    "select * from restaurant_users where email = $1 and deleted_at is null",
    [email],
  );
  if (rows.length === 0) return null;
  return { ...toRestaurantUser(rows[0]), passwordHash: rows[0].password_hash };
}

/** Usuário vivo com esse id, ou `null`. */
export async function findById(
  id: string,
  db: Queryable = pool,
): Promise<RestaurantUser | null> {
  const { rows } = await db.query<RestaurantUserRow>(
    "select * from restaurant_users where id = $1 and deleted_at is null",
    [id],
  );
  return rows.length === 0 ? null : toRestaurantUser(rows[0]);
}
