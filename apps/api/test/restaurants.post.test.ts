import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { validRestaurantBody as validBody } from "./helpers.ts";

describe("POST /restaurants", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("201 com corpo válido", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/restaurants",
      payload: validBody,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      name: validBody.name,
      cuisineType: validBody.cuisineType,
      address: validBody.address,
      isDelivery: true,
      isQrcode: false,
    });
    expect(body.id).toEqual(expect.any(String));
    expect(body.createdAt).toEqual(expect.any(String));
  });

  it("400 sem name", async () => {
    const { name: _name, ...withoutName } = validBody;

    const response = await app.inject({
      method: "POST",
      url: "/restaurants",
      payload: withoutName,
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com isDelivery de tipo errado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/restaurants",
      payload: { ...validBody, isDelivery: "yes" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com body vazio", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/restaurants",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com logoUrl malformada", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/restaurants",
      payload: { ...validBody, logoUrl: "not-a-url" },
    });

    expect(response.statusCode).toBe(400);
  });
});
