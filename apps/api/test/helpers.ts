import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { currentTestIp } from "./setup.ts";

/**
 * O `buildApp()` da aplicação, com um detalhe só: cada `inject` sai do IP do
 * teste em execução, em vez de todos saírem de 127.0.0.1.
 *
 * É feito aqui, embrulhando o `inject`, para não ter que repetir
 * `remoteAddress` em cada uma das centenas de chamadas — e para que um teste
 * novo herde o comportamento sem saber que ele existe. Chamada que passa
 * `remoteAddress` explicitamente continua mandando (o spread preserva).
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  const inject = app.inject.bind(app);
  app.inject = ((options: Record<string, unknown>) =>
    inject({ remoteAddress: currentTestIp(), ...options })) as typeof app.inject;
  return app;
}

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
  isTakeaway: true,
  isQrcode: true,
};

/**
 * Grade que cobre os 1440 minutos do dia, nos sete dias da semana.
 *
 * `00:00–23:59` sozinha DEIXA UM BURACO: `isOpenNow` compara
 * `local::time < closes_at`, então o minuto 23:59 inteiro (23:59:00 a
 * 23:59:59) fica de fora — verificado no Postgres. A segunda faixa,
 * `23:59–00:00`, tem `closes_at < opens_at` e por isso entra no ramo que
 * atravessa a meia-noite, cobrindo exatamente esse minuto. As duas juntas, nos
 * sete dias, não deixam instante nenhum descoberto (verificado com valores no
 * limite: 00:00:00, 23:59:00, 23:59:59 e a virada para o dia seguinte).
 */
const GRADE_SEMPRE_ABERTA = Array.from({ length: 7 }, (_, weekday) => weekday).flatMap(
  (weekday) => [
    { weekday, opensAt: "00:00", closesAt: "23:59" },
    { weekday, opensAt: "23:59", closesAt: "00:00" },
  ],
);

/**
 * Cria um restaurante — hoje isso significa **cadastrar**, porque não existe
 * mais restaurante sem dono (`POST /restaurants` deixou de existir).
 *
 * Devolve o restaurante com `token` e `headers` junto: quase toda rota de
 * gestão precisa deles, e passá-los à parte espalharia o mesmo par por todos
 * os testes.
 *
 * Nasce com a grade `GRADE_SEMPRE_ABERTA`: desde a Task 6, restaurante sem
 * grade está fechado, e um restaurante de teste que não é sobre horário não
 * deveria precisar saber disso para conseguir criar um pedido. Um teste que
 * precise de loja fechada sobrescreve com `setOpeningHours`.
 */
export async function createRestaurant(
  app: FastifyInstance,
  overrides: Record<string, unknown> = {},
) {
  const { restaurant, token } = await registerAndLogin(app, {
    restaurant: overrides,
  });
  const withHeaders = { ...restaurant, token, headers: authHeaders(token) };
  await setOpeningHours(app, withHeaders, GRADE_SEMPRE_ABERTA);
  return withHeaders;
}

/** Restaurante criado por `createRestaurant`, já com credencial. */
export type TestRestaurant = { id: string; slug: string } & Record<
  string,
  unknown
> & { token: string; headers: { authorization: string } };

export const validProductBody = {
  name: "Ramen Shoyu",
  priceInCents: 4890,
};

/**
 * Cria uma categoria via API. Como `createProduct`, recebe o restaurante
 * inteiro porque é rota de gestão e precisa do `headers`.
 */
export async function createCategory(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/categories`,
    headers: restaurant.headers,
    payload: { name: "Pratos principais", ...overrides },
  });
  return response.json();
}

/**
 * Cria um produto via API. Recebe o restaurante inteiro (não só o id) porque
 * criar produto é rota de gestão e precisa do `headers` que vem junto dele.
 */
export async function createProduct(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/products`,
    headers: restaurant.headers,
    payload: { ...validProductBody, ...overrides },
  });
  return response.json();
}

/**
 * Cria um grupo de opções via API. Como `createProduct`, recebe o restaurante
 * inteiro porque é rota de gestão e precisa do `headers`.
 */
export async function createOptionGroup(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/option-groups`,
    headers: restaurant.headers,
    payload: {
      name: "Adicionais",
      minOptions: 0,
      maxOptions: 3,
      priceRule: "sum",
      ...overrides,
    },
  });
  return response.json();
}

/** Cria uma opção dentro de um grupo, via API. */
export async function createOption(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  optionGroupId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/option-groups/${optionGroupId}/options`,
    headers: restaurant.headers,
    payload: { name: "Bacon", priceInCents: 500, ...overrides },
  });
  return response.json();
}

/** Define a lista ordenada de grupos de opções de um produto. */
export function linkOptionGroups(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  productId: string,
  optionGroupIds: string[],
) {
  return app.inject({
    method: "PUT",
    url: `/restaurants/${restaurant.id}/products/${productId}/option-groups`,
    headers: restaurant.headers,
    payload: { optionGroupIds },
  });
}

export const validCustomerBody = {
  name: "Ana Souza",
  phone: "11999990000",
};

/**
 * Cria um pedido via API e devolve o corpo já em camelCase.
 *
 * O default é `dine_in` por ser a modalidade sem endereço nem pré-requisito —
 * quem quer exercitar entrega ou retirada passa `type` no `overrides` (e o
 * endereço junto, no caso da entrega).
 */
export async function createOrder(
  app: FastifyInstance,
  restaurantId: string,
  items: {
    productId: string;
    quantity: number;
    options?: { optionId: string; quantity: number }[];
  }[],
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurantId}/orders`,
    payload: {
      type: "dine_in",
      customer: validCustomerBody,
      items,
      paymentMethod: "cash",
      ...overrides,
    },
  });
  return response.json();
}

/** Endereço de entrega de exemplo, para os testes de `type: "delivery"`. */
export const validDeliveryAddress = {
  street: "Rua Augusta",
  number: "1500",
  neighborhood: "Consolação",
  city: "São Paulo",
  state: "SP",
  zipCode: "01304-001",
};

export const validUserBody = {
  name: "Guilherme Dono",
  email: "dono@tokyoramen.com.br",
  password: "senha-do-dono-123",
};

/**
 * E-mail diferente a cada chamada. O índice é único entre os vivos, então dois
 * cadastros no mesmo teste colidiriam — e o `truncate` do `setup.ts` só roda
 * entre testes, não dentro de um.
 */
let emailCounter = 0;
export function uniqueEmail(): string {
  emailCounter += 1;
  return `dono-${emailCounter}@tokyoramen.com.br`;
}

/**
 * A resposta CRUA de `POST /auth/register` — para os testes que verificam 4xx,
 * onde `registerRestaurant` (que já espera sucesso) não serve.
 */
export function registerResponse(
  app: FastifyInstance,
  restaurant: Record<string, unknown> = {},
  user: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      restaurant: { ...validRestaurantBody, ...restaurant },
      user: { ...validUserBody, email: uniqueEmail(), ...user },
    },
  });
}

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
    user: { ...validUserBody, email: uniqueEmail(), ...overrides.user },
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

/** Define a grade de horário inteira de um restaurante, via API. */
export function setOpeningHours(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  openingHours: { weekday: number; opensAt: string; closesAt: string }[],
) {
  return app.inject({
    method: "PUT",
    url: `/restaurants/${restaurant.id}/opening-hours`,
    headers: restaurant.headers,
    payload: { openingHours },
  });
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
