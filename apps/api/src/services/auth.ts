import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { pool, withTransaction } from "../db/pool.ts";
import type { CreateRestaurantInput, Restaurant } from "../domain/restaurant.ts";
import type {
  CreateRestaurantUserInput,
  RestaurantUser,
} from "../domain/restaurant-user.ts";
import { PASSWORD_MAX_BYTES } from "../domain/restaurant-user.ts";
import { isUuid } from "../domain/uuid.ts";
import type { AuthContext, IssuedSession } from "../domain/session.ts";
import { PASSWORD_RESET_TOKEN_TTL_MS } from "../domain/password-reset.ts";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../errors.ts";
import { sendEmail } from "../email.ts";
import * as passwordResetRepository from "../repositories/password-reset.ts";
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

/**
 * Base da URL do link de recuperação, e o link em si.
 *
 * Lida do ambiente a cada chamada — não uma constante de módulo — pelo mesmo
 * motivo do `corsOrigins()` de `limits.ts`: permite variar o valor sem
 * reiniciar o processo (e testar os dois). O default de desenvolvimento
 * aponta para o front local; produção configura `PASSWORD_RESET_URL` (ver
 * `.env.example`).
 */
function passwordResetLink(token: string): string {
  const base =
    process.env.PASSWORD_RESET_URL ?? "http://localhost:5173/recuperar-senha";
  return `${base}?token=${encodeURIComponent(token)}`;
}

/**
 * Pede a recuperação de senha: acha o usuário, cria o token e manda o link
 * por e-mail.
 *
 * ⚠️ **Chamada sem `await` pela rota**, que já respondeu 202 antes disso.
 * Responder antes de fazer este trabalho é o que fecha o oráculo de tempo:
 * com o trabalho no caminho da resposta, um e-mail inexistente voltaria mais
 * rápido que um existente, e a diferença diria quais e-mails estão
 * cadastrados — o mesmo problema que o login fecha rodando bcrypt contra um
 * hash descartável, com uma saída melhor aqui: um SMTP lento também deixa de
 * segurar a requisição. Por isso esta função nunca precisa lançar para quem
 * chamou responder — quem chamou já respondeu, e é a própria rota que
 * encapsula a chamada num `.catch()` (ver `routes/auth.ts`).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  // filtra removido nos dois níveis: usuário e restaurante. Sem isso a
  // recuperação viraria o caminho de volta para uma conta que alguém removeu
  const user = await restaurantUsersRepository.findActiveByEmail(email);
  if (user === null) return;

  const token = generateToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

  await withTransaction(async (client) => {
    // um pedido novo invalida os anteriores: sem isso, três tentativas
    // deixariam três tokens vivos espalhados pela caixa de entrada
    await passwordResetRepository.softDeleteLiveForUser(user.id, client);
    await passwordResetRepository.insert(
      { restaurantUserId: user.id, tokenHash: hashToken(token), expiresAt },
      client,
    );
  });

  // FORA da transação, e depois do commit: mandar de dentro dela seguraria
  // uma conexão do pool durante a ida e volta do SMTP — que é rede, e pode
  // levar segundos com um provedor ruim. Se o envio falhar, sobra um token
  // que ninguém recebeu e que expira sozinho em uma hora — o mesmo resultado
  // prático de um e-mail que caiu no spam.
  await sendEmail({
    to: user.email,
    subject: "Recupere sua senha do MenuClick",
    text: `Pediram a troca da senha da sua conta MenuClick. Use o link abaixo em até 1 hora:\n\n${passwordResetLink(token)}\n\nSe não foi você, ignore este e-mail.`,
  });
}

/**
 * Troca a senha usando o token de recuperação por e-mail — a outra ponta de
 * `requestPasswordReset`.
 *
 * Não devolve sessão: quem recuperou entra como todo mundo, por
 * `/auth/login`. Devolver um token aqui trocaria a segunda barreira (provar
 * que conhece a senha nova) por só possuir o link — um e-mail interceptado
 * viraria acesso imediato.
 *
 * Uma mensagem só para token inválido, expirado ou já usado: distinguir diria
 * a quem guarda um link velho se ele um dia existiu. `findLiveByHash` já
 * filtra os três casos no SQL (ver `repositories/password-reset.ts`); a
 * conferência aqui é redundante de propósito — defesa em profundidade, não
 * proteção que falta.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  assertPasswordFits(newPassword);

  const linkInvalido = () =>
    new ValidationError("Link de recuperação inválido ou expirado");

  await withTransaction(async (client) => {
    const linha = await passwordResetRepository.findLiveByHash(
      hashToken(token),
      client,
    );
    if (
      linha === null ||
      linha.usedAt !== null ||
      new Date(linha.expiresAt).getTime() <= Date.now()
    ) {
      throw linkInvalido();
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // `false` = o usuário foi removido depois de o token ser emitido (o
    // `findLiveByHash` não junta com `restaurant_users`, então um token de
    // conta já removida ainda passa pelo filtro acima). Trata como se o link
    // nunca tivesse existido — a mesma mensagem genérica.
    const atualizou = await restaurantUsersRepository.updatePasswordHash(
      linha.restaurantUserId,
      passwordHash,
      client,
    );
    if (!atualizou) throw linkInvalido();

    // `false` = outra troca com o MESMO token venceu a corrida entre a
    // leitura de cima e este ponto. O `update ... where used_at is null` é a
    // linha que serializa as duas tentativas: a perdedora cai aqui, e o
    // rollback da transação desfaz o `updatePasswordHash` que ela acabou de
    // fazer.
    const marcou = await passwordResetRepository.markUsed(linha.id, client);
    if (!marcou) throw linkInvalido();

    // TODAS, sem exceção: não há sessão atual a poupar aqui — a pessoa está
    // trancada para fora, e qualquer sessão viva pertence a quem tem (ou
    // tinha) a senha antiga, que é exatamente quem está sendo trancado.
    await sessionsRepository.revokeAllForUser(
      linha.restaurantUserId,
      undefined,
      client,
    );
  });
}

/** Dados do usuário da sessão atual (`GET /auth/me`). */
/** Erro padrão de usuário inexistente — mesma mensagem em toda a API. */
function userNotFound(id: string): NotFoundError {
  return new NotFoundError(`Usuário com id "${id}" não encontrado`);
}

