/**
 * Sessão — o que um token válido representa. Só tipos, sem runtime.
 *
 * A sessão é **opaca e guardada no banco**, não um JWT: o token é aleatório e
 * não carrega informação nenhuma. O custo é uma consulta por requisição
 * autenticada; o ganho é que revogar (logout, senha trocada, funcionário
 * demitido) é apagar uma linha, em vez de manter uma lista negra — que seria
 * exatamente o estado no banco que o JWT queria evitar.
 */

import type { UserRole } from "./restaurant-user.ts";

/** O que o login devolve. `token` só existe neste instante; o banco só vê o hash. */
export type IssuedSession = {
  token: string;
  expiresAt: string;
};

/**
 * Quem está fazendo a requisição, resolvido a partir do token.
 *
 * `restaurantId` vem junto porque é a base de toda autorização: nenhuma rota
 * de gestão mexe em restaurante diferente do que está aqui.
 */
export type AuthContext = {
  sessionId: string;
  userId: string;
  restaurantId: string;
  /**
   * O papel vem junto da sessão, e não de uma consulta separada na rota: ele é
   * lido na mesma query que já resolve o token, então checar permissão não
   * custa nenhuma ida a mais ao banco.
   */
  role: UserRole;
  /**
   * Se a LOJA (não o usuário) já provou o e-mail. Também vem da mesma query
   * — mas aqui o preço é maior que o do `role`: `email_verified_at` mora em
   * `restaurants`, então resolver isto é um JOIN A MAIS em toda requisição
   * autenticada (ver `repositories/sessions.ts`). Continua sendo **uma** ida
   * ao banco, que é o que importa; a alternativa seria uma segunda consulta
   * no hook de `authenticate.ts`.
   */
  emailVerified: boolean;
};
