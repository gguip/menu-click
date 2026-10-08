import { apiRequest } from "./client.ts";

export type UploadTarget = "logo" | "cover" | "product";

/** Tudo que o envio ao Cloudinary precisa; vai no `FormData` como veio. */
export type UploadSignature = {
  uploadUrl: string;
  apiKey: string;
  timestamp: number;
  publicId: string;
  allowedFormats: string;
  transformation: string;
  signature: string;
};

/** `productId` só com `target: "product"` — a API recusa nos outros dois. */
export function signUpload(
  restaurantId: string,
  target: UploadTarget,
  productId?: string,
): Promise<UploadSignature> {
  return apiRequest<UploadSignature>(`/restaurants/${restaurantId}/uploads/signature`, {
    method: "POST",
    body: productId === undefined ? { target } : { target, productId },
  });
}
