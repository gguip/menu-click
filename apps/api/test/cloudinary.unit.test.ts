import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertOwnImageUrl,
  isOwnImageUrl,
  parseCloudinaryUrl,
  productImagePublicId,
  signUpload,
  storeImagePublicId,
} from "../src/cloudinary.ts";
import { ValidationError } from "../src/errors.ts";

const RESTAURANT = "0b2f6c1e-7a44-4d0b-9a55-1c2d3e4f5a6b";
const PRODUCT = "9c8b7a6d-5e4f-4321-8abc-def012345678";

describe("cloudinary", () => {
  describe("parseCloudinaryUrl", () => {
    it("separa chave, segredo e nome da conta", () => {
      expect(parseCloudinaryUrl("cloudinary://123:Ab_c-9@bird-corp")).toEqual({
        cloudName: "bird-corp",
        apiKey: "123",
        apiSecret: "Ab_c-9",
      });
    });

    it("decodifica caractere escapado no segredo", () => {
      expect(parseCloudinaryUrl("cloudinary://123:a%2Fb@nuvem").apiSecret).toBe("a/b");
    });

    it("ausente, vazia, malformada ou incompleta derruba, sem repetir o valor", () => {
      for (const value of [
        undefined,
        "",
        "não é url",
        "https://chave:segredo@nuvem",
        "cloudinary://chave@nuvem",
        "cloudinary://:segredo@nuvem",
        "cloudinary://chave:segredo@",
      ]) {
        expect(() => parseCloudinaryUrl(value), String(value)).toThrow(/CLOUDINARY_URL/);
      }
      // a mensagem vai para o log de boot: o segredo não pode estar nela
      expect(() => parseCloudinaryUrl("https://chave:meu-segredo@nuvem")).not.toThrow(/meu-segredo/);
    });
  });

  describe("public_id", () => {
    it("logo e capa ficam na pasta do restaurante", () => {
      expect(storeImagePublicId(RESTAURANT, "logo")).toBe(`menuclick/${RESTAURANT}/logo`);
      expect(storeImagePublicId(RESTAURANT, "cover")).toBe(`menuclick/${RESTAURANT}/cover`);
    });

    it("foto de produto fica em products/, com os ids em minúsculas", () => {
      expect(productImagePublicId(RESTAURANT.toUpperCase(), PRODUCT.toUpperCase())).toBe(
        `menuclick/${RESTAURANT}/products/${PRODUCT}`,
      );
    });
  });

  describe("signUpload", () => {
    it("assina os parâmetros em ordem alfabética, com o segredo no fim", () => {
      const publicId = storeImagePublicId(RESTAURANT, "logo");
      const signed = signUpload(publicId, 1791000000);
      const expected = createHash("sha1")
        .update(
          `allowed_formats=jpg,png,webp&public_id=${publicId}&timestamp=1791000000&transformation=c_limit,w_2000,h_2000segredo`,
        )
        .digest("hex");

      expect(signed).toEqual({
        uploadUrl: "https://api.cloudinary.com/v1_1/nuvem/image/upload",
        apiKey: "chave",
        timestamp: 1791000000,
        publicId,
        allowedFormats: "jpg,png,webp",
        transformation: "c_limit,w_2000,h_2000",
        signature: expected,
      });
    });

    it("o segredo não sai na resposta", () => {
      expect(JSON.stringify(signUpload("menuclick/x/logo", 1))).not.toContain("segredo");
    });
  });

  describe("isOwnImageUrl", () => {
    const publicId = storeImagePublicId(RESTAURANT, "logo");
    const base = `https://res.cloudinary.com/nuvem/image/upload`;

    it("aceita a URL versionada do alvo, nas três extensões", () => {
      for (const ext of ["jpg", "png", "webp"]) {
        expect(isOwnImageUrl(`${base}/v1728400000/${publicId}.${ext}`, publicId), ext).toBe(true);
      }
    });

    it("recusa tudo que não tem exatamente essa forma", () => {
      const recusadas = [
        `https://example.com/logo.jpg`,
        `http://res.cloudinary.com/nuvem/image/upload/v1/${publicId}.jpg`,
        `https://res.cloudinary.com/outra-conta/image/upload/v1/${publicId}.jpg`,
        `${base}/${publicId}.jpg`, // sem versão
        `${base}/vabc/${publicId}.jpg`, // versão não numérica
        `${base}/w_100/v1/${publicId}.jpg`, // transformação no caminho
        `${base}/v1/${publicId}.gif`,
        `${base}/v1/${publicId}.svg`,
        `${base}/v1/${publicId}`, // sem extensão
        `${base}/v1/${publicId}.jpg?x=1`,
        `${base}/v1/${publicId}.jpg#x`,
        `${base}/v1/${publicId}.jpg/`,
        `${base}/v1/${publicId}.jpg `,
        `${base}/v1/menuclick/${RESTAURANT}/cover.jpg`, // outro alvo
        `${base}/v1/menuclick/11111111-1111-4111-8111-111111111111/logo.jpg`, // outra loja
        `${base}/v1/outra-pasta/${RESTAURANT}/logo.jpg`,
      ];
      for (const url of recusadas) {
        expect(isOwnImageUrl(url, publicId), url).toBe(false);
      }
    });
  });

  describe("assertOwnImageUrl", () => {
    const publicId = storeImagePublicId(RESTAURANT, "logo");

    it("null e ausente passam: é limpar, ou não mexer", () => {
      expect(() => assertOwnImageUrl("logoUrl", null, publicId)).not.toThrow();
      expect(() => assertOwnImageUrl("logoUrl", undefined, publicId)).not.toThrow();
    });

    it("URL de fora vira ValidationError com o nome do campo", () => {
      expect(() => assertOwnImageUrl("logoUrl", "https://example.com/a.jpg", publicId)).toThrow(
        ValidationError,
      );
      expect(() => assertOwnImageUrl("logoUrl", "https://example.com/a.jpg", publicId)).toThrow(/logoUrl/);
    });
  });
});
