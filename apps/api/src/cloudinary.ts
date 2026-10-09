import { createHash } from "node:crypto";
import { ValidationError } from "./errors.ts";

/**
 * Imagens no Cloudinary: configuração, assinatura de upload e o
 * reconhecimento de "esta URL é nossa".
 *
 * A API NUNCA recebe o arquivo nem chama o Cloudinary: o `bodyLimit` é de
 * 128 KB e o plano gratuito do Render não aguentaria o tráfego. O que ela faz
 * é assinar — com isso o navegador envia direto, e o Cloudinary só aceita o
 * que foi assinado aqui (o endereço, os formatos e o tamanho máximo guardado).
 *
 * Sem dependência: a assinatura é um SHA-1, e `node:crypto` já tem.
 */

/** A pasta de tudo que é do MenuClick na conta (que pode ter outros usos). */
const IMAGE_FOLDER = "menuclick";

/** SVG carrega script; GIF e vídeo comem cota. */
const ALLOWED_FORMATS = ["jpg", "png", "webp"] as const;

/**
 * Transformação DE ENTRADA: o Cloudinary guarda no máximo 2000 px, não a foto
 * de 12 MP que saiu da câmera. É o que mantém a cota de espaço previsível.
 */
const INCOMING_TRANSFORMATION = "c_limit,w_2000,h_2000";

export type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

/**
 * Lê `cloudinary://<api_key>:<api_secret>@<cloud_name>` — o formato que o
 * painel do Cloudinary entrega pronto.
 *
 * ⚠️ As mensagens de erro nunca repetem o valor: a variável tem o segredo
 * dentro, e a mensagem vai para o log de boot (S13).
 */
export function parseCloudinaryUrl(value: string | undefined): CloudinaryConfig {
  if (value === undefined || value === "") {
    throw new Error(
      "CLOUDINARY_URL é obrigatória: sem ela nenhuma loja consegue enviar logo, capa ou foto",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CLOUDINARY_URL não é uma URL válida");
  }
  if (
    url.protocol !== "cloudinary:" ||
    url.username === "" ||
    url.password === "" ||
    url.hostname === ""
  ) {
    throw new Error(
      "CLOUDINARY_URL precisa ter a forma cloudinary://<api_key>:<api_secret>@<cloud_name>",
    );
  }
  return {
    cloudName: url.hostname,
    apiKey: decodeURIComponent(url.username),
    apiSecret: decodeURIComponent(url.password),
  };
}

/**
 * Guarda de boot, ao lado da `assertMenuBaseUrl()`: descobrir que a variável
 * falta no primeiro upload de um cliente é tarde.
 */
export function assertCloudinaryUrl(): void {
  parseCloudinaryUrl(process.env.CLOUDINARY_URL);
}

/**
 * O endereço fixo do logo ou da capa de uma loja. Fixo de propósito: trocar a
 * imagem SOBRESCREVE o mesmo arquivo, então não sobra órfã nenhuma na conta e
 * a API nunca precisa chamar o Cloudinary para apagar.
 */
export function storeImagePublicId(
  restaurantId: string,
  target: "logo" | "cover",
): string {
  return `${IMAGE_FOLDER}/${restaurantId.toLowerCase()}/${target}`;
}

/**
 * O endereço fixo da foto de um produto.
 *
 * Minúsculas: o Postgres aceita UUID em maiúsculas na URL da rota, mas o nome
 * do arquivo é texto — sem normalizar, a assinatura e a gravação poderiam
 * discordar sobre o mesmo produto.
 */
export function productImagePublicId(
  restaurantId: string,
  productId: string,
): string {
  return `${IMAGE_FOLDER}/${restaurantId.toLowerCase()}/products/${productId.toLowerCase()}`;
}

/** O que o painel devolve, como veio, no `FormData` do envio. */
export type UploadSignature = {
  uploadUrl: string;
  apiKey: string;
  timestamp: number;
  publicId: string;
  allowedFormats: string;
  transformation: string;
  signature: string;
};

/**
 * Assina um upload para `publicId`.
 *
 * A regra do Cloudinary: os parâmetros em ordem alfabética, `chave=valor`
 * unidos por `&`, com o `API secret` concatenado no fim, em SHA-1
 * hexadecimal. `file`, `api_key`, `cloud_name` e `resource_type` não entram.
 *
 * O `timestamp` vem de fora para o teste poder fixá-lo; o Cloudinary recusa
 * assinatura com mais de uma hora.
 */
export function signUpload(publicId: string, timestamp: number): UploadSignature {
  const { cloudName, apiKey, apiSecret } = parseCloudinaryUrl(
    process.env.CLOUDINARY_URL,
  );
  const allowedFormats = ALLOWED_FORMATS.join(",");
  const signed: Record<string, string> = {
    allowed_formats: allowedFormats,
    public_id: publicId,
    timestamp: String(timestamp),
    transformation: INCOMING_TRANSFORMATION,
  };
  const toSign = Object.keys(signed)
    .sort()
    .map((key) => `${key}=${signed[key]}`)
    .join("&");
  const signature = createHash("sha1")
    .update(toSign + apiSecret)
    .digest("hex");

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    apiKey,
    timestamp,
    publicId,
    allowedFormats,
    transformation: INCOMING_TRANSFORMATION,
    signature,
  };
}

/**
 * `url` é exatamente o original versionado de `publicId` na nossa conta?
 *
 *   https://res.cloudinary.com/<cloud>/image/upload/v<dígitos>/<publicId>.<ext>
 *
 * A forma é fechada, e cada pedaço tem motivo: o que se grava aqui vai direto
 * para o `<img>` de todo cliente que abre o cardápio.
 * - a conta e o `publicId` conferidos: outra conta do Cloudinary tem o mesmo
 *   host, e outra loja tem a mesma pasta;
 * - sem transformação no caminho: senão o cliente escolheria o que o
 *   Cloudinary processa por conta da loja;
 * - versão obrigatória: é ela que faz a foto trocada aparecer, em vez da
 *   antiga que ficou no cache;
 * - nada depois da extensão: comparação exata, não prefixo.
 */
export function isOwnImageUrl(url: string, publicId: string): boolean {
  const { cloudName } = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
  const prefix = `https://res.cloudinary.com/${cloudName}/image/upload/v`;
  if (!url.startsWith(prefix)) return false;

  const rest = url.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash < 1 || !/^\d+$/.test(rest.slice(0, slash))) return false;

  const file = rest.slice(slash + 1);
  return ALLOWED_FORMATS.some((format) => file === `${publicId}.${format}`);
}

/**
 * Recusa, com 400, URL de imagem que não seja a daquele `publicId`. `null`
 * (limpar) e ausente (não mexer) passam.
 */
export function assertOwnImageUrl(
  field: string,
  url: string | null | undefined,
  publicId: string,
): void {
  if (typeof url !== "string") return;
  if (!isOwnImageUrl(url, publicId)) {
    throw new ValidationError(
      `\`${field}\` precisa ser uma imagem enviada pelo painel para esta loja`,
    );
  }
}
