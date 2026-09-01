import { createHash, randomBytes } from "node:crypto";

/**
 * Segredos opacos: token de sessão e token de acompanhamento de pedido.
 *
 * Os dois seguem a mesma regra e por isso moram juntos: o valor sorteado vai
 * para o cliente **uma vez**, e o banco guarda só o hash. Quem lê um backup, um
 * dump ou um log de query não consegue se passar por ninguém.
 *
 * SHA-256 puro é o certo **aqui**, e continua proibido para senha. A diferença
 * é a entropia da entrada: 256 bits sorteados não têm dicionário nem rainbow
 * table a que sejam vulneráveis, enquanto segredo escolhido por gente exige um
 * KDF caro — que é o bcrypt de `services/auth.ts`.
 */

/** 32 bytes = 256 bits. `base64url` cabe em URL sem escapar nada. */
const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
