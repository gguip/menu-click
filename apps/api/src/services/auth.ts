import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { isTransactionClient, withTransaction } from "../db/pool.ts";
import type { Queryable } from "../db/pool.ts";
import type { CreateRestaurantInput, Restaurant } from "../domain/restaurant.ts";
import type {
  CreateRestaurantUserInput,
  RestaurantUser,
  UserRole,
} from "../domain/restaurant-user.ts";
import { PASSWORD_MAX_BYTES } from "../domain/restaurant-user.ts";
import { isUuid } from "../domain/uuid.ts";
import type { AuthContext, IssuedSession } from "../domain/session.ts";
import { PASSWORD_RESET_TOKEN_TTL_MS } from "../domain/password-reset.ts";
import { EMAIL_VERIFICATION_TOKEN_TTL_MS } from "../domain/email-verification.ts";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../errors.ts";
import { sendEmail } from "../email.ts";
import * as emailVerificationRepository from "../repositories/email-verification.ts";
import * as passwordResetRepository from "../repositories/password-reset.ts";
import * as restaurantsRepository from "../repositories/restaurants.ts";
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
 * Uma tentativa de inserir o usuário, protegida contra o efeito colateral de
 * falhar dentro de uma transação.
 *
 * ⚠️ Mesmo remédio do `tryInsert` de `services/restaurants.ts`, e pelo mesmo
 * motivo: capturar o `23505` em JavaScript **não desfaz o estado do
 * Postgres**. O comando falhou DENTRO da transação, então o bloco está
 * abortado e a próxima query estoura `current transaction is aborted`.
 * Enquanto a colisão de e-mail virava 409 na hora isso não aparecia — o
 * rollback resolvia —, mas agora ela é seguida de uma limpeza e de uma segunda
 * tentativa, que são queries.
 *
 * Fora de transação (pool) não há o que proteger, e `savepoint` ali é erro.
 */
async function tryInsertUser(
  restaurantId: string,
  data: { name: string; email: string; passwordHash: string; role: UserRole },
  db: Queryable,
): Promise<RestaurantUser | null> {
  if (!isTransactionClient(db)) {
    return restaurantUsersRepository.insert(restaurantId, data, db);
  }

  // nome fixo, escrito no código: identificador não aceita $n (S3)
  await db.query("savepoint user_attempt");
  const created = await restaurantUsersRepository.insert(restaurantId, data, db);
  await db.query(
    created === null
      ? "rollback to savepoint user_attempt"
      : "release savepoint user_attempt",
  );
  return created;
}

/**
 * Cadastro: cria o restaurante e o primeiro usuário dele, numa transação.
 *
 * Não devolve sessão — cadastrar e entrar são duas operações, e emitir token
 * aqui faria o cadastro ter dois efeitos. Quem cadastrou chama `/auth/login`.
 *
 * Os dois inserts podem colidir com um **cadastro abandonado** — alguém que se
 * cadastrou e nunca verificou o e-mail. O slug é tratado dentro do
 * `restaurantsService.create`; o e-mail, aqui. Ver
 * `releaseAbandonedRegistration`.
 */
