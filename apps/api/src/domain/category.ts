/**
 * Modelo de categoria — as seções do cardápio ("Entradas", "Pratos",
 * "Sobremesas"). Só tipos, sem runtime. Ver `restaurant.ts`.
 *
 * Ela existe como entidade, e não como o texto livre que era antes, por três
 * motivos que o texto não resolvia: renomear uma seção era editar produto por
 * produto, "Bebidas" e "bebidas" conviviam no mesmo cardápio, e não havia onde
 * guardar a **ordem** das seções.
 */

/** Campos que o restaurante envia para criar uma categoria. */
export type CreateCategoryInput = {
  name: string;
  /**
   * Onde a seção aparece no cardápio. Ausente = vai para o fim.
   *
   * Não é alfabética de propósito: "Entradas" vem antes de "Sobremesas" pela
   * sequência da refeição, e por nome "Bebidas" abriria todo cardápio.
   */
  position?: number;
};

/** Edição parcial de categoria — inclusive só a posição, para reordenar. */
export type UpdateCategoryInput = Partial<CreateCategoryInput>;

/** Categoria completa, como é guardada e devolvida na resposta. */
export type Category = CreateCategoryInput & {
  id: string;
  restaurantId: string;
  /** Sempre presente na leitura, mesmo quando não foi enviada na criação. */
  position: number;
  createdAt: string;
  updatedAt: string;
};
