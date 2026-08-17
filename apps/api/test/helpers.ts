import type { FastifyInstance } from "fastify";

export const validRestaurantBody = {
  name: "Tokyo Ramen House",
  cuisineType: "Japonesa",
  address: {
    street: "Avenida Paulista",
    number: "2300",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    zipCode: "01310-300",
  },
  isDelivery: true,
  isQrcode: false,
};

/** Cria um restaurante via API e devolve o corpo já em camelCase. */
export async function createRestaurant(
  app: FastifyInstance,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/restaurants",
    payload: { ...validRestaurantBody, ...overrides },
  });
  return response.json();
}

export const validProductBody = {
  name: "Ramen Shoyu",
  category: "Pratos principais",
  priceInCents: 4890,
};

/** Cria um produto num restaurante via API e devolve o corpo já em camelCase. */
export async function createProduct(
  app: FastifyInstance,
  restaurantId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurantId}/products`,
    payload: { ...validProductBody, ...overrides },
  });
  return response.json();
}
