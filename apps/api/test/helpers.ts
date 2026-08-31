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

export const validCustomerBody = {
  name: "Ana Souza",
  phone: "11999990000",
};

/** Cria um pedido via API e devolve o corpo já em camelCase. */
export async function createOrder(
  app: FastifyInstance,
  restaurantId: string,
  items: { productId: string; quantity: number }[],
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurantId}/orders`,
    payload: { customer: validCustomerBody, items, ...overrides },
  });
  return response.json();
}

export const validUserBody = {
  name: "Guilherme Dono",
  email: "dono@tokyoramen.com.br",
  password: "senha-do-dono-123",
};

/**
 * Cadastra restaurante + primeiro usuário e devolve os dois, mais a senha em
 * texto (os testes precisam dela para o login; a API nunca devolve).
 */
export async function registerRestaurant(
  app: FastifyInstance,
  overrides: {
    restaurant?: Record<string, unknown>;
    user?: Record<string, unknown>;
  } = {},
) {
  const payload = {
    restaurant: { ...validRestaurantBody, ...overrides.restaurant },
    user: { ...validUserBody, ...overrides.user },
  };
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload,
  });
  return { ...response.json(), password: payload.user.password as string };
}

/** Faz login e devolve o token. */
export async function login(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  return response.json().token;
}

/** Header pronto para `app.inject({ headers })`. */
export function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Cadastra e já entra: o par que quase todo teste protegido precisa. */
export async function registerAndLogin(
  app: FastifyInstance,
  overrides: {
    restaurant?: Record<string, unknown>;
    user?: Record<string, unknown>;
  } = {},
) {
  const { restaurant, user, password } = await registerRestaurant(
    app,
    overrides,
  );
  const token = await login(app, user.email, password);
  return { restaurant, user, token, headers: authHeaders(token) };
}
