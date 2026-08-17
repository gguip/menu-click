/**
 * Modelo de produto — só tipos, sem runtime. Ver `restaurant.ts`.
 */

/**
 * Campos que o cliente envia para criar um produto.
 * `restaurantId` vem da rota; `id`/`createdAt`/`updatedAt` são do servidor.
 */
export type CreateProductInput = {
  name: string;
  category: string;
  priceInCents: number; // inteiro (centavos) — nunca float
  description?: string;
  photoUrl?: string;
};

/** Edição parcial de produto. */
export type UpdateProductInput = Partial<CreateProductInput>;

/** Produto completo, como é guardado e devolvido na resposta. */
export type Product = CreateProductInput & {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
};

/** Resultado de uma compra: o que sobrou no estoque depois de dar baixa. */
export type Purchase = {
  productId: string;
  stockRemaining: number;
};
