import type { FastifyInstance } from "fastify";
import * as uploadsService from "../services/uploads.ts";
import type { SignUploadInput } from "../services/uploads.ts";
import { errorResponseSchema } from "./schemas.ts";
import { installRouteValidators } from "./validators.ts";

/**
 * Rota de upload — camada HTTP. Só assina: o arquivo vai do navegador direto
 * para o Cloudinary, e nunca passa por aqui.
 */

const signUploadBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["target"],
  properties: {
    target: { type: "string", enum: ["logo", "cover", "product"] },
    // obrigatório com `product` e recusado com os outros dois: a regra mora
    // no serviço, com mensagem — o JSON Schema condicional não a diria de
    // forma legível
    productId: { type: "string" },
  },
};

const uploadSignatureResponseSchema = {
  type: "object",
  properties: {
    uploadUrl: { type: "string" },
    apiKey: { type: "string" },
    timestamp: { type: "integer" },
    publicId: { type: "string" },
    allowedFormats: { type: "string" },
    transformation: { type: "string" },
    signature: { type: "string" },
  },
};

const restaurantIdParamsSchema = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: { type: "string" } },
};

/** Plugin encapsulado: os validadores não vazam para as rotas irmãs (F2). */
export async function uploadRoutes(app: FastifyInstance) {
  installRouteValidators(app);

  app.post<{ Params: { restaurantId: string }; Body: SignUploadInput }>(
    "/restaurants/:restaurantId/uploads/signature",
    {
      schema: {
        tags: ["Imagens"],
        operationId: "signUpload",
        summary: "Assina o envio de uma imagem ao Cloudinary",
        description:
          "A API não recebe o arquivo: ela assina, e o navegador envia direto para `uploadUrl`. Devolva os campos da resposta **como vieram** no `FormData` (`api_key`, `timestamp`, `public_id`, `allowed_formats`, `transformation`, `signature`), junto do `file`. `target` é `logo`, `cover` ou `product`; `productId` é obrigatório com `product` e recusado com os outros. O endereço é fixo por dono, então enviar de novo **sobrescreve** a imagem anterior. A `secure_url` que o Cloudinary devolver é o que se grava em `logoUrl`, `coverUrl` ou `photoUrl`, por `PATCH`. A assinatura vale por 1 hora.",
        params: restaurantIdParamsSchema,
        body: signUploadBodySchema,
        response: {
          200: uploadSignatureResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      return uploadsService.sign(request.params.restaurantId, request.body);
    },
  );
}
