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
  /**
   * Identificador público (o que vai no QR code). Opcional na criação: quando
   * não vem, o serviço deriva do `name`. Não é editável por PATCH — mudar a
   * URL pública de um restaurante quebra QR code já impresso, então isso
   * precisa ser uma operação explícita, não efeito colateral de edição.
   */
  slug?: string;
  cuisineType: string;
  logoUrl?: string;
  address: Address;
  isDelivery: boolean;
  isQrcode: boolean;
};

/**
 * Edição parcial: qualquer subconjunto dos campos de criação, menos o `slug`
 * (ver o comentário dele acima).
 */
export type UpdateRestaurantInput = Partial<
  Omit<CreateRestaurantInput, "slug">
>;

/** Restaurante completo, como é guardado e devolvido na resposta. */
export type Restaurant = CreateRestaurantInput & {
  id: string;
  /** Sempre presente na leitura, mesmo quando não foi enviado na criação. */
  slug: string;
  createdAt: string;
  updatedAt: string;
};
