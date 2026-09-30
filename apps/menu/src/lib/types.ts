export type PriceRule = "sum" | "highest" | "average";
export type PaymentMethod = "cash" | "card_on_delivery" | "pix" | "meal_voucher";

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
  optionGroupIds: string[];
};
export type MenuSection = { id?: string; name: string; products: MenuProduct[] };
export type Menu = { restaurant: MenuRestaurant; sections: MenuSection[]; optionGroups: MenuOptionGroup[] };
