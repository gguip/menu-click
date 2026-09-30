import type { Menu, MenuRestaurant, MenuSection } from "../src/lib/types.ts";

/**
 * A "Cantina do Porto" do protótipo do handoff. `now` padrão dos testes que
 * dependem de hora: segunda 2026-09-21, 15:00 em São Paulo.
 */
export const SEGUNDA_15H = Date.parse("2026-09-21T15:00:00-03:00");

export function makeRestaurant(overrides: Partial<MenuRestaurant> = {}): MenuRestaurant {
  return {
    id: "8f3c0a52-1d7e-4b6a-9c21-5e4f3a2b1c0d",
    slug: "cantina-do-porto",
    name: "Cantina do Porto",
    cuisineType: "Italiana · Pizzas",
    isDelivery: true,
    isTakeaway: true,
    isQrcode: true,
    freeDeliveryAboveInCents: 5000,
    minimumOrderInCents: 3000,
    isOpen: true,
    acceptingOrders: true,
    closesAt: "2026-09-22T02:00:00.000Z",
    timezone: "America/Sao_Paulo",
    openingHours: [
      { weekday: 2, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 3, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 4, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 5, opensAt: "18:00", closesAt: "00:30" },
      { weekday: 6, opensAt: "18:00", closesAt: "00:30" },
      { weekday: 0, opensAt: "12:00", closesAt: "22:00" },
    ],
    paymentMethods: ["cash", "card_on_delivery", "pix"],
    address: {
      street: "Rua do Porto",
      number: "120",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01010-000",
    },
    deliveryFeeMode: "fixed",
    deliveryNeighborhoods: [],
    ...overrides,
  };
}

export const SECTIONS: MenuSection[] = [
  {
    id: "sec-pizzas",
    name: "Pizzas",
    products: [
      { id: "p-marg", name: "Margherita", description: "Tomate, muçarela de búfala", priceInCents: 5200, available: true, optionGroupIds: ["g-bo"] },
      { id: "p-meio", name: "Meio a meio", description: "Escolha 2 sabores", priceInCents: 3000, available: true, optionGroupIds: ["g-sab", "g-bo"] },
      { id: "p-quatro", name: "Quatro queijos", description: "Gorgonzola, parmesão, provolone", priceInCents: 5800, available: false, optionGroupIds: [] },
      { id: "p-cala", name: "Calabresa", description: "Cebola roxa, orégano", priceInCents: 4900, available: true, optionGroupIds: [] },
    ],
  },
  {
    id: "sec-bebidas",
    name: "Bebidas",
    products: [{ id: "p-agua", name: "Água com gás", description: "500 ml", priceInCents: 600, available: true, optionGroupIds: [] }],
  },
];

export function makeMenu(overrides: Partial<MenuRestaurant> = {}, sections: MenuSection[] = SECTIONS): Menu {
  return {
    restaurant: makeRestaurant(overrides),
    sections,
    optionGroups: [
      {
        id: "g-sab",
        name: "Sabores",
        minOptions: 2,
        maxOptions: 2,
        priceRule: "highest",
        options: [
          { id: "s-marg", name: "Margherita", priceInCents: 4500, maxQuantity: 1 },
          { id: "s-cala", name: "Calabresa", priceInCents: 4500, maxQuantity: 1 },
          { id: "s-quatro", name: "Quatro queijos", priceInCents: 5000, maxQuantity: 1 },
        ],
      },
      {
        id: "g-bo",
        name: "Borda",
        minOptions: 0,
        maxOptions: 1,
        priceRule: "sum",
        options: [
          { id: "o-cat", name: "Catupiry", priceInCents: 800, maxQuantity: 1 },
          { id: "o-ched", name: "Cheddar", priceInCents: 800, maxQuantity: 1 },
        ],
      },
    ],
  };
}
