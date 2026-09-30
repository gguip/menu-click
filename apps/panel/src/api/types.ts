export type Address = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

export type UserRole = "owner" | "staff";

export type Me = {
  id: string;
  restaurantId: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
};

export type LoginResponse = { token: string; expiresAt: string };

export type DeliveryFeeMode = "neighborhood" | "fixed" | "distance";

export type Restaurant = {
  id: string;
  slug: string;
  name: string;
  cuisineType: string;
  logoUrl?: string;
  address: Address;
  isDelivery: boolean;
  isTakeaway: boolean;
  isQrcode: boolean;
  timezone: string;
  acceptingOrders: boolean;
  acceptsCash: boolean;
  acceptsCardOnDelivery: boolean;
  acceptsPix: boolean;
  acceptsMealVoucher: boolean;
  deliveryFeeMode: DeliveryFeeMode;
  deliveryFixedFeeInCents: number;
  freeDeliveryAboveInCents?: number;
  deliveryFeeToArrange: boolean;
  minimumOrderInCents: number;
  /** Capa do cardápio do cliente; ausente = sem capa. */
  coverUrl?: string;
  /** Cor da ação no app do cliente (#RRGGBB); ausente = azul padrão. */
  brandColor?: string;
  /**
   * Só o GET traz (PATCH não calcula): se a loja está dentro da grade agora.
   * Ausente enquanto não houve GET — e o cache preserva o último valor.
   */
  openingStatus?: { isOpen: boolean; closesAt?: string; opensAt?: string };
};

export type OrderType = "dine_in" | "takeaway" | "delivery";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready_for_pickup"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

export type PaymentMethod = "cash" | "card_on_delivery" | "pix" | "meal_voucher";

export type Period = "today" | "yesterday" | "last7days" | "thisMonth";

/** "accept" é do painel: vira `confirm` na URL (ver `api/orders.ts`). */
export type OrderTransition =
  | "accept"
  | "start-preparing"
  | "dispatch"
  | "ready"
  | "complete"
  | "cancel";

export type Customer = { id: string; name: string; phone: string };

export type Order = {
  id: string;
  restaurantId: string;
  /** Contínuo por loja: é o `#1042` do balcão. */
  number: number;
  customer: Customer;
  type: OrderType;
  status: OrderStatus;
  totalInCents: number;
  /** `null` = "a combinar" OU pedido que não é entrega. `0` = grátis. */
  deliveryFeeInCents: number | null;
  deliveryAddress: Address | null;
  paymentMethod: PaymentMethod;
  /** Ausente no dinheiro = o cliente tem o valor exato. */
  changeForInCents?: number;
  /** `null` = a loja não marcou como pago. */
  paidAt: string | null;
  table: { id: string; label: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type OrderItemOption = {
  optionId: string;
  groupName: string;
  name: string;
  priceInCents: number;
  quantity: number;
};

export type OrderItem = {
  id: string;
  productId: string;
  name: string;
  priceInCents: number;
  unitPriceInCents: number;
  quantity: number;
  options: OrderItemOption[];
  /** Observação do cliente ("sem cebola"); `null` = nenhuma. */
  note: string | null;
};

export type OrderStatusEvent = { status: OrderStatus; at: string };

/** O detalhe traz o histórico; pedido anterior ao registro tem só chegada e status atual. */
export type OrderDetail = Order & { items: OrderItem[]; statusHistory: OrderStatusEvent[] };

export type OrdersSummary = {
  period: { from: string; to: string };
  counts: Record<OrderStatus, number>;
  /** Valor por status (frete embutido). Inclui cancelado: NÃO é faturamento. */
  totalsInCents: Record<OrderStatus, number>;
  revenueInCents: number;
  revenueOrderCount: number;
  averageTicketInCents: number;
};

export type Page<T> = { data: T[]; limit: number; offset: number; total: number };

export type Category = { id: string; restaurantId: string; name: string; position: number };

export type Product = {
  id: string;
  restaurantId: string;
  name: string;
  categoryId?: string;
  priceInCents: number;
  description?: string;
  photoUrl?: string;
  stock: number;
  optionGroupIds: string[];
};

export type PriceRule = "sum" | "highest" | "average";

export type Option = {
  id: string;
  name: string;
  priceInCents: number;
  maxQuantity: number;
  available: boolean;
  position: number;
};

export type OptionGroup = {
  id: string;
  restaurantId: string;
  name: string;
  minOptions: number;
  maxOptions: number;
  priceRule: PriceRule;
  options: Option[];
};

/**
 * O grupo como a LISTAGEM devolve: com `productCount` (produtos vivos que o
 * usam), calculado no SQL da API. Criar e editar devolvem o grupo sem ele.
 */
export type ListedOptionGroup = OptionGroup & { productCount: number };

export type Table = { id: string; restaurantId: string; label: string; hash: string; qrUrl: string };

/**
 * Usuário do restaurante. O papel não se edita: a API não tem
 * `PATCH .../users/:id`, então trocar é remover e convidar de novo.
 */
export type RestaurantUser = {
  id: string;
  restaurantId: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryNeighborhood = { name: string; feeInCents: number };

/** Uma faixa de funcionamento. `opensAt`/`closesAt` são hora de parede, "HH:MM". */
export type OpeningHour = { id: string; weekday: number; opensAt: string; closesAt: string };

export type RegisterInput = {
  restaurant: {
    name: string;
    cuisineType: string;
    address: Address;
    isDelivery: boolean;
    isTakeaway: boolean;
    isQrcode: boolean;
  };
  user: { name: string; email: string; password: string };
};