export async function getUser(userId: string): Promise<RestaurantUser> {
  const user = await restaurantUsersRepository.findById(userId);
  if (user === null) {
    // sessão viva apontando para usuário removido não deveria acontecer (a
    // consulta de sessão já filtra), mas o tipo permite e 401 é a resposta certa
    throw new UnauthorizedError("Sessão inválida");
  }
  return user;
}

/**
 * Troca a senha do usuário da sessão.
 *
 * Exige a senha **atual** mesmo já havendo sessão válida: sem isso, um token
 * roubado trocaria a senha e trancaria o dono para fora da própria conta — o
 * pior resultado possível de um vazamento de token.
 *
 * E derruba as demais sessões, poupando a atual. Trocar senha é o que alguém
 * faz quando desconfia que ela vazou; se as outras continuassem valendo, a
 * troca não resolveria nada. É para isso que a sessão mora no banco.
 *
 * A senha errada aqui é **401**, não 400: o corpo é válido, o que falhou foi a
 * credencial. Diferente do login, não há oráculo a defender — quem chega aqui
 * já provou quem é, e a existência da conta não é segredo para ela mesma.
 *
 * Também invalida qualquer token de recuperação pendente (`resetPassword`):
 * se a pessoa lembrou a senha e trocou por aqui, um link pedido antes não
 * pode continuar valendo pela próxima hora.
 */
export async function changePassword(
  auth: AuthContext,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  assertPasswordFits(newPassword);

  const user = await restaurantUsersRepository.findByIdWithHash(auth.userId);
  if (user === null) throw new UnauthorizedError("Sessão inválida ou expirada");

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new UnauthorizedError("Senha atual incorreta");
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await restaurantUsersRepository.updatePasswordHash(auth.userId, passwordHash);
  // Se a pessoa lembrou da senha e a trocou pelo caminho comum, um token de
  // recuperação pedido antes (por ela mesma, ou por quem tinha acesso à caixa
  // de entrada) não pode continuar valendo pela próxima hora.
  await passwordResetRepository.softDeleteLiveForUser(auth.userId, pool);
  await sessionsRepository.revokeAllForUser(auth.userId, auth.sessionId);
}

/** Os usuários com acesso ao painel do restaurante. */
export async function listUsers(
  restaurantId: string,
): Promise<RestaurantUser[]> {
  return restaurantUsersRepository.findByRestaurant(restaurantId);
}

/**
 * Cria mais um usuário no restaurante.
 *
 * Sem papel informado nasce `staff`: o padrão é o menos poderoso, para que
 * esquecer o campo não dê a alguém o poder de apagar o restaurante. Quem nasce
 * `owner` nasce por escolha explícita, ou por ter feito o cadastro.
 *
 * O hash sai da transação — aqui nem há transação, mas vale a mesma razão do
 * `register`: bcrypt a custo 12 leva centenas de milissegundos.
 */
export async function createUser(
  restaurantId: string,
  input: CreateRestaurantUserInput,
): Promise<RestaurantUser> {
  assertPasswordFits(input.password);

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await restaurantUsersRepository.insert(restaurantId, {
    name: input.name,
    email: input.email,
    passwordHash,
    role: input.role ?? "staff",
  });
  if (user === null) {
    throw new ConflictError(`O e-mail "${input.email}" já está em uso`);
  }
  return user;
}

/**
 * Remove um usuário do restaurante.
 *
 * **Ninguém remove a si mesmo** (409). A regra existe para não deixar alguém
 * se trancar para fora, e ela tem uma consequência que vale de invariante: como
 * só `owner` remove usuário, o último dono nunca consegue sair — então o
 * restaurante sempre tem pelo menos um `owner`, e nunca fica sem quem possa
 * convidar alguém ou encerrá-lo.
 *
 * Não é preciso revogar as sessões do removido: a resolução do token junta
 * `restaurant_users` filtrando `deleted_at is null`, então elas param de valer
 * no mesmo instante. Há teste.
 */
export async function removeUser(
  auth: AuthContext,
  userId: string,
): Promise<void> {
  if (!isUuid(userId)) throw userNotFound(userId);

  if (userId === auth.userId) {
    throw new ConflictError(
      "Você não pode remover a si mesmo. Peça a outro dono do restaurante",
    );
  }

  const removed = await restaurantUsersRepository.softDelete(
    auth.restaurantId,
    userId,
  );
  if (!removed) throw userNotFound(userId);
}
