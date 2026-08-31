import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import {
  createRestaurant,
  registerResponse,
  validRestaurantBody,
} from "./helpers.ts";

/**
 * `slug`: o identificador público do restaurante, o que vai no QR code.
 *
 * Duas políticas convivem aqui e é isso que os testes fixam: slug explícito é
 * palavra do cliente (colidiu, 409), slug derivado do nome é conveniência
 * (colidiu, ganha sufixo e segue).
 */
describe("slug do restaurante", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("deriva o slug do nome quando não é enviado", async () => {
    const restaurant = await createRestaurant(app, {
      name: "Tokyo Ramen House",
    });

    expect(restaurant.slug).toBe("tokyo-ramen-house");
  });

  it("remove acento em vez de trocar por hífen", async () => {
    const restaurant = await createRestaurant(app, { name: "Café Açaí São" });

    expect(restaurant.slug).toBe("cafe-acai-sao");
  });

  it("nomes iguais geram slugs diferentes, com sufixo no segundo", async () => {
    const primeiro = await createRestaurant(app, { name: "Cantina da Nona" });
    const segundo = await createRestaurant(app, { name: "Cantina da Nona" });

    expect(primeiro.slug).toBe("cantina-da-nona");
    expect(segundo.slug).toMatch(/^cantina-da-nona-[0-9a-f]{6}$/);
  });

  it("respeita o slug explícito", async () => {
    const restaurant = await createRestaurant(app, {
      name: "Tokyo Ramen House",
      slug: "ramen-da-paulista",
    });

    expect(restaurant.slug).toBe("ramen-da-paulista");
  });

  it("409 com slug explícito já em uso (não inventa outro)", async () => {
    await createRestaurant(app, { slug: "ramen-da-paulista" });

    const response = await registerResponse(app, {
      ...validRestaurantBody,
      slug: "ramen-da-paulista",
    });

    expect(response.statusCode).toBe(409);
  });

  it.each([
    ["maiúscula", "Ramen"],
    ["espaço", "ramen da casa"],
    ["hífen na ponta", "-ramen"],
    ["hífen duplo", "ramen--casa"],
    ["acento", "café"],
  ])("400 com slug inválido: %s", async (_caso, slug) => {
    const response = await registerResponse(app, { ...validRestaurantBody, slug });

    expect(response.statusCode).toBe(400);
  });

  it("PATCH ignora slug: a URL pública não muda por edição", async () => {
    const restaurant = await createRestaurant(app, { slug: "ramen-original" });

    const response = await app.inject({
      method: "PATCH",
      headers: restaurant.headers,
        url: `/restaurants/${restaurant.id}`,
      payload: { name: "Nome Novo", slug: "ramen-sequestrado" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe("Nome Novo");
    expect(response.json().slug).toBe("ramen-original");
  });

  it("slug de restaurante removido pode ser reusado (índice parcial)", async () => {
    const primeiro = await createRestaurant(app, { slug: "ramen-da-esquina" });
    await app.inject({ method: "DELETE", headers: primeiro.headers,
        url: `/restaurants/${primeiro.id}` });

    const response = await registerResponse(app, {
      ...validRestaurantBody,
      slug: "ramen-da-esquina",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().restaurant.slug).toBe("ramen-da-esquina");
  });
});
