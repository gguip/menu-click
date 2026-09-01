import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { withTransaction } from "../db/pool.ts";
import type { CreateRestaurantInput, Restaurant } from "../domain/restaurant.ts";
import type {
  CreateRestaurantUserInput,
  RestaurantUser,
} from "../domain/restaurant-user.ts";
import { PASSWORD_MAX_BYTES } from "../domain/restaurant-user.ts";
import type { AuthContext, IssuedSession } from "../domain/session.ts";
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from "../errors.ts";
import * as restaurantUsersRepository from "../repositories/restaurant-users.ts";
import * as sessionsRepository from "../repositories/sessions.ts";
import { generateToken, hashToken } from "../tokens.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de autenticação: senha, token e sessão.
 *
 * É o único lugar do código que toca em credencial. Três regras vivem aqui:
 *  1. senha só existe em memória — o que vai ao banco é o hash bcrypt;
 *  2. o token de sessão só existe na resposta do login — o que vai ao banco é
 *     o SHA-256 dele;
 *  3. login errado responde sempre a mesma coisa, e leva sempre o mesmo tempo.
 */

/**
 * Custo do bcrypt. 12 é o padrão; o `BCRYPT_ROUNDS` existe para a suíte de
 * testes baixar para 4 (ver `vitest.config.ts`) — a cada +1 o hash dobra de
 * tempo, e ~30 hashes a custo 12 somariam segundos em cada rodada.
 *
 * O valor é preso entre 4 e 15: um `BCRYPT_ROUNDS=1` vazado para produção por
 * engano cai no piso em vez de enfraquecer a senha em silêncio.
 */
const BCRYPT_ROUNDS = Math.min(
  15,
  Math.max(4, Number(process.env.BCRYPT_ROUNDS ?? 12) || 12),
);

/** Validade da sessão. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Hash descartável usado quando o e-mail não existe.
 *
 * Sem ele, login com e-mail inexistente responderia na hora e login com e-mail
 * certo demoraria o tempo do bcrypt — a diferença é um oráculo que diz quais
 * e-mails estão cadastrados. Comparar contra um hash qualquer faz os dois
 * caminhos custarem o mesmo.
 *
 * Calculado sob demanda (não no import) para não travar o boot da app.
 */
let dummyHash: string | null = null;
function getDummyHash(): string {
  dummyHash ??= bcrypt.hashSync(randomBytes(16).toString("hex"), BCRYPT_ROUNDS);
  return dummyHash;
}

/**
 * O bcrypt ignora tudo depois do byte 72, **em silêncio**: duas senhas que só
 * diferem a partir do byte 73 conferem como iguais. Como `maxLength` do JSON
 * Schema conta caracteres e não bytes (40 letras "ç" já são 80 bytes), a
 * checagem tem que ser aqui.
 */
function assertPasswordFits(password: string): void {
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    throw new ValidationError(
      `A senha excede ${PASSWORD_MAX_BYTES} bytes (acentos e emoji ocupam mais de um byte)`,
    );
  }
}

/**
 * Cadastro: cria o restaurante e o primeiro usuário dele, numa transação.
 *
 * Não devolve sessão — cadastrar e entrar são duas operações, e emitir token
 * aqui faria o cadastro ter dois efeitos. Quem cadastrou chama `/auth/login`.
 */
export async function register(input: {
  restaurant: CreateRestaurantInput;
  user: CreateRestaurantUserInput;
}): Promise<{ restaurant: Restaurant; user: RestaurantUser }> {
  assertPasswordFits(input.user.password);

  // o hash sai da transação de propósito: bcrypt a custo 12 leva centenas de
  // milissegundos, e segurar uma conexão do pool por esse tempo é desperdício
  const passwordHash = await bcrypt.hash(input.user.password, BCRYPT_ROUNDS);

  return withTransaction(async (client) => {
    const restaurant = await restaurantsService.create(
      input.restaurant,
      client,
    );

    const user = await restaurantUsersRepository.insert(
      restaurant.id,
      {
        name: input.user.name,
        email: input.user.email,
        passwordHash,
        // o primeiro usuário é sempre o dono: ele acabou de criar o
        // restaurante, e um restaurante sem nenhum owner não teria como
        // convidar ninguém nem se remover
        role: "owner",
      },
      client,
    );
    if (user === null) {
      // rollback desfaz o restaurante junto: cadastro é tudo ou nada
      throw new ConflictError(
        `O e-mail "${input.user.email}" já está cadastrado`,
      );
    }

    return { restaurant, user };
  });
}

/**
 * Login. Mensagem única para e-mail inexistente e senha errada: dizer qual dos
 * dois falhou entrega ao atacante metade do trabalho.
 */
export async function login(
  email: string,
  password: string,
): Promise<IssuedSession> {
  const user = await restaurantUsersRepository.findByEmailWithHash(email);

  // roda o bcrypt mesmo sem usuário, para o tempo de resposta não denunciar
  const matches = await bcrypt.compare(
    password,
    user?.passwordHash ?? getDummyHash(),
  );
  if (user === null || !matches) {
    throw new UnauthorizedError("E-mail ou senha inválidos");
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await sessionsRepository.insert(user.id, hashToken(token), expiresAt);

  // única vez que o token existe fora do cliente; o banco só tem o hash
  return { token, expiresAt: expiresAt.toISOString() };
}

/** Resolve o token do header em quem está autenticado. `null` = não vale. */
export async function resolve(token: string): Promise<AuthContext | null> {
  return sessionsRepository.findActiveByTokenHash(hashToken(token));
}

/** Logout: revoga a sessão atual. Idempotente do ponto de vista do cliente. */
export async function logout(sessionId: string): Promise<void> {
  await sessionsRepository.revoke(sessionId);
}

/** Dados do usuário da sessão atual (`GET /auth/me`). */
export async function getUser(userId: string): Promise<RestaurantUser> {
  const user = await restaurantUsersRepository.findById(userId);
  if (user === null) {
    // sessão viva apontando para usuário removido não deveria acontecer (a
    // consulta de sessão já filtra), mas o tipo permite e 401 é a resposta certa
    throw new UnauthorizedError("Sessão inválida");
  }
  return user;
}
