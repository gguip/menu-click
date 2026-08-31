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
  /** Estoque inicial. Ausente = 0 (o default da coluna). */
  stock?: number;
};

/** Edição parcial de produto. */
export type UpdateProductInput = Partial<CreateProductInput>;

/** Produto completo, como é guardado e devolvido na resposta. */
export type Product = CreateProductInput & {
  id: string;
  restaurantId: string;
  /** Sempre presente na leitura, mesmo quando não foi enviado na criação. */
  stock: number;
  createdAt: string;
  updatedAt: string;
};
