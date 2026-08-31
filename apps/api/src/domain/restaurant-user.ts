/**
 * Usuário do restaurante — quem faz login no painel. Só tipos, sem runtime.
 *
 * Não confundir com `Customer`: o cliente que escaneia o QR code não tem conta.
 * Este é o lado de dentro — dono, gerente, garçom — e pertence a **um**
 * restaurante, que é o que torna a autorização uma comparação simples.
 */

/** Tamanho mínimo de senha aceito. O máximo é em BYTES — ver abaixo. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Limite do bcrypt, em **bytes**, não em caracteres.
 *
 * O bcrypt ignora tudo depois do byte 72 — e ignora em silêncio: verificado que
 * duas senhas que só diferem a partir do byte 73 conferem como iguais. Como
 * `maxLength` do JSON Schema conta caracteres, ele não cobre isso: 40 letras
 * "ç" já são 80 bytes em UTF-8. Por isso o serviço mede com
 * `Buffer.byteLength` antes de chamar o hash.
 */
export const PASSWORD_MAX_BYTES = 72;

/** O que se envia para criar um usuário. `restaurantId` vem do contexto. */
export type CreateRestaurantUserInput = {
  name: string;
  email: string;
  password: string;
};

/**
 * Usuário como a API o devolve.
 *
 * `passwordHash` **não** está aqui de propósito: o tipo de leitura não carrega
 * o segredo, então nem por descuido ele chega perto de um `schema.response`.
 * Quem precisa do hash é só o login, e ele usa um tipo interno do repositório.
 */
export type RestaurantUser = {
  id: string;
  restaurantId: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};
