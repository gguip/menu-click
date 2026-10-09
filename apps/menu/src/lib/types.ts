export type PriceRule = "sum" | "highest" | "average";
export type PaymentMethod = "cash" | "card_on_delivery" | "pix" | "meal_voucher";

export type Address = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

export type OpeningHour = { weekday: number; opensAt: string; closesAt: string };

export type MenuRestaurant = {
  id: string;
  slug: string;
  name: string;
  cuisineType: string;
  logoUrl?: string;
  coverUrl?: string;
  brandColor?: string;
  isDelivery: boolean;
  isTakeaway: boolean;
  isQrcode: boolean;
  freeDeliveryAboveInCents?: number;
  minimumOrderInCents: number;
  isOpen: boolean;
  acceptingOrders: boolean;
  closesAt?: string;
  opensAt?: string;
  timezone: string;
  openingHours: OpeningHour[];
  paymentMethods: PaymentMethod[];
  /** O endereço da loja: onde se retira, e de onde saem cidade e UF da entrega. */
  address: Address;
  deliveryFeeMode: "neighborhood" | "fixed" | "distance";
  /** Nomes dos bairros atendidos no modo por bairro; vazia nos outros. */
  deliveryNeighborhoods: string[];
};

export type MenuOption = { id: string; name: string; priceInCents: number; maxQuantity: number };
export type MenuOptionGroup = {
  id: string;
  name: string;
  minOptions: number;
  maxOptions: number;
  priceRule: PriceRule;
  options: MenuOption[];
};
export type MenuProduct = {
  id: string;
  name: string;
  priceInCents: number;
  description?: string;
  photoUrl?: string;
  available: boolean;
  /**
   * A loja marcou para oferecer no carrinho. Opcional: a página do cardápio
   * pode ter saído do cache antes de a API mandar o campo.
   */
  suggested?: boolean;
  optionGroupIds: string[];
};
export type MenuSection = { id?: string; name: string; products: MenuProduct[] };
export type Menu = { restaurant: MenuRestaurant; sections: MenuSection[]; optionGroups: MenuOptionGroup[] };
