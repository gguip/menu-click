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
  /** Aceita retirada no balcão. Sem esta flag, todo restaurante aceitaria. */
  isTakeaway: boolean;
  isQrcode: boolean;
  /**
   * Nome IANA do fuso (`America/Sao_Paulo`). Opcional na criação — sem ele,
   * o default da coluna vale. É o que decide onde começa o "hoje" do painel,
   * e é editável por PATCH: ao contrário do slug, mudá-lo não quebra nada que
   * já foi impresso.
   */
  timezone?: string;
  /**
   * A pausa manual: com `false`, ninguém consegue pedir, mesmo dentro da
   * grade de horário. Opcional aqui porque a coluna tem default (`true`) —
   * restaurante nasce aceitando pedidos.
   *
   * Mora neste tipo para chegar ao `Restaurant` e ao `UpdateRestaurantInput`,
   * que derivam dele. Quem o mantém FORA do corpo de criação é o schema da
   * rota, não este tipo: oferecer o campo no cadastro convidaria a criar uma
   * loja já pausada.
   */
  acceptingOrders?: boolean;
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
  /** Idem: a coluna é `not null`, então a leitura sempre traz um fuso. */
  timezone: string;
  /** Idem: a coluna é `not null default true`. */
  acceptingOrders: boolean;
  createdAt: string;
  updatedAt: string;
};
