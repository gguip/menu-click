/**
 * Slug: o identificador público do restaurante, o que vai dentro do QR code.
 *
 * Como o `isUuid`, é um dos poucos pedaços de runtime que moram no domínio —
 * as três camadas precisam da mesma noção de "slug válido": a rota valida o que
 * o cliente mandou, o serviço deriva do nome e o banco tem o índice único.
 */

/** Formato aceito: minúsculas, números e hífen simples, sem hífen nas pontas. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Tamanho máximo — o mesmo valor está no `maxLength` do schema da rota. */
export const SLUG_MAX_LENGTH = 60;

export function isSlug(value: string) {
  return value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}

/**
 * Deriva um slug a partir do nome do restaurante.
 *
 * `normalize("NFD")` separa a letra do acento ("ã" vira "a" + "◌̃"), e aí o
 * filtro de marcas diacríticas (`\p{M}`) tira só o acento — "São" vira "sao",
 * não "s-o". É o que a biblioteca padrão do Node dá de graça; nenhuma
 * dependência entra por causa disso.
 *
 * Pode devolver string vazia (nome só de emoji, por exemplo). Quem chama trata:
 * o serviço cai no sufixo aleatório quando isso acontece.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}
