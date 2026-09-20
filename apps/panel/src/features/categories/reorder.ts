import type { Category } from "../../api/types.ts";

/**
 * Renumera pela ordem da lista e devolve só quem mudou. Trocar apenas as duas
 * posições não basta: com buraco ou empate (o empate é desfeito pelo nome),
 * trocar dois "3" não moveria nada.
 */
export function positionUpdates(
  ordered: readonly Pick<Category, "id" | "position">[],
): { id: string; position: number }[] {
  return ordered.flatMap((category, index) =>
    category.position === index ? [] : [{ id: category.id, position: index }],
  );
}

/** O índice único da API é sobre lower(name): "bebidas" colide com "Bebidas". */
export function findDuplicate(
  name: string,
  categories: readonly Category[],
  exceptId?: string,
): Category | undefined {
  const wanted = name.trim().toLocaleLowerCase("pt-BR");
  return categories.find(
    (category) => category.id !== exceptId && category.name.trim().toLocaleLowerCase("pt-BR") === wanted,
  );
}
