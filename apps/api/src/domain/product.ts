/**
 * Modelo de produto — só tipos, sem runtime. Ver `restaurant.ts`.
 */

/**
 * Campos que o cliente envia para criar um produto.
 * `restaurantId` vem da rota; `id`/`createdAt`/`updatedAt` são do servidor.
 */
export type CreateProductInput = {
  name: string;
  /**
   * A seção do cardápio. Opcional: produto sem categoria é estado legítimo —
   * ele aparece no cardápio, agrupado no fim, em "Sem categoria".
   *
   * É o que permite remover uma seção sem travar quem a usava. A alternativa
   * (recusar a remoção enquanto houver produto) obrigaria a recategorizar o
   * cardápio inteiro à mão só para corrigir um nome digitado errado.
   */
  categoryId?: string;
  priceInCents: number; // inteiro (centavos) — nunca float
  description?: string;
  photoUrl?: string;
  /** Estoque inicial. Ausente = 0 (o default da coluna). */
  stock?: number;
};

/**
 * Edição parcial de produto.
 *
 * `categoryId` aceita `null` de propósito, e é a diferença entre os dois: não
 * mandar o campo é "não mexe na categoria", mandar `null` é "tira daquela
 * seção". Sem o `null` explícito, tirar a categoria de um produto não teria
 * como ser dito.
 */
export type UpdateProductInput = Partial<Omit<CreateProductInput, "categoryId">> & {
  categoryId?: string | null;
};

/** Produto completo, como é guardado e devolvido na resposta. */
export type Product = CreateProductInput & {
  id: string;
  restaurantId: string;
  /** Sempre presente na leitura, mesmo quando não foi enviado na criação. */
  stock: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Produto com os grupos de opções vinculados a ele — só para os pontos de
 * leitura (`getById`/listagem), que juntam o produto ao vínculo
 * (`product_option_groups`) para o painel saber o que já está marcado sem
 * precisar chamar o `PUT` destrutivo para ler.
 *
 * Os ids vêm ordenados pela `position` do vínculo — a mesma ordem que o
 * cardápio público usa.
 */
export type ProductWithOptionGroups = Product & {
  optionGroupIds: string[];
};

/**
 * Filtros da listagem de produtos do restaurante, além da paginação.
 *
 * Os dois servem à mesma tela — a grade de gestão do cardápio — e por isso vêm
 * juntos: filtrar pela seção e procurar pelo nome.
 */
export type ProductFilters = {
  /** Só os produtos desta categoria. */
  categoryId?: string;
  /** Busca por parte do nome, sem diferenciar maiúscula. */
  search?: string;
};
