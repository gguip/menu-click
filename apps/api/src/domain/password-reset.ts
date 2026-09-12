/**
 * Recuperação de senha — o token que autoriza trocar a senha sem sessão.
 * Só tipos e a validade; nada de runtime além da constante.
 *
 * Espelha `sessions`/`trackingToken` de propósito: o valor sorteado (gerado
 * por `generateToken()`) vai para o e-mail, e só o hash mora aqui dentro —
 * ver `token_hash` na migration e `src/tokens.ts`.
 */

/**
 * Validade do token: uma hora.
 *
 * Curto de propósito — é link de e-mail, não sessão de painel. Uma janela
 * longa aumentaria o estrago de uma caixa de entrada comprometida depois do
 * pedido; se a pessoa não usar a tempo, pede de novo.
 */
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Um pedido de recuperação, como o repositório o devolve. Nunca sai da API —
 * não existe `schema.response` para isto, porque nenhuma rota o expõe.
 */
export type PasswordResetToken = {
  id: string;
  restaurantUserId: string;
  tokenHash: string;
  expiresAt: string;
  /** `null` = ainda não usado. Separado de `deleted_at` (ver a migration). */
  usedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