export async function register(input: {
  restaurant: CreateRestaurantInput;
  user: CreateRestaurantUserInput;
}): Promise<{ restaurant: Restaurant; user: RestaurantUser }> {
  assertPasswordFits(input.user.password);

  // o hash sai da transação de propósito: bcrypt a custo 12 leva centenas de
  // milissegundos, e segurar uma conexão do pool por esse tempo é desperdício
  const passwordHash = await bcrypt.hash(input.user.password, BCRYPT_ROUNDS);

  const userData = {
    name: input.user.name,
    email: input.user.email,
    passwordHash,
    // o primeiro usuário é sempre o dono: ele acabou de criar o restaurante, e
    // um restaurante sem nenhum owner não teria como convidar ninguém nem se
    // remover
    role: "owner" as const,
  };

  return withTransaction(async (client) => {
    const restaurant = await restaurantsService.create(
      input.restaurant,
      client,
    );

    let user = await tryInsertUser(restaurant.id, userData, client);

    if (user === null) {
      // O e-mail está ocupado — e este é o caso MAIS comum da liberação de
      // cadastro abandonado: alguém que não recebeu o e-mail de verificação e
      // tenta se cadastrar de novo com o mesmo endereço. Se quem o segura é um
      // cadastro abandonado, ele sai de cena e a segunda tentativa passa.
      //
      // Repetir só o insert do usuário, e não o `register` inteiro: o bcrypt já
      // rodou e o restaurante novo já existe nesta transação.
      const holderId = await restaurantUsersRepository.findRestaurantIdByEmail(
        input.user.email,
        client,
      );
      if (
        holderId !== null &&
        (await restaurantsService.releaseAbandonedRegistration(holderId, client))
      ) {
        user = await tryInsertUser(restaurant.id, userData, client);
      }
    }

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
 * Base da URL do link de verificação, e o link em si. Mesma forma de
 * `passwordResetLink`, lida do ambiente a cada chamada pelo mesmo motivo.
 */
function verifyEmailLink(token: string): string {
  const base =
    process.env.EMAIL_VERIFICATION_URL ?? "http://localhost:5173/verificar-email";
  return `${base}?token=${encodeURIComponent(token)}`;
}

/** Assunto e corpo do e-mail de verificação — comum ao cadastro e ao reenvio. */
function verificationEmailMessage(token: string): { subject: string; text: string } {
  return {
    subject: "Confirme o e-mail do seu restaurante no MenuClick",
    text: `Confirme o e-mail do seu restaurante para liberar o painel. Use o link abaixo em até 24 horas:\n\n${verifyEmailLink(token)}\n\nSe não foi você, ignore este e-mail.`,
  };
}

/**
 * Manda o e-mail que confirma o cadastro.
 *
 * Chamada pela ROTA sem `await`, depois de responder o 201 — mesmo motivo do
 * `requestPasswordReset`: SMTP é rede, e não pode segurar quem acabou de criar
 * a conta. Diferente da recuperação, não há oráculo de tempo a fechar aqui (o
 * 201 já revelou que a conta existe); ficar fora do caminho da resposta é só
 * para não segurar uma conexão do pool numa chamada de rede.
 *
 * Não invalida token anterior (ao contrário do reenvio, `resendEmailVerifi-
 * cation`): um usuário recém-criado não tem token nenhum para invalidar.
 */
export async function sendEmailVerification(user: RestaurantUser): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS);

  await emailVerificationRepository.insert({
    restaurantUserId: user.id,
    tokenHash: hashToken(token),
    expiresAt,
  });

  await sendEmail({ to: user.email, ...verificationEmailMessage(token) });
}

/**
 * Reenvia o link de verificação — a outra ponta de `sendEmailVerification`,
 * para quando o e-mail do cadastro não chegou (SMTP fora do ar naquele
 * minuto) ou a pessoa só quer tentar de novo.
 *
 * Manda para o e-mail de QUEM CHAMA, nunca para outro endereço — o parâmetro
 * é a sessão (`AuthContext`), não um e-mail arbitrário. Não há ambiguidade
 * sobre "reenviar para quem": convidar um usuário é rota escopada em
 * restaurante, portanto bloqueada enquanto a loja não verificar (S32/
 * `authenticate.ts`) — então o único usuário capaz de chamar isto num
 * restaurante ainda não verificado é o dono que acabou de se cadastrar.
 *
 * Invalida o token anterior ANTES de criar o novo, na mesma transação: sem
 * isso, dois links ficariam vivos na caixa de entrada, e o mais velho
 * continuaria funcionando.
 *
 * Chamada pela ROTA sem `await`, depois de responder 202 — mesmo motivo do
 * `sendEmailVerification`/`requestPasswordReset`: não segurar uma conexão do
 * pool durante a ida e volta do SMTP.
 */
export async function resendEmailVerification(auth: AuthContext): Promise<void> {
  const user = await restaurantUsersRepository.findById(auth.userId);
  // sessão válida apontando para usuário removido não deveria acontecer (a
  // consulta de sessão já filtra `deleted_at is null`), mas o tipo permite
  if (user === null) throw new UnauthorizedError("Sessão inválida");

  const token = generateToken();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS);

  await withTransaction(async (client) => {
    await emailVerificationRepository.softDeleteLiveForUser(user.id, client);
    await emailVerificationRepository.insert(
      { restaurantUserId: user.id, tokenHash: hashToken(token), expiresAt },
      client,
    );
  });

  // FORA da transação e depois do commit: sendEmail é rede, e segurar uma
  // conexão do pool durante a ida e volta do SMTP é desperdício.
  await sendEmail({ to: user.email, ...verificationEmailMessage(token) });
}

