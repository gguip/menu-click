/**
 * Modelo de restaurante — só tipos, sem runtime.
 *
 * Vocabulário compartilhado entre as três camadas: a rota valida o JSON contra
 * ele, o serviço aplica regra em cima dele e o repositório traduz linha do
 * Postgres (snake_case) para ele. Nada aqui conhece Fastify nem SQL.
 */

/** Endereço de um restaurante (value object: quando vem, vem inteiro). */
export type Address = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

/**
 * Campos que o cliente envia para criar um restaurante.
 * `id`, `createdAt` e `updatedAt` NÃO entram aqui — são gerados pelo servidor.
 */
export type CreateRestaurantInput = {
  name: string;
  cuisineType: string;
  logoUrl?: string;
  address: Address;
  isDelivery: boolean;
  isQrcode: boolean;
};

/** Edição parcial: qualquer subconjunto dos campos de criação. */
export type UpdateRestaurantInput = Partial<CreateRestaurantInput>;

/** Restaurante completo, como é guardado e devolvido na resposta. */
export type Restaurant = CreateRestaurantInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
