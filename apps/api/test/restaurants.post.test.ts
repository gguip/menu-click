import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  registerResponse,
  validRestaurantBody as validBody,
} from "./helpers.ts";

/**
 * Validação do corpo do restaurante no cadastro.
 *
 * O `POST /restaurants` público deixou de existir: restaurante sem dono seria
 * um registro que ninguém consegue acessar. Criar restaurante agora é criar
 * conta, e é `POST /auth/register` — mas o contrato do corpo do restaurante é
 * o mesmo, e é ele que estes testes cobrem.
 */
describe("POST /auth/register — corpo do restaurante", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("201 com corpo válido", async () => {
    const response = await registerResponse(app);

    expect(response.statusCode).toBe(201);
    const { restaurant } = response.json();
    expect(restaurant).toMatchObject({
      name: validBody.name,
      cuisineType: validBody.cuisineType,
      address: validBody.address,
      isDelivery: validBody.isDelivery,
      isTakeaway: validBody.isTakeaway,
      isQrcode: validBody.isQrcode,
    });
    expect(restaurant.id).toEqual(expect.any(String));
    expect(restaurant.slug).toEqual(expect.any(String));
    expect(restaurant.createdAt).toEqual(expect.any(String));
  });

  it("400 sem name", async () => {
    const { name: _name, ...withoutName } = validBody;

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        restaurant: withoutName,
        user: { name: "Dono", email: "d@x.com", password: "senha-longa-123" },
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com isDelivery de tipo errado", async () => {
    const response = await registerResponse(app, { isDelivery: "yes" });

    expect(response.statusCode).toBe(400);
  });

  it("400 com restaurante vazio", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        restaurant: {},
        user: { name: "Dono", email: "d@x.com", password: "senha-longa-123" },
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com logoUrl malformada", async () => {
    const response = await registerResponse(app, { logoUrl: "not-a-url" });

    expect(response.statusCode).toBe(400);
  });
});
