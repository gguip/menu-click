/**
 * Verificação de e-mail — o token que prova que a loja controla o endereço
 * cadastrado. Só tipos e a validade; nada de runtime além da constante.
 *
 * Espelha `password-reset.ts` de propósito: mesma forma de token (aleatório,
 * o banco só guarda o hash — `src/tokens.ts`), mesmo soft delete.
 */

/**
 * Validade do token: 24 horas — bem mais que a 1h da recuperação de senha, e
 * o perfil de risco é outro. Um token de recuperação vazado dá acesso a uma
 * conta que já existe e tem dado dentro; um de verificação só destrava uma
 * conta vazia (a loja bloqueada não tem cardápio, categoria nem pedido), cuja
 * senha quem o pegou continua não tendo. Uma janela de 1h obrigaria a
 * reenviar quem só lê o e-mail depois do almoço.
 */
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Um pedido de verificação, como o repositório o devolve. Nunca sai da API —
 * não existe `schema.response` para isto, porque nenhuma rota o expõe.
 */
export type EmailVerificationToken = {
  id: string;
  restaurantUserId: string;
  tokenHash: string;
  expiresAt: string;
  /** `null` = ainda não usado. Separado de `deleted_at` (ver a migration). */
  usedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
