import { saveSession } from "../src/api/session.ts";
import type {
  Category,
  Me,
  OptionGroup,
  Order,
  OrderDetail,
  OrdersSummary,
  Product,
  Restaurant,
} from "../src/api/types.ts";

export const RESTAURANT_ID = "cb95db58-0ea1-4157-a6fd-64f775f24a6e";

export function signIn(): void {
  saveSession({ token: "token-de-teste", expiresAt: "2099-01-01T00:00:00.000Z" });
}

export function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    id: "2f8a1c04-9d3e-4b57-8a26-0c5e7b91d4f3",
    restaurantId: RESTAURANT_ID,
    name: "Cláudia Mendes",
    email: "gerencia@trattoriabella.com.br",
    role: "owner",
    emailVerified: true,
    ...overrides,
  };
}

export function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: RESTAURANT_ID,
    slug: "trattoria-bella",
    name: "Trattoria Bella",
    cuisineType: "Italiana",
    address: {
      street: "Rua Aspicuelta",
      number: "120",
      neighborhood: "Vila Madalena",
      city: "São Paulo",
      state: "SP",
      zipCode: "05433-010",
    },
    isDelivery: true,
    isTakeaway: true,
    isQrcode: true,
    timezone: "America/Sao_Paulo",
    acceptingOrders: true,
    acceptsCash: true,
    acceptsCardOnDelivery: true,
    acceptsPix: true,
    acceptsMealVoucher: false,
    deliveryFeeMode: "fixed",
    deliveryFixedFeeInCents: 900,
    deliveryFeeToArrange: false,
    minimumOrderInCents: 0,
    ...overrides,
  };
}

let orderSeq = 0;

/** Ids distintos a cada chamada: #A001, #A002... (passe `id` para fixar). */
export function makeOrder(overrides: Partial<Order> = {}): Order {
  orderSeq += 1;
  const head = (0xa000 + orderSeq).toString(16);
  return {
    id: `${head}f00d-0000-4000-8000-000000000000`,
    restaurantId: RESTAURANT_ID,
    customer: { id: "c1", name: "Marcela Andrade", phone: "11987654321" },
    type: "delivery",
    status: "pending",
    totalInCents: 10100,
    deliveryFeeInCents: 900,
    deliveryAddress: {
      street: "Rua Harmonia",
      number: "45",
      neighborhood: "Vila Madalena",
      city: "São Paulo",
      state: "SP",
      zipCode: "05435-000",
    },
    paymentMethod: "pix",
    table: null,
    createdAt: "2026-09-19T22:58:00.000Z",
    updatedAt: "2026-09-19T22:58:00.000Z",
    ...overrides,
  };
}

export function makeOrderDetail(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    ...makeOrder(overrides),
    items: [
      {
        id: "i1",
        productId: "p1",
        name: "Pizza Grande",
        priceInCents: 3000,
        unitPriceInCents: 4000,
        quantity: 2,
        options: [
          { optionId: "o1", groupName: "Sabores", name: "Calabresa", priceInCents: 4000, quantity: 1 },
          { optionId: "o2", groupName: "Sabores", name: "Portuguesa", priceInCents: 3800, quantity: 1 },
          { optionId: "o3", groupName: "Borda", name: "Catupiry", priceInCents: 800, quantity: 1 },
        ],
      },
      {
        id: "i2",
        productId: "p2",
        name: "Coca 2L",
        priceInCents: 1200,
        unitPriceInCents: 1200,
        quantity: 1,
        options: [],
      },
    ],
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<OrdersSummary> = {}): OrdersSummary {
  return {
    period: { from: "2026-09-19T03:00:00.000Z", to: "2026-09-20T03:00:00.000Z" },
    counts: {
      pending: 0,
      confirmed: 0,
      preparing: 0,
      ready_for_pickup: 0,
      out_for_delivery: 0,
      completed: 0,
      cancelled: 0,
    },
    revenueInCents: 0,
    revenueOrderCount: 0,
    averageTicketInCents: 0,
    ...overrides,
  };
}

export function makeCategory(overrides: Partial<Category> = {}): Category {
  return { id: "cat-1", restaurantId: RESTAURANT_ID, name: "Pizzas", position: 0, ...overrides };
}

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    restaurantId: RESTAURANT_ID,
    name: "Pizza Grande",
    categoryId: "cat-1",
    priceInCents: 4590,
    description: "Massa fina, 8 fatias. Escolha até 2 sabores.",
    stock: 12,
    optionGroupIds: [],
    ...overrides,
  };
}

export function makeOptionGroup(overrides: Partial<OptionGroup> = {}): OptionGroup {
  return {
    id: "grp-1",
    restaurantId: RESTAURANT_ID,
    name: "Sabores",
    minOptions: 1,
    maxOptions: 2,
    priceRule: "highest",
    options: [],
    ...overrides,
  };
}
