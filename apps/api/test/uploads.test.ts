import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createProduct,
  createRestaurant,
  registerAndLogin,
  type TestRestaurant,
} from "./helpers.ts";

describe("assinatura de upload", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const sign = (
    restaurant: { id: string; headers?: { authorization: string } },
    payload: Record<string, unknown>,
    headers = restaurant.headers,
  ) =>
    app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/uploads/signature`,
      ...(headers ? { headers } : {}),
      payload,
    });

  /** O mesmo cálculo, refeito aqui: o teste não confia na função que testa. */
  const expectedSignature = (publicId: string, timestamp: number) =>
    createHash("sha1")
      .update(
        `allowed_formats=jpg,png,webp&public_id=${publicId}&timestamp=${timestamp}&transformation=c_limit,w_2000,h_2000segredo`,
      )
      .digest("hex");

  it("assina logo e capa na pasta do restaurante da sessão", async () => {
    const restaurant = await createRestaurant(app);

    for (const target of ["logo", "cover"]) {
      const response = await sign(restaurant, { target });
      expect(response.statusCode, target).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        uploadUrl: "https://api.cloudinary.com/v1_1/nuvem/image/upload",
        apiKey: "chave",
        publicId: `menuclick/${restaurant.id}/${target}`,
        allowedFormats: "jpg,png,webp",
        transformation: "c_limit,w_2000,h_2000",
      });
      expect(body.signature).toBe(expectedSignature(body.publicId, body.timestamp));
      // o Cloudinary recusa assinatura com mais de uma hora: tem que ser agora
      expect(Math.abs(body.timestamp - Date.now() / 1000)).toBeLessThan(60);
    }
  });

  it("assina a foto do produto, e o segredo não sai na resposta", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant);

    const response = await sign(restaurant, { target: "product", productId: product.id });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.publicId).toBe(`menuclick/${restaurant.id}/products/${product.id}`);
    expect(body.signature).toBe(expectedSignature(body.publicId, body.timestamp));
    expect(response.body).not.toContain("segredo");
  });

  it("id do produto em maiúsculas assina o mesmo endereço", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant);

    const response = await sign(restaurant, {
      target: "product",
      productId: (product.id as string).toUpperCase(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().publicId).toBe(`menuclick/${restaurant.id}/products/${product.id}`);
  });

  it("product sem productId, e logo com productId, são 400 com o motivo", async () => {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant);

    const semId = await sign(restaurant, { target: "product" });
    expect(semId.statusCode).toBe(400);
    expect(semId.json().message).toMatch(/productId/);

    const comId = await sign(restaurant, { target: "logo", productId: product.id });
    expect(comId.statusCode).toBe(400);
    expect(comId.json().message).toMatch(/productId/);
  });

  it("alvo fora da lista e corpo vazio são 400", async () => {
    const restaurant = await createRestaurant(app);
    expect((await sign(restaurant, { target: "banner" })).statusCode).toBe(400);
    expect((await sign(restaurant, {})).statusCode).toBe(400);
  });

  it("produto de outra loja, removido ou com id malformado é 404", async () => {
    const restaurant = await createRestaurant(app);
    const outra = await createRestaurant(app);
    const alheio = await createProduct(app, outra);
    const removido = await createProduct(app, restaurant);
    await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}/products/${removido.id}`,
      headers: restaurant.headers,
    });

    for (const productId of [alheio.id, removido.id, "nao-e-uuid"]) {
      const response = await sign(restaurant, { target: "product", productId });
      expect(response.statusCode, productId).toBe(404);
    }
  });

  it("sem sessão é 401, e restaurante alheio é 404", async () => {
    const restaurant = await createRestaurant(app);
    const outra = (await createRestaurant(app)) as TestRestaurant;

    expect((await sign({ id: restaurant.id }, { target: "logo" })).statusCode).toBe(401);
    expect((await sign(outra, { target: "logo" }, restaurant.headers)).statusCode).toBe(404);
  });

  it("loja que não verificou o e-mail é 403", async () => {
    const { restaurant, headers } = await registerAndLogin(app);

    const response = await sign({ id: restaurant.id, headers }, { target: "logo" });

    expect(response.statusCode).toBe(403);
  });
});
