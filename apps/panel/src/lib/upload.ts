import { describeError } from "../api/client.ts";
import { signUpload, type UploadTarget } from "../api/uploads.ts";

/**
 * O teto do painel. O tamanho em bytes não cabe na assinatura do Cloudinary,
 * então é aqui que a foto de 12 MB da câmera é barrada antes de sair.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Os mesmos três que a assinatura da API permite (`allowed_formats`). */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** `null` quando o arquivo serve; senão, o texto para a tela. */
export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return "Use uma imagem JPG, PNG ou WebP.";
  if (file.size > MAX_IMAGE_BYTES) return "A imagem passa de 5 MB. Escolha uma menor.";
  return null;
}

/** O envio ao Cloudinary falhou. A `message` já é o texto para a tela. */
export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Envia a imagem e devolve a `secure_url` — o que se grava por `PATCH`.
 *
 * Duas chamadas: a assinatura (na API, com a sessão) e o envio (direto ao
 * Cloudinary). ⚠️ O envio é `fetch` cru, sem `apiRequest`: o Bearer da sessão
 * não pode sair para outro domínio.
 */
export async function uploadImage(
  restaurantId: string,
  file: File,
  target: UploadTarget,
  productId?: string,
): Promise<string> {
  const signed = await signUpload(restaurantId, target, productId);

  // os campos vão COMO VIERAM: um caractere diferente do que foi assinado e o
  // Cloudinary recusa com "Invalid Signature"
  const form = new FormData();
  form.set("file", file);
  form.set("api_key", signed.apiKey);
  form.set("timestamp", String(signed.timestamp));
  form.set("public_id", signed.publicId);
  form.set("allowed_formats", signed.allowedFormats);
  form.set("transformation", signed.transformation);
  form.set("signature", signed.signature);

  let response: Response;
  try {
    response = await fetch(signed.uploadUrl, { method: "POST", body: form });
  } catch {
    throw new UploadError("Não foi possível enviar a imagem. Confira a internet e tente de novo.");
  }
  const payload: unknown = await response.json().catch(() => null);
  // 400 é o Cloudinary recusando o ARQUIVO (formato, tamanho, imagem
  // corrompida): "tente de novo" falharia para sempre
  if (response.status === 400) {
    throw new UploadError("A imagem foi recusada. Use um arquivo JPG, PNG ou WebP de até 5 MB.");
  }
  if (
    !response.ok ||
    payload === null ||
    typeof payload !== "object" ||
    !("secure_url" in payload) ||
    typeof payload.secure_url !== "string"
  ) {
    throw new UploadError("O envio da imagem falhou. Tente de novo.");
  }
  return payload.secure_url;
}

/** Texto de erro de um salvar que pode ter falhado no envio ou na API. */
export function describeSaveError(error: unknown): string {
  return error instanceof UploadError ? error.message : describeError(error);
}

/**
 * O que a pessoa fez com uma imagem do formulário, ainda não salvo. O arquivo
 * só sobe no salvar: como a troca sobrescreve o mesmo endereço, subir ao
 * escolher trocaria a foto do cardápio antes de a pessoa confirmar.
 */
export type ImageChange =
  | { kind: "keep" }
  | { kind: "replace"; file: File; previewUrl: string }
  | { kind: "remove" };

export const KEEP: ImageChange = { kind: "keep" };
