import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client.ts";
import {
  describeSaveError,
  MAX_IMAGE_BYTES,
  UploadError,
  uploadImage,
  validateImageFile,
} from "../src/lib/upload.ts";
import { mockApi } from "./api-mock.ts";
import { RESTAURANT_ID, signIn, UPLOADED_URL, uploadHandlers } from "./fixtures.ts";

function makeFile(name = "foto.jpg", type = "image/jpeg", size?: number): File {
  const file = new File(["x"], name, { type });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateImageFile", () => {
  it("aceita JPG, PNG e WebP até 5 MB", () => {
    expect(validateImageFile(makeFile("a.jpg", "image/jpeg"))).toBeNull();
    expect(validateImageFile(makeFile("a.png", "image/png"))).toBeNull();
    expect(validateImageFile(makeFile("a.webp", "image/webp", MAX_IMAGE_BYTES))).toBeNull();
  });

  it("recusa outros formatos dizendo quais servem — inclusive HEIC e arquivo sem tipo", () => {
    for (const file of [
      makeFile("foto.heic", "image/heic"),
      makeFile("foto.heic", ""),
      makeFile("anim.gif", "image/gif"),
      makeFile("logo.svg", "image/svg+xml"),
      makeFile("cardapio.pdf", "application/pdf"),
    ]) {
      expect(validateImageFile(file), file.name).toBe("Use uma imagem JPG, PNG ou WebP.");
    }
  });

  it("recusa acima de 5 MB", () => {
    expect(validateImageFile(makeFile("a.jpg", "image/jpeg", MAX_IMAGE_BYTES + 1))).toBe(
      "A imagem passa de 5 MB. Escolha uma menor.",
    );
  });
});

describe("uploadImage", () => {
  it("pede a assinatura, envia ao Cloudinary com os campos como vieram, e devolve a secure_url", async () => {
    signIn();
    const api = mockApi(uploadHandlers());
    const file = makeFile();

    const url = await uploadImage(RESTAURANT_ID, file, "logo");

    expect(url).toBe(UPLOADED_URL);
    const [signature, upload] = api.calls;
    expect(signature.body).toEqual({ target: "logo" });
    expect(upload.host).toBe("api.cloudinary.com");
    expect(upload.body).toEqual({
      file,
      api_key: "chave",
      timestamp: "1791000000",
      public_id: `menuclick/${RESTAURANT_ID}/logo`,
      allowed_formats: "jpg,png,webp",
      transformation: "c_limit,w_2000,h_2000",
      signature: "a".repeat(40),
    });
  });

  it("foto de produto manda o productId na assinatura", async () => {
    signIn();
    const api = mockApi(uploadHandlers());

    await uploadImage(RESTAURANT_ID, makeFile(), "product", "prod-1");

    expect(api.calls[0].body).toEqual({ target: "product", productId: "prod-1" });
  });

  it("o token da sessão não sai para o Cloudinary", async () => {
    signIn();
    const api = mockApi(uploadHandlers());

    await uploadImage(RESTAURANT_ID, makeFile(), "logo");

    expect(api.calls[0].headers.Authorization).toBe("Bearer token-de-teste");
    expect(api.calls[1].headers).toEqual({});
  });

  it("recusa do Cloudinary vira UploadError com texto para a tela", async () => {
    signIn();
    mockApi(uploadHandlers({ uploadStatus: 401 }));

    await expect(uploadImage(RESTAURANT_ID, makeFile(), "logo")).rejects.toThrow(UploadError);
  });

  it("resposta 200 sem secure_url também é falha", async () => {
    signIn();
    mockApi([
      { method: "POST", path: "/v1_1/nuvem/image/upload", body: {} },
      ...uploadHandlers(),
    ]);

    await expect(uploadImage(RESTAURANT_ID, makeFile(), "logo")).rejects.toThrow(UploadError);
  });

  it("sem rede no envio vira UploadError", async () => {
    signIn();
    const api = mockApi(uploadHandlers());
    const mocked = vi.mocked(fetch);
    const original = mocked.getMockImplementation();
    mocked.mockImplementation(async (input, init) => {
      if (String(input).includes("cloudinary.com")) throw new TypeError("Failed to fetch");
      return (original as typeof fetch)(input, init);
    });

    await expect(uploadImage(RESTAURANT_ID, makeFile(), "logo")).rejects.toThrow(
      "Não foi possível enviar a imagem. Confira a internet e tente de novo.",
    );
    expect(api.calls).toHaveLength(1);
  });

  it("falha na assinatura sobe como veio da API", async () => {
    signIn();
    mockApi([
      {
        method: "POST",
        path: `/restaurants/${RESTAURANT_ID}/uploads/signature`,
        status: 404,
        body: { message: "Produto não encontrado" },
      },
    ]);

    await expect(uploadImage(RESTAURANT_ID, makeFile(), "product", "x")).rejects.toThrow(ApiError);
  });
});

describe("describeSaveError", () => {
  it("usa o texto do UploadError, e o describeError no resto", () => {
    expect(describeSaveError(new UploadError("O envio da imagem falhou. Tente de novo."))).toBe(
      "O envio da imagem falhou. Tente de novo.",
    );
    expect(describeSaveError(new ApiError(400, "Nome inválido", null))).toBe("Nome inválido");
  });
});

describe("recusa do Cloudinary", () => {
  // arquivo que diz ser JPG e não é: "tente de novo" falharia para sempre
  it("400 diz que a imagem foi recusada e quais formatos servem", async () => {
    signIn();
    mockApi(uploadHandlers({ uploadStatus: 400 }));

    await expect(uploadImage(RESTAURANT_ID, makeFile(), "logo")).rejects.toThrow(
      "A imagem foi recusada. Use um arquivo JPG, PNG ou WebP de até 5 MB.",
    );
  });
});
