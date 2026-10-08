import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import {
  buildTestApp,
  cloudinaryUrl,
  createProduct,
  createRestaurant,
  registerResponse,
  type TestRestaurant,
} from "./helpers.ts";

describe("gravação de imagens", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const patchRestaurant = (r: TestRestaurant, payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: `/restaurants/${r.id}`, headers: r.headers, payload });

  const patchProduct = (r: TestRestaurant, id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "PATCH",
      url: `/restaurants/${r.id}/products/${id}`,
      headers: r.headers,
      payload,
    });

  it("grava logo e capa da própria loja, e eles saem no cardápio", async () => {
    const r = await createRestaurant(app);
    const logoUrl = cloudinaryUrl(r.id, "logo", "png");
    const coverUrl = cloudinaryUrl(r.id, "cover", "webp");

    const response = await patchRestaurant(r, { logoUrl, coverUrl });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ logoUrl, coverUrl });
    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu).toMatchObject({ logoUrl, coverUrl });
  });

  it("recusa logo e capa que não sejam os daquela loja", async () => {
    const r = await createRestaurant(app);
    const outra = await createRestaurant(app);
    const recusadas: Record<string, unknown>[] = [
      { logoUrl: "https://example.com/logo.png" },
      { coverUrl: "https://example.com/capa.jpg" },
      { logoUrl: cloudinaryUrl(outra.id, "logo") }, // de outra loja
      { logoUrl: cloudinaryUrl(r.id, "cover") }, // capa no lugar do logo
      { coverUrl: cloudinaryUrl(r.id, "logo") },
      { logoUrl: cloudinaryUrl(r.id, "logo", "gif") },
      { logoUrl: cloudinaryUrl(r.id, "logo").replace("/nuvem/", "/outra-conta/") },
      { logoUrl: cloudinaryUrl(r.id, "logo").replace("/v1728400000/", "/") }, // sem versão
      { logoUrl: cloudinaryUrl(r.id, "logo").replace("/v1728400000/", "/w_50/v1728400000/") },
      { logoUrl: `${cloudinaryUrl(r.id, "logo")}?x=1` },
      { logoUrl: `${cloudinaryUrl(r.id, "logo")}/` },
    ];

    for (const payload of recusadas) {
      const response = await patchRestaurant(r, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const lido = await app.inject({ method: "GET", url: `/restaurants/${r.id}`, headers: r.headers });
    expect(lido.json().logoUrl).toBeUndefined();
    expect(lido.json().coverUrl).toBeUndefined();
  });

  it("grava a foto do próprio produto, com o id da rota em qualquer caixa", async () => {
    const r = await createRestaurant(app);
    const product = await createProduct(app, r);
    const photoUrl = cloudinaryUrl(r.id, `products/${product.id}`);

    const response = await patchProduct(r, (product.id as string).toUpperCase(), { photoUrl });

    expect(response.statusCode).toBe(200);
    expect(response.json().photoUrl).toBe(photoUrl);
  });

  it("recusa a foto de outro produto, de outra loja e de fora", async () => {
    const r = await createRestaurant(app);
    const outra = await createRestaurant(app);
    const product = await createProduct(app, r);
    const vizinho = await createProduct(app, r, { name: "Gyoza" });
    const alheio = await createProduct(app, outra);

    for (const photoUrl of [
      "https://example.com/foto.jpg",
      cloudinaryUrl(r.id, `products/${vizinho.id}`),
      cloudinaryUrl(outra.id, `products/${alheio.id}`),
      cloudinaryUrl(r.id, "logo"),
      `${cloudinaryUrl(r.id, `products/${product.id}`)}?x=1`,
    ]) {
      const response = await patchProduct(r, product.id, { photoUrl });
      expect(response.statusCode, photoUrl).toBe(400);
      expect(response.json().message).toMatch(/photoUrl/);
    }
  });

  it("a foto só entra por PATCH: criar com photoUrl cria sem a foto", async () => {
    const r = await createRestaurant(app);

    const product = await createProduct(app, r, { photoUrl: "https://example.com/foto.jpg" });

    expect(product.id).toBeTruthy();
    expect(product.photoUrl).toBeUndefined();
  });

  it("o cadastro com logoUrl cria a loja sem o logo", async () => {
    const response = await registerResponse(app, { logoUrl: "https://example.com/logo.png" });

    expect(response.statusCode).toBe(201);
    expect(response.json().restaurant.logoUrl).toBeUndefined();
  });

  // dado de antes desta feature: a validação vale para gravação NOVA
  it("URL externa já gravada continua saindo, e reenviá-la é 400", async () => {
    const r = await createRestaurant(app);
    const product = await createProduct(app, r);
    await pool.query("update restaurants set cover_url = $1 where id = $2", [
      "https://example.com/capa-antiga.jpg",
      r.id,
    ]);
    await pool.query("update products set photo_url = $1 where id = $2", [
      "https://example.com/foto-antiga.jpg",
      product.id,
    ]);

    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu.coverUrl).toBe("https://example.com/capa-antiga.jpg");
    const lido = await app.inject({
      method: "GET",
      url: `/restaurants/${r.id}/products/${product.id}`,
      headers: r.headers,
    });
    expect(lido.json().photoUrl).toBe("https://example.com/foto-antiga.jpg");

    // editar outro campo não mexe na imagem antiga
    expect((await patchRestaurant(r, { name: "Outro nome" })).json().coverUrl).toBe(
      "https://example.com/capa-antiga.jpg",
    );
    // mas mandá-la de volta é gravação nova
    expect(
      (await patchRestaurant(r, { coverUrl: "https://example.com/capa-antiga.jpg" })).statusCode,
    ).toBe(400);
  });
});