/**
 * Consome o token de verificação e libera o painel do restaurante.
 *
 * Mensagem única para token inválido, expirado ou já usado — mesmo motivo do
 * `resetPassword`: distinguir diria a quem guarda um link velho se ele um dia
 * existiu. `findLiveByHash` já filtra os três casos no SQL; a checagem aqui
 * não repete nenhum, só decide o que fazer com `null`.
 */
export async function verifyEmail(token: string): Promise<void> {
  const linkInvalido = () =>
    new ValidationError(
      "Link de verificação inválido, expirado ou já usado",
    );

  const linha = await emailVerificationRepository.findLiveByHash(
    hashToken(token),
  );
  if (linha === null) throw linkInvalido();

  const user = await restaurantUsersRepository.findById(linha.restaurantUserId);
  // sessão viva apontando para usuário removido não deveria acontecer (mesmo
  // raciocínio do `getUser`), mas o tipo permite
  if (user === null) throw linkInvalido();

  await withTransaction(async (client) => {
    // é este `update ... where used_at is null` — não a checagem de cima —
    // que serializa duas verificações concorrentes com o MESMO token; a de
    // cima é só saída antecipada, igual em `resetPassword`
    const marcou = await emailVerificationRepository.markUsed(linha.id, client);
    if (!marcou) throw linkInvalido();

    await restaurantsRepository.markEmailVerified(user.restaurantId, client);
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

  // 🚨 A ORDEM aqui é a defesa, e ela já esteve errada.
  //
  // O token é conferido ANTES do bcrypt. Trocar os dois faria toda tentativa
  // com token inventado queimar um hash inteiro — medido em 190 ms — numa rota
  // pública, anônima e que ninguém precisa de credencial para chamar. Quem
  // quisesse derrubar a recuperação só precisaria mandar lixo em volume, e
  // derrubaria justamente a rota que tem de funcionar quando alguém está
  // trancado para fora.
  //
  // E o bcrypt continua FORA da transação, pelo mesmo motivo do `register()`:
  // custo 12 leva centenas de milissegundos, e segurar uma conexão do pool por
  // esse tempo é desperdício. As duas exigências juntas dão esta ordem:
  // consulta barata -> recusa cedo -> hash caro -> transação curta.
  const linha = await passwordResetRepository.findLiveByHash(hashToken(token));
  // O filtro mora inteiro no `findLiveByHash`: ele já exige `deleted_at is
  // null`, `used_at is null` e `expires_at > now()`. Repetir as duas últimas
  // aqui seria código inalcançável — a consulta nunca devolve linha que falhe
  // nelas —, e três condições fariam o leitor supor três modos de falha que
  // ele conseguiria exercitar.
  if (linha === null) throw linkInvalido();

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await withTransaction(async (client) => {
    // `false` = o usuário foi removido depois de o token ser emitido.
    //
    // ⚠️ Isto cobre o USUÁRIO removido, não o restaurante dele. Um token
    // emitido antes de `DELETE /restaurants/:id` ainda troca a senha — o que
    // é coerente com o login, que hoje também deixa entrar nesse caso, e
    // inofensivo porque todo recurso do restaurante removido responde 404. O
    // `findActiveByEmail` filtra os dois níveis na hora de EMITIR; aqui só o
    // usuário. A assimetria está escrita porque um comentário anterior
    // prometia os dois e a revisão da branch pegou a promessa falsa.
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

  // As três numa transação só: sem ela, falhar no meio deixa a senha trocada
  // com um token de recuperação ainda vivo pela próxima hora — que é
  // exatamente o estado que a invalidação foi acrescentada para impedir. Duas
  // das três já corriam soltas antes desta feature; a terceira entrou no meio,
  // e é ela que torna o meio-estado perigoso em vez de só inconsistente.
  await withTransaction(async (client) => {
    await restaurantUsersRepository.updatePasswordHash(auth.userId, passwordHash, client);
    // Se a pessoa lembrou da senha e a trocou pelo caminho comum, um token de
    // recuperação pedido antes (por ela mesma, ou por quem tinha acesso à caixa
    // de entrada) não pode continuar valendo pela próxima hora.
    await passwordResetRepository.softDeleteLiveForUser(auth.userId, client);
    await sessionsRepository.revokeAllForUser(auth.userId, auth.sessionId, client);
  });
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
