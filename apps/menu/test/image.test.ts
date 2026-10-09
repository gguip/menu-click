import { describe, expect, it } from "vitest";
import { imageUrl } from "../src/lib/image.ts";

const ORIGINAL = "https://res.cloudinary.com/nuvem/image/upload/v1728400000/menuclick/r/products/p.jpg";

describe("imageUrl", () => {
  it("pede ao Cloudinary a largura da tela, no formato que o navegador aguenta", () => {
    for (const width of [200, 400, 800, 1200]) {
      expect(imageUrl(ORIGINAL, width)).toBe(
        `https://res.cloudinary.com/nuvem/image/upload/f_auto,q_auto,c_limit,w_${width}/v1728400000/menuclick/r/products/p.jpg`,
      );
    }
  });

  // as lojas de antes do upload têm URL colada à mão, de qualquer lugar
  it("URL de fora do Cloudinary volta intacta", () => {
    for (const url of [
      "https://example.com/foto.jpg",
      "https://example.com/image/upload/foto.jpg",
      "https://res.cloudinary.com/nuvem/video/upload/v1/clipe.mp4",
    ]) {
      expect(imageUrl(url, 400)).toBe(url);
    }
  });
});
