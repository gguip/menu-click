import { describe, expect, it } from "vitest";
import { imageUrl } from "../src/lib/image.ts";

describe("imageUrl", () => {
  it("insere a transformação de exibição logo depois de /upload/", () => {
    expect(
      imageUrl("https://res.cloudinary.com/nuvem/image/upload/v1/menuclick/r/logo.jpg", 200),
    ).toBe(
      "https://res.cloudinary.com/nuvem/image/upload/f_auto,q_auto,c_limit,w_200/v1/menuclick/r/logo.jpg",
    );
  });

  it("URL de fora do Cloudinary volta intacta", () => {
    expect(imageUrl("https://example.com/image/upload/foto.jpg", 200)).toBe(
      "https://example.com/image/upload/foto.jpg",
    );
    expect(imageUrl("blob:previa", 200)).toBe("blob:previa");
  });
});
