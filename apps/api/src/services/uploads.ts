import {
  productImagePublicId,
  signUpload,
  storeImagePublicId,
  type UploadSignature,
} from "../cloudinary.ts";
import { ValidationError } from "../errors.ts";
import * as productsService from "./products.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de uploads: **a regra de quem pode assinar o quê**.
 *
 * A assinatura é o que autoriza o navegador a gravar num endereço da conta do
 * Cloudinary. O endereço sai sempre daqui, nunca do cliente: a pasta é a do
 * restaurante da rota, e o nome do arquivo é `logo`, `cover` ou o id de um
 * produto que existe NAQUELE restaurante.
 *
 * Não conhece Fastify e não fala com o Cloudinary — assinar é uma conta de
 * hash.
 */

export type SignUploadInput = {
  target: "logo" | "cover" | "product";
  productId?: string;
};

export async function sign(
  restaurantId: string,
  input: SignUploadInput,
): Promise<UploadSignature> {
  await restaurantsService.ensureExists(restaurantId);
  const timestamp = Math.floor(Date.now() / 1000);

  if (input.target === "product") {
    if (input.productId === undefined) {
      throw new ValidationError(
        "Informe o `productId` para enviar a foto de um produto",
      );
    }
    // Confere no banco que o produto é DESTE restaurante (S23) e responde 404
    // senão (S19). Sem isto, o id viraria um nome de arquivo escolhido pelo
    // cliente dentro da pasta da loja. O id usado no endereço é o que o banco
    // devolveu, não o que veio no corpo.
    const product = await productsService.getById(restaurantId, input.productId);
    return signUpload(productImagePublicId(restaurantId, product.id), timestamp);
  }

  if (input.productId !== undefined) {
    throw new ValidationError(
      '`productId` só vale com `target: "product"`',
    );
  }
  return signUpload(storeImagePublicId(restaurantId, input.target), timestamp);
}
