# Upload de imagens — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logo, capa e foto de produto passam a ser enviados pelo painel direto para o Cloudinary, com assinatura da API; a URL colada à mão deixa de existir.

**Architecture:** A API assina o upload com `node:crypto` (`POST /restaurants/:restaurantId/uploads/signature`) e nunca recebe o arquivo. O painel envia o arquivo ao Cloudinary no salvar e grava a `secure_url` pelo `PATCH` que já existe; a API só aceita gravar URL do nosso Cloudinary, na pasta daquele restaurante. O app do cliente insere a transformação de exibição na URL.

**Tech Stack:** Fastify 5 + TypeScript nativo do Node (API), Vite + React 19 + Mantine 9 + TanStack Query 5 (painel), Next 16 (app do cliente), Vitest. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-08-upload-de-imagens-design.md`

## Global Constraints

- **Nenhuma dependência nova.** Assinatura é `node:crypto`; envio é `fetch` + `FormData`.
- **API em TypeScript apagável:** imports locais com `.ts`, `import type` para tipos, sem `enum`, sem parameter properties.
- **Três camadas:** rota não escreve SQL nem regra; serviço lança erro tipado de `src/errors.ts`; nenhuma rota monta corpo de erro.
- **Rota nova** declara `tags`, `summary`, `description` e `operationId`, e depois roda `pnpm --filter @menuclick/api openapi:generate` (o arquivo é versionado e há teste que compara).
- **Parâmetro de rota escopada se chama `restaurantId`** (S18). A rota nova **não** é pública nem `ownerOnly`.
- **Forma exata da URL aceita:** `https://res.cloudinary.com/<cloud>/image/upload/v<dígitos>/menuclick/<restaurantId>/<alvo>.<jpg|png|webp>`, ids em minúsculas.
- **Parâmetros assinados:** `allowed_formats=jpg,png,webp`, `public_id`, `timestamp`, `transformation=c_limit,w_2000,h_2000`. SHA-1 hexadecimal de `chave=valor` em ordem alfabética, unidos por `&`, com o `API secret` concatenado.
- **Limite no painel:** 5 MB; tipos `image/jpeg`, `image/png`, `image/webp`.
- **Larguras de exibição:** grade 400, tela do produto 800, capa e `og:image` 1200, logo 200, miniatura do painel 200.
- **Variável:** `CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>`; valor de mentira nos testes e no `.env.example`: `cloudinary://chave:segredo@nuvem`.
- **Painel:** cor só por `var(--mc-*)`, sem sombra, transição ou animação; toda chamada à API por `apiRequest`; o envio ao Cloudinary **não** leva `Authorization`.
- **Textos de tela em pt-BR;** identificadores em inglês.
- **Commits:** `<tipo>(<escopo>): <emoji> <mensagem>`, pt-BR, presente, minúscula, sem ponto final, sem rodapé de atribuição.
- **Shell:** `node` e `pnpm` são funções do nvm que recursam em shell não interativo; rode `unset -f node pnpm 2>/dev/null` antes dos comandos.
- **Testes da API precisam do Postgres de pé** (banco `capstone_test`, criado sozinho).

## Review Focus

1. **Foto de iPhone (HEIC) ou arquivo sem tipo:** a pessoa espera uma mensagem dizendo quais formatos servem, não um erro genérico do Cloudinary. Teste na Task 4.
2. **Id de produto em maiúsculas na URL da rota:** assinatura e validação da gravação precisam concordar no mesmo `public_id`. Testes nas Tasks 2 e 3.
3. **Escolher de novo o mesmo arquivo depois de "Remover":** o campo precisa reagir (o `input` de arquivo não dispara `change` com o mesmo valor). Teste na Task 5.
4. **Dois cliques em "Salvar" durante o envio:** um envio só, um `PATCH` só. Teste na Task 6.
5. **URL nossa com sobra no fim** (`…/logo.jpg?x=1`, `…/logo.jpg/`, espaço): 400, porque o que se grava vai direto para o `<img>` de todo cliente. Teste na Task 3.

---

## Estrutura de arquivos

**API (`apps/api`)**

| Arquivo | Papel |
| --- | --- |
| `src/cloudinary.ts` (novo) | Lê e valida `CLOUDINARY_URL`, monta `public_id`, assina, reconhece URL nossa |
| `src/services/uploads.ts` (novo) | Regra: `target` × `productId`, produto pertence à loja |
| `src/routes/uploads.ts` (novo) | Plugin da rota de assinatura |
| `src/app.ts` | Guarda de boot, `redact`, registro da rota |
| `src/routes/schemas.ts`, `src/routes/products.ts` | Tiram `logoUrl`/`photoUrl` da criação |
| `src/services/restaurants.ts`, `src/services/products.ts` | Conferem a URL na gravação |
| `test/cloudinary.unit.test.ts`, `test/uploads.test.ts`, `test/images.test.ts` (novos) | Testes |
| `test/helpers.ts` | `cloudinaryUrl()` |

**Painel (`apps/panel`)**

| Arquivo | Papel |
| --- | --- |
| `src/api/uploads.ts` (novo) | Chamada da assinatura |
| `src/lib/upload.ts` (novo) | Validação do arquivo, envio, tipo `ImageChange` |
| `src/lib/image.ts` (novo) | Transformação de exibição na URL |
| `src/ui/ImageField.tsx` + `.module.css` (novos) | Campo de imagem |
| `src/features/settings/storeForm.ts`, `StoreDataPage.tsx` | Logo e capa por upload |
| `src/features/products/productForm.ts`, `ProductFormPage.tsx`, `ProductsPage.tsx`, `src/api/products.ts` | Foto por upload |

**App do cliente (`apps/menu`)**

| Arquivo | Papel |
| --- | --- |
| `src/lib/image.ts` (novo) | Transformação de exibição na URL |
| `src/components/MenuHeader.tsx`, `ProductGrid.tsx`, `ProductScreen.tsx`, `src/app/[slug]/page.tsx` | Usam a função |

---

### Task 1: Configuração e assinatura do Cloudinary (API)

**Files:**
- Create: `apps/api/src/cloudinary.ts`
- Create: `apps/api/test/cloudinary.unit.test.ts`
- Modify: `apps/api/src/app.ts` (guarda de boot depois do `assertMenuBaseUrl()`; `redact`)
- Modify: `apps/api/vitest.config.ts` (bloco `env`)
- Modify: `apps/api/.env.example` (fim do arquivo)
- Modify: `render.yaml` (fim de `envVars`)
- Modify: `apps/api/test/render-config.test.ts` (lista de segredos)

**Interfaces:**
- Consumes: `ValidationError` de `src/errors.ts`.
- Produces (todas de `src/cloudinary.ts`):
  - `type CloudinaryConfig = { cloudName: string; apiKey: string; apiSecret: string }`
  - `parseCloudinaryUrl(value: string | undefined): CloudinaryConfig`
  - `assertCloudinaryUrl(): void`
  - `storeImagePublicId(restaurantId: string, target: "logo" | "cover"): string`
  - `productImagePublicId(restaurantId: string, productId: string): string`
  - `type UploadSignature = { uploadUrl: string; apiKey: string; timestamp: number; publicId: string; allowedFormats: string; transformation: string; signature: string }`
  - `signUpload(publicId: string, timestamp: number): UploadSignature`
  - `isOwnImageUrl(url: string, publicId: string): boolean`
  - `assertOwnImageUrl(field: string, url: string | null | undefined, publicId: string): void`

- [ ] **Step 1: Pôr a variável de mentira na suíte**

Em `apps/api/vitest.config.ts`, dentro de `test.env`, depois de `MENU_BASE_URL`:

```ts
      // Conta de mentira, mas PARSEÁVEL: sem ela o `buildApp()` não sobe, e os
      // testes de assinatura conferem o hash contra este segredo exato. A
      // suíte nunca fala com o Cloudinary.
      CLOUDINARY_URL: "cloudinary://chave:segredo@nuvem",
```

- [ ] **Step 2: Escrever o teste que falha**

`apps/api/test/cloudinary.unit.test.ts`:

```ts
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @menuclick/api exec vitest run test/cloudinary.unit.test.ts`
Expected: FAIL — `Cannot find module '../src/cloudinary.ts'`.

- [ ] **Step 4: Implementar**

`apps/api/src/cloudinary.ts`:

```ts
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
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @menuclick/api exec vitest run test/cloudinary.unit.test.ts`
Expected: PASS.

- [ ] **Step 6: Guarda de boot e `redact`**

Em `apps/api/src/app.ts`, acrescente o import ao lado do de `menu-url.ts`:

```ts
import { assertCloudinaryUrl } from "./cloudinary.ts";
```

Logo depois de `assertMenuBaseUrl();`:

```ts
  /**
   * Mais uma pré-condição de subida: a conta do Cloudinary. Sem ela nenhuma
   * loja consegue pôr logo, capa ou foto — ver `assertCloudinaryUrl` em
   * `cloudinary.ts`.
   */
  assertCloudinaryUrl();
```

No `redact.paths`, depois de `"SMTP_URL"`, acrescente `"CLOUDINARY_URL"`, e no comentário acima troque "`DATABASE_URL` e `SMTP_URL` entram pelo mesmo motivo: as duas são connection string com senha dentro" por "`DATABASE_URL`, `SMTP_URL` e `CLOUDINARY_URL` entram pelo mesmo motivo: as três têm segredo dentro".

- [ ] **Step 7: `.env.example`, `render.yaml` e o teste do `render.yaml`**

No fim de `apps/api/.env.example`:

```
# ---- Imagens (Cloudinary) ----
# 🚨 OBRIGATÓRIA: sem ela a API NÃO SOBE.
#
# Logo, capa e foto de produto são enviados pelo painel direto para o
# Cloudinary; a API só ASSINA o envio com o segredo daqui. O formato é o que o
# painel do Cloudinary entrega pronto ("API environment variable"):
#
#   cloudinary://<api_key>:<api_secret>@<cloud_name>
#
# O valor abaixo é de mentira, mas parseável: a API sobe, a assinatura sai, e
# o envio é recusado pelo Cloudinary — a falha aparece na tela do painel.
# Nunca commite o valor de verdade (S12).
CLOUDINARY_URL=cloudinary://chave:segredo@nuvem
```

No fim de `envVars` em `render.yaml`:

```yaml
      # conta do Cloudinary que guarda logo, capa e foto de produto; a API só
      # assina o envio. Tem o API secret dentro
      - key: CLOUDINARY_URL
        sync: false
```

Em `apps/api/test/render-config.test.ts`, no teste "segredos nunca têm valor no arquivo", troque a lista por:

```ts
    for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL", "SMTP_URL", "CLOUDINARY_URL"]) {
```

- [ ] **Step 8: Rodar a suíte inteira da API**

Run: `pnpm --filter @menuclick/api test`
Expected: PASS (o boot continua de pé com a variável de mentira).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/cloudinary.ts apps/api/test/cloudinary.unit.test.ts apps/api/src/app.ts apps/api/vitest.config.ts apps/api/.env.example render.yaml apps/api/test/render-config.test.ts
git commit -m "feat(api): ✨ assina upload do cloudinary e reconhece url da própria conta"
```

---

### Task 2: Rota de assinatura (API)

**Files:**
- Create: `apps/api/src/services/uploads.ts`
- Create: `apps/api/src/routes/uploads.ts`
- Create: `apps/api/test/uploads.test.ts`
- Modify: `apps/api/src/app.ts` (import e `app.register`)
- Modify: `apps/api/openapi.json` (gerado)

**Interfaces:**
- Consumes (Task 1): `signUpload`, `storeImagePublicId`, `productImagePublicId`, `type UploadSignature`. De `services/products.ts`: `getById(restaurantId: string, id: string)`, que lança `NotFoundError` para produto inexistente, removido, de outra loja ou id malformado. De `services/restaurants.ts`: `ensureExists(id: string)`.
- Produces:
  - `services/uploads.ts`: `type SignUploadInput = { target: "logo" | "cover" | "product"; productId?: string }` e `sign(restaurantId: string, input: SignUploadInput): Promise<UploadSignature>`
  - `routes/uploads.ts`: `uploadRoutes(app: FastifyInstance)`
  - HTTP: `POST /restaurants/:restaurantId/uploads/signature` → 200 com `UploadSignature`

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/test/uploads.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @menuclick/api exec vitest run test/uploads.test.ts`
Expected: FAIL — a rota não existe; o primeiro teste recebe 404 onde espera 200.

- [ ] **Step 3: Serviço**

`apps/api/src/services/uploads.ts`:

```ts
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
```

- [ ] **Step 4: Rota**

`apps/api/src/routes/uploads.ts`:

```ts
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
```

- [ ] **Step 5: Registrar**

Em `apps/api/src/app.ts`, import ao lado do de `tables.ts`:

```ts
import { uploadRoutes } from "./routes/uploads.ts";
```

e, depois de `await app.register(tableRoutes);`:

```ts
  await app.register(uploadRoutes);
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @menuclick/api exec vitest run test/uploads.test.ts`
Expected: PASS.

- [ ] **Step 7: Regerar o OpenAPI e rodar a suíte**

Run: `pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test`
Expected: PASS. `test/openapi.test.ts` compara o arquivo commitado com o gerado e exige os quatro campos de documentação; `test/authorization.test.ts` exige 401 da rota nova sem sessão — ela **não** entra na lista de públicas.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/uploads.ts apps/api/src/routes/uploads.ts apps/api/src/app.ts apps/api/test/uploads.test.ts apps/api/openapi.json
git commit -m "feat(api): ✨ adiciona a rota que assina o envio de imagem"
```

---

### Task 3: A API só grava imagem da própria loja (quebra de contrato)

**Files:**
- Modify: `apps/api/src/routes/schemas.ts` (`createRestaurantBodySchema`: tira `logoUrl`)
- Modify: `apps/api/src/routes/products.ts` (`createProductBodySchema`: tira `photoUrl`; descrições)
- Modify: `apps/api/src/services/restaurants.ts` (`update`)
- Modify: `apps/api/src/services/products.ts` (`update`)
- Modify: `apps/api/test/helpers.ts` (`cloudinaryUrl`)
- Create: `apps/api/test/images.test.ts`
- Modify: `apps/api/test/restaurants.branding.test.ts`, `apps/api/test/restaurants.crud.test.ts`, `apps/api/test/products.crud.test.ts`, `apps/api/test/restaurants.post.test.ts`
- Modify: `apps/api/openapi.json` (gerado)

**Interfaces:**
- Consumes (Task 1): `assertOwnImageUrl(field, url, publicId)`, `storeImagePublicId(restaurantId, target)`, `productImagePublicId(restaurantId, productId)`.
- Produces: `cloudinaryUrl(restaurantId: string, target: string, ext?: string): string` em `test/helpers.ts`. Comportamento HTTP: `PATCH` de restaurante e de produto respondem 400 a URL de imagem que não seja a daquele dono; `POST …/products` e `POST /auth/register` descartam `photoUrl`/`logoUrl`.

- [ ] **Step 1: Auxiliar de teste**

Em `apps/api/test/helpers.ts`, depois de `validProductBody`:

```ts
/**
 * Uma URL de imagem que a API aceita gravar: a do Cloudinary de mentira da
 * suíte (`CLOUDINARY_URL` em `vitest.config.ts`), na pasta daquele
 * restaurante. `target` é `logo`, `cover` ou `products/<productId>`.
 */
export function cloudinaryUrl(
  restaurantId: string,
  target: string,
  ext = "jpg",
): string {
  return `https://res.cloudinary.com/nuvem/image/upload/v1728400000/menuclick/${restaurantId}/${target}.${ext}`;
}
```

- [ ] **Step 2: Escrever o teste que falha**

`apps/api/test/images.test.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import {
  buildTestApp,
  cloudinaryUrl,
  createProduct,
  createRestaurant,
  registerResponse,
  type TestRestaurant,
} from "./helpers.ts";

describe("gravação de imagens", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const patchRestaurant = (r: TestRestaurant, payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: `/restaurants/${r.id}`, headers: r.headers, payload });

  const patchProduct = (r: TestRestaurant, id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "PATCH",
      url: `/restaurants/${r.id}/products/${id}`,
      headers: r.headers,
      payload,
    });

  it("grava logo e capa da própria loja, e eles saem no cardápio", async () => {
    const r = await createRestaurant(app);
    const logoUrl = cloudinaryUrl(r.id, "logo", "png");
    const coverUrl = cloudinaryUrl(r.id, "cover", "webp");

    const response = await patchRestaurant(r, { logoUrl, coverUrl });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ logoUrl, coverUrl });
    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu).toMatchObject({ logoUrl, coverUrl });
  });

  it("recusa logo e capa que não sejam os daquela loja", async () => {
    const r = await createRestaurant(app);
    const outra = await createRestaurant(app);
    const recusadas: Record<string, unknown>[] = [
      { logoUrl: "https://example.com/logo.png" },
      { coverUrl: "https://example.com/capa.jpg" },
      { logoUrl: cloudinaryUrl(outra.id, "logo") }, // de outra loja
      { logoUrl: cloudinaryUrl(r.id, "cover") }, // capa no lugar do logo
      { coverUrl: cloudinaryUrl(r.id, "logo") },
      { logoUrl: cloudinaryUrl(r.id, "logo", "gif") },
      { logoUrl: cloudinaryUrl(r.id, "logo").replace("/nuvem/", "/outra-conta/") },
      { logoUrl: cloudinaryUrl(r.id, "logo").replace("/v1728400000/", "/") }, // sem versão
      { logoUrl: cloudinaryUrl(r.id, "logo").replace("/v1728400000/", "/w_50/v1728400000/") },
      { logoUrl: `${cloudinaryUrl(r.id, "logo")}?x=1` },
      { logoUrl: `${cloudinaryUrl(r.id, "logo")}/` },
    ];

    for (const payload of recusadas) {
      const response = await patchRestaurant(r, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const lido = await app.inject({ method: "GET", url: `/restaurants/${r.id}`, headers: r.headers });
    expect(lido.json().logoUrl).toBeUndefined();
    expect(lido.json().coverUrl).toBeUndefined();
  });

  it("grava a foto do próprio produto, com o id da rota em qualquer caixa", async () => {
    const r = await createRestaurant(app);
    const product = await createProduct(app, r);
    const photoUrl = cloudinaryUrl(r.id, `products/${product.id}`);

    const response = await patchProduct(r, (product.id as string).toUpperCase(), { photoUrl });

    expect(response.statusCode).toBe(200);
    expect(response.json().photoUrl).toBe(photoUrl);
  });

  it("recusa a foto de outro produto, de outra loja e de fora", async () => {
    const r = await createRestaurant(app);
    const outra = await createRestaurant(app);
    const product = await createProduct(app, r);
    const vizinho = await createProduct(app, r, { name: "Gyoza" });
    const alheio = await createProduct(app, outra);

    for (const photoUrl of [
      "https://example.com/foto.jpg",
      cloudinaryUrl(r.id, `products/${vizinho.id}`),
      cloudinaryUrl(outra.id, `products/${alheio.id}`),
      cloudinaryUrl(r.id, "logo"),
      `${cloudinaryUrl(r.id, `products/${product.id}`)}?x=1`,
    ]) {
      const response = await patchProduct(r, product.id, { photoUrl });
      expect(response.statusCode, photoUrl).toBe(400);
      expect(response.json().message).toMatch(/photoUrl/);
    }
  });

  it("a foto só entra por PATCH: criar com photoUrl cria sem a foto", async () => {
    const r = await createRestaurant(app);

    const product = await createProduct(app, r, { photoUrl: "https://example.com/foto.jpg" });

    expect(product.id).toBeTruthy();
    expect(product.photoUrl).toBeUndefined();
  });

  it("o cadastro com logoUrl cria a loja sem o logo", async () => {
    const response = await registerResponse(app, { logoUrl: "https://example.com/logo.png" });

    expect(response.statusCode).toBe(201);
    expect(response.json().restaurant.logoUrl).toBeUndefined();
  });

  // dado de antes desta feature: a validação vale para gravação NOVA
  it("URL externa já gravada continua saindo, e reenviá-la é 400", async () => {
    const r = await createRestaurant(app);
    const product = await createProduct(app, r);
    await pool.query("update restaurants set cover_url = $1 where id = $2", [
      "https://example.com/capa-antiga.jpg",
      r.id,
    ]);
    await pool.query("update products set photo_url = $1 where id = $2", [
      "https://example.com/foto-antiga.jpg",
      product.id,
    ]);

    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu.coverUrl).toBe("https://example.com/capa-antiga.jpg");
    const lido = await app.inject({
      method: "GET",
      url: `/restaurants/${r.id}/products/${product.id}`,
      headers: r.headers,
    });
    expect(lido.json().photoUrl).toBe("https://example.com/foto-antiga.jpg");

    // editar outro campo não mexe na imagem antiga
    expect((await patchRestaurant(r, { name: "Outro nome" })).json().coverUrl).toBe(
      "https://example.com/capa-antiga.jpg",
    );
    // mas mandá-la de volta é gravação nova
    expect(
      (await patchRestaurant(r, { coverUrl: "https://example.com/capa-antiga.jpg" })).statusCode,
    ).toBe(400);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @menuclick/api exec vitest run test/images.test.ts`
Expected: FAIL — "recusa logo e capa…" recebe 200 onde espera 400, "a foto só entra por PATCH" recebe `photoUrl`, e o cadastro grava o logo.

- [ ] **Step 4: Tirar a imagem da criação**

Em `apps/api/src/routes/schemas.ts`, no `createRestaurantBodySchema`, **apague** a linha:

```ts
    logoUrl: { type: "string", format: "uri" },
```

e ponha no lugar o comentário:

```ts
    // sem `logoUrl`: o logo é enviado pelo painel depois, por PATCH — o
    // endereço da imagem tem o id do restaurante, que aqui ainda não existe
```

No `updateRestaurantBodySchema`, troque os dois comentários de `logoUrl`/`coverUrl` por:

```ts
    // imagens: só `null` (tira) ou a URL do Cloudinary DESTA loja — o serviço
    // confere (`assertOwnImageUrl`). O `format` é só a primeira barreira; F12
    logoUrl: { type: "string", format: "uri", nullable: true },
    coverUrl: { type: "string", format: "uri", nullable: true },
```

Em `apps/api/src/routes/products.ts`, no `createProductBodySchema`, **apague**:

```ts
    photoUrl: { type: "string", format: "uri" },
```

e ponha:

```ts
    // sem `photoUrl`: a foto entra por PATCH, depois de o produto ter id
```

No `updateProductBodySchema`, troque o comentário de `photoUrl` por:

```ts
    // `null` tira a foto; fora isso, só a URL do Cloudinary DESTE produto — o
    // serviço confere. String vazia continua 400 pelo `format`
```

Na `description` da rota `createProduct`, acrescente ao fim: ` A foto não entra aqui: é enviada depois, por \`PATCH\` (ver \`signUpload\`).` Na da rota `updateProduct`, acrescente ao fim: ` \`photoUrl\` aceita \`null\` (tira a foto) ou a URL devolvida pelo Cloudinary para **este** produto — qualquer outra é 400.` Na da rota `updateRestaurant` (`apps/api/src/routes/restaurants.ts`), acrescente ao fim: ` \`logoUrl\` e \`coverUrl\` aceitam \`null\` ou a URL devolvida pelo Cloudinary para esta loja (ver \`signUpload\`) — qualquer outra é 400.`

Os tipos `CreateRestaurantInput.logoUrl` e `CreateProductInput.photoUrl` e os repositórios **não mudam**: o campo passa a chegar sempre `undefined`, e o `insert` já grava `null` nesse caso.

- [ ] **Step 5: Conferir na gravação**

Em `apps/api/src/services/restaurants.ts`, acrescente o import:

```ts
import { assertOwnImageUrl, storeImagePublicId } from "../cloudinary.ts";
```

e, em `update`, depois de `assertFaixaDeEntrega(input);`:

```ts
  // logo e capa só podem ser os arquivos DESTA loja no Cloudinary: o endereço
  // vai direto para o `<img>` do cardápio público
  assertOwnImageUrl("logoUrl", input.logoUrl, storeImagePublicId(id, "logo"));
  assertOwnImageUrl("coverUrl", input.coverUrl, storeImagePublicId(id, "cover"));
```

Em `apps/api/src/services/products.ts`, acrescente o import:

```ts
import { assertOwnImageUrl, productImagePublicId } from "../cloudinary.ts";
```

e, em `update`, depois de `if (!isUuid(id)) throw productNotFound(id);`:

```ts
  // a foto só pode ser o arquivo DESTE produto, na pasta deste restaurante
  assertOwnImageUrl("photoUrl", input.photoUrl, productImagePublicId(restaurantId, id));
```

- [ ] **Step 6: Rodar o teste novo e ver passar**

Run: `pnpm --filter @menuclick/api exec vitest run test/images.test.ts`
Expected: PASS.

- [ ] **Step 7: Acertar os testes antigos que gravavam `example.com`**

`apps/api/test/restaurants.branding.test.ts` — importe `cloudinaryUrl` de `./helpers.ts` e troque os dois primeiros testes por:

```ts
  it("salva e sai no cardápio público", async () => {
    const r = await createRestaurant(app);
    const coverUrl = cloudinaryUrl(r.id, "cover");
    const res = await patch(r, { coverUrl, brandColor: "#0B7A48" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ coverUrl, brandColor: "#0B7A48" });
    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu).toMatchObject({ coverUrl, brandColor: "#0B7A48" });
  });

  it("null tira os dois", async () => {
    const r = await createRestaurant(app);
    await patch(r, { coverUrl: cloudinaryUrl(r.id, "cover"), brandColor: "#0B7A48" });
    const res = await patch(r, { coverUrl: null, brandColor: null });
    expect(res.json().coverUrl).toBeUndefined();
    expect(res.json().brandColor).toBeUndefined();
  });
```

`apps/api/test/restaurants.crud.test.ts` — importe `cloudinaryUrl` e, no teste "tira o logo com null, e o campo some da resposta", troque o primeiro `PATCH` por:

```ts
      const gravado = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
        payload: { logoUrl: cloudinaryUrl(restaurant.id, "logo", "png") },
      });
      expect(gravado.statusCode).toBe(200);
```

`apps/api/test/products.crud.test.ts` — importe `cloudinaryUrl` e, no teste "tira a foto com null, e o campo some da resposta", troque a criação do produto por:

```ts
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant);
      const gravado = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/products/${product.id}`,
        headers: restaurant.headers,
        payload: { photoUrl: cloudinaryUrl(restaurant.id, `products/${product.id}`) },
      });
      expect(gravado.statusCode).toBe(200);
```

`apps/api/test/restaurants.post.test.ts` — o teste "400 com logoUrl malformada" deixou de ser verdade (o campo é descartado). **Apague-o**: o comportamento novo já está em `images.test.ts` ("o cadastro com logoUrl cria a loja sem o logo").

- [ ] **Step 8: Regerar o OpenAPI e rodar a suíte inteira**

Run: `pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test && pnpm --filter @menuclick/api build`
Expected: PASS nos três. Se algum outro teste gravar URL externa em `logoUrl`/`coverUrl`/`photoUrl`, ele falha com 400: troque pela `cloudinaryUrl()` do dono certo.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src apps/api/test apps/api/openapi.json
git commit -m "feat(api)!: ✨ aceita gravar só imagem do cloudinary da própria loja

BREAKING CHANGE: logoUrl, coverUrl e photoUrl só aceitam null ou a URL do
Cloudinary daquela loja; POST de produto e o cadastro deixam de aceitar
imagem, que passa a entrar só por PATCH."
```

---

### Task 4: Envio de imagem no painel (sem tela)

**Files:**
- Create: `apps/panel/src/api/uploads.ts`
- Create: `apps/panel/src/lib/upload.ts`
- Create: `apps/panel/src/lib/image.ts`
- Create: `apps/panel/test/upload.test.ts`
- Create: `apps/panel/test/image.test.ts`
- Modify: `apps/panel/test/api-mock.ts` (corpo `FormData` e `host`)
- Modify: `apps/panel/test/fixtures.ts` (`makeUploadSignature`, `uploadHandlers`)
- Modify: `apps/panel/test/setup.ts` (`URL.createObjectURL`)

**Interfaces:**
- Consumes: `apiRequest`, `describeError` de `src/api/client.ts`; HTTP `POST /restaurants/:restaurantId/uploads/signature` (Task 2).
- Produces:
  - `src/api/uploads.ts`: `type UploadTarget = "logo" | "cover" | "product"`; `type UploadSignature = { uploadUrl: string; apiKey: string; timestamp: number; publicId: string; allowedFormats: string; transformation: string; signature: string }`; `signUpload(restaurantId: string, target: UploadTarget, productId?: string): Promise<UploadSignature>`
  - `src/lib/upload.ts`: `MAX_IMAGE_BYTES`, `ACCEPTED_IMAGE_TYPES`, `validateImageFile(file: File): string | null`, `class UploadError extends Error`, `uploadImage(restaurantId: string, file: File, target: UploadTarget, productId?: string): Promise<string>`, `describeSaveError(error: unknown): string`, `type ImageChange = { kind: "keep" } | { kind: "replace"; file: File; previewUrl: string } | { kind: "remove" }`, `KEEP: ImageChange`
  - `src/lib/image.ts`: `imageUrl(url: string, width: number): string`
  - `test/fixtures.ts`: `makeUploadSignature(overrides?)`, `UPLOADED_URL`, `uploadHandlers(options?: { uploadStatus?: number }): MockHandler[]`
  - `test/api-mock.ts`: `MockCall.host: string`; `MockCall.body` é o objeto do `FormData` quando o corpo é `FormData`

- [ ] **Step 1: Estender o mock de `fetch`**

Em `apps/panel/test/api-mock.ts`, no tipo `MockCall`, acrescente:

```ts
  /** `localhost` nas chamadas à API; o host de fora nas outras (Cloudinary). */
  host: string;
```

e, dentro do `fetchMock`, troque as linhas do `body` e do `calls.push` por:

```ts
    // FormData (o envio ao Cloudinary) vira objeto, para o teste conferir os
    // campos; o `File` continua sendo o `File`
    const body =
      typeof init.body === "string"
        ? JSON.parse(init.body)
        : init.body instanceof FormData
          ? Object.fromEntries(init.body.entries())
          : undefined;
    calls.push({ method, path, query, body, headers, host: url.host });
```

Em `apps/panel/test/setup.ts`, no fim do arquivo:

```ts
// O jsdom não implementa as URLs de objeto, e a prévia da imagem escolhida
// usa as duas.
URL.createObjectURL = () => "blob:previa";
URL.revokeObjectURL = () => {};
```

Em `apps/panel/test/fixtures.ts`, acrescente (importando `type MockHandler` de `./api-mock.ts` e `type UploadSignature` de `../src/api/uploads.ts`):

```ts
export function makeUploadSignature(overrides: Partial<UploadSignature> = {}): UploadSignature {
  return {
    uploadUrl: "https://api.cloudinary.com/v1_1/nuvem/image/upload",
    apiKey: "chave",
    timestamp: 1791000000,
    publicId: `menuclick/${RESTAURANT_ID}/logo`,
    allowedFormats: "jpg,png,webp",
    transformation: "c_limit,w_2000,h_2000",
    signature: "a".repeat(40),
    ...overrides,
  };
}

/** A `secure_url` que o Cloudinary de mentira devolve. */
export const UPLOADED_URL = `https://res.cloudinary.com/nuvem/image/upload/v1791000001/menuclick/${RESTAURANT_ID}/logo.jpg`;

/** A assinatura da API e o envio ao Cloudinary; `uploadStatus` simula a recusa. */
export function uploadHandlers(options: { uploadStatus?: number } = {}): MockHandler[] {
  return [
    {
      method: "POST",
      path: `/restaurants/${RESTAURANT_ID}/uploads/signature`,
      body: makeUploadSignature(),
    },
    {
      method: "POST",
      path: "/v1_1/nuvem/image/upload",
      status: options.uploadStatus ?? 200,
      body:
        options.uploadStatus === undefined
          ? { secure_url: UPLOADED_URL }
          : { error: { message: "Invalid Signature" } },
    },
  ];
}
```

- [ ] **Step 2: Escrever os testes que falham**

`apps/panel/test/image.test.ts`:

```ts
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
```

`apps/panel/test/upload.test.ts`:

```ts
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @menuclick/panel exec vitest run test/upload.test.ts test/image.test.ts`
Expected: FAIL — módulos `../src/lib/upload.ts` e `../src/lib/image.ts` não existem.

- [ ] **Step 4: Implementar**

`apps/panel/src/api/uploads.ts`:

```ts
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
```

`apps/panel/src/lib/image.ts`:

```ts
const UPLOAD_MARKER = "/image/upload/";

/**
 * A imagem do Cloudinary na largura pedida, no formato e na qualidade que o
 * navegador aguenta. URL de fora — as coladas à mão antes do upload existir, a
 * prévia local — volta intacta.
 *
 * Use poucas larguras: cada combinação nova é uma transformação cobrada da
 * cota da conta.
 */
export function imageUrl(url: string, width: number): string {
  if (!url.startsWith("https://res.cloudinary.com/")) return url;
  const at = url.indexOf(UPLOAD_MARKER);
  if (at === -1) return url;
  const cut = at + UPLOAD_MARKER.length;
  return `${url.slice(0, cut)}f_auto,q_auto,c_limit,w_${width}/${url.slice(cut)}`;
}
```

`apps/panel/src/lib/upload.ts`:

```ts
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
```

- [ ] **Step 5: Rodar e ver passar; depois a suíte inteira**

Run: `pnpm --filter @menuclick/panel exec vitest run test/upload.test.ts test/image.test.ts && pnpm --filter @menuclick/panel test`
Expected: PASS. A suíte inteira roda porque o `MockCall` ganhou um campo: se algum teste antigo comparar uma chamada inteira com `toEqual`, acrescente `host: "localhost"` ao esperado.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/api/uploads.ts apps/panel/src/lib/upload.ts apps/panel/src/lib/image.ts apps/panel/test
git commit -m "feat(panel): ✨ envia imagem ao cloudinary com a assinatura da api"
```

---

### Task 5: Campo de imagem (`ImageField`)

**Files:**
- Create: `apps/panel/src/ui/ImageField.tsx`
- Create: `apps/panel/src/ui/ImageField.module.css`
- Create: `apps/panel/test/image-field.test.tsx`

**Interfaces:**
- Consumes (Task 4): `ACCEPTED_IMAGE_TYPES`, `validateImageFile`, `type ImageChange`, `KEEP` de `src/lib/upload.ts`; `imageUrl` de `src/lib/image.ts`.
- Produces: `ImageField(props: { label: string; description?: string; saved: string | undefined; change: ImageChange; onChange: (change: ImageChange) => void; shape?: "square" | "wide" })`. O `input` de arquivo tem `aria-label={label}`; os botões têm o nome acessível `Escolher ${label}` / `Trocar ${label}` / `Remover ${label}`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/panel/test/image-field.test.tsx`:

```tsx
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { type ImageChange, KEEP } from "../src/lib/upload.ts";
import { ImageField } from "../src/ui/ImageField.tsx";

const SAVED = "https://res.cloudinary.com/nuvem/image/upload/v1/menuclick/r/logo.jpg";
const seen: ImageChange[] = [];

function Harness({ saved }: { saved?: string }) {
  const [change, setChange] = useState<ImageChange>(KEEP);
  return (
    <MantineProvider env="test">
      <ImageField
        label="Logo"
        saved={saved}
        change={change}
        onChange={(next) => {
          seen.push(next);
          setChange(next);
        }}
      />
    </MantineProvider>
  );
}

function pick(file: File) {
  fireEvent.change(screen.getByLabelText("Logo"), { target: { files: [file] } });
}

const jpg = () => new File(["x"], "logo.jpg", { type: "image/jpeg" });

describe("ImageField", () => {
  it("sem imagem: mostra 'Sem imagem' e só o botão de escolher", () => {
    render(<Harness />);
    expect(screen.getByText("Sem imagem")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Escolher Logo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remover Logo" })).toBeNull();
  });

  it("com imagem salva: mostra a miniatura transformada, Trocar e Remover", () => {
    const { container } = render(<Harness saved={SAVED} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://res.cloudinary.com/nuvem/image/upload/f_auto,q_auto,c_limit,w_400/v1/menuclick/r/logo.jpg",
    );
    expect(screen.getByRole("button", { name: "Trocar Logo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remover Logo" })).toBeTruthy();
  });

  it("escolher mostra a prévia local e avisa a troca, sem enviar nada", () => {
    seen.length = 0;
    const { container } = render(<Harness />);
    const file = jpg();
    pick(file);
    expect(seen).toEqual([{ kind: "replace", file, previewUrl: "blob:previa" }]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:previa");
  });

  it("arquivo que não serve mostra o motivo e não avisa troca", () => {
    seen.length = 0;
    render(<Harness />);
    pick(new File(["x"], "foto.heic", { type: "image/heic" }));
    expect(screen.getByText("Use uma imagem JPG, PNG ou WebP.")).toBeTruthy();
    expect(seen).toEqual([]);
  });

  it("escolher um arquivo bom depois de um ruim apaga o aviso", () => {
    render(<Harness />);
    pick(new File(["x"], "foto.heic", { type: "image/heic" }));
    pick(jpg());
    expect(screen.queryByText("Use uma imagem JPG, PNG ou WebP.")).toBeNull();
  });

  it("Remover de imagem salva avisa a remoção; de imagem só escolhida, volta ao que era", () => {
    seen.length = 0;
    const salva = render(<Harness saved={SAVED} />);
    fireEvent.click(screen.getByRole("button", { name: "Remover Logo" }));
    expect(seen).toEqual([{ kind: "remove" }]);
    expect(screen.getByText("Sem imagem")).toBeTruthy();
    salva.unmount();

    seen.length = 0;
    render(<Harness />);
    pick(jpg());
    fireEvent.click(screen.getByRole("button", { name: "Remover Logo" }));
    expect(seen[1]).toEqual({ kind: "keep" });
    expect(screen.getByText("Sem imagem")).toBeTruthy();
  });

  // o `input` de arquivo não dispara `change` quando o valor é o mesmo: sem
  // limpar o valor, escolher de novo o arquivo recém-removido não faria nada
  it("depois de escolher, o input fica vazio para aceitar o mesmo arquivo de novo", () => {
    render(<Harness />);
    pick(jpg());
    expect((screen.getByLabelText("Logo") as HTMLInputElement).value).toBe("");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @menuclick/panel exec vitest run test/image-field.test.tsx`
Expected: FAIL — `../src/ui/ImageField.tsx` não existe.

- [ ] **Step 3: Implementar**

`apps/panel/src/ui/ImageField.module.css`:

```css
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
}

.preview {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  height: 72px;
  font-size: 11px;
  color: var(--mc-ink2);
  background: var(--mc-surface);
  border: 1px solid var(--mc-line);
  border-radius: 8px;
}

.preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.square {
  width: 72px;
}

/* a capa é uma faixa: a prévia segue a proporção do topo do cardápio */
.wide {
  width: 160px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

`apps/panel/src/ui/ImageField.tsx`:

```tsx
import { Button, Input } from "@mantine/core";
import { useRef, useState } from "react";
import { imageUrl } from "../lib/image.ts";
import { ACCEPTED_IMAGE_TYPES, type ImageChange, KEEP, validateImageFile } from "../lib/upload.ts";
import buttons from "./buttons.module.css";
import classes from "./ImageField.module.css";

/**
 * Campo de imagem de um formulário: prévia, escolher/trocar e remover.
 *
 * NÃO envia nada. Ele só conta ao formulário o que a pessoa fez (`onChange`);
 * quem envia é o salvar. A troca sobrescreve o mesmo endereço no Cloudinary,
 * então subir ao escolher mudaria o cardápio antes de a pessoa confirmar — e
 * "Cancelar" não teria como desfazer.
 */
export function ImageField({
  label,
  description,
  saved,
  change,
  onChange,
  shape = "square",
}: {
  label: string;
  description?: string;
  /** A URL que está salva hoje, se houver. */
  saved: string | undefined;
  change: ImageChange;
  onChange: (change: ImageChange) => void;
  shape?: "square" | "wide";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const shown =
    change.kind === "replace"
      ? change.previewUrl
      : change.kind === "remove" || saved === undefined
        ? null
        : imageUrl(saved, 400);

  /** A prévia local segura memória até ser liberada. */
  const releasePreview = () => {
    if (change.kind === "replace") URL.revokeObjectURL(change.previewUrl);
  };

  const pick = (file: File | undefined) => {
    if (file === undefined) return;
    const found = validateImageFile(file);
    setProblem(found);
    if (found !== null) return;
    releasePreview();
    onChange({ kind: "replace", file, previewUrl: URL.createObjectURL(file) });
  };

  const remove = () => {
    setProblem(null);
    releasePreview();
    // sem nada salvo, "remover" a imagem recém-escolhida é só desistir dela
    onChange(saved === undefined ? KEEP : { kind: "remove" });
  };

  return (
    // `labelElement="div"`: o rótulo descreve o grupo; o controle com nome é o
    // `input` de arquivo, pelo `aria-label`
    <Input.Wrapper label={label} labelElement="div" description={description} error={problem}>
      <div className={classes.row}>
        <div className={`${classes.preview} ${classes[shape]}`}>
          {shown === null ? "Sem imagem" : <img src={shown} alt="" />}
        </div>
        <div className={classes.actions}>
          <Button
            variant="default"
            size="xs"
            aria-label={`${shown === null ? "Escolher" : "Trocar"} ${label}`}
            onClick={() => input.current?.click()}
          >
            {shown === null ? "Escolher imagem" : "Trocar"}
          </Button>
          {shown !== null && (
            <Button
              variant="subtle"
              size="xs"
              className={buttons.dangerText}
              aria-label={`Remover ${label}`}
              onClick={remove}
            >
              Remover
            </Button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={label}
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        onChange={(event) => {
          pick(event.currentTarget.files?.[0]);
          // sem isto, escolher de novo o mesmo arquivo não dispara `change`
          event.currentTarget.value = "";
        }}
      />
    </Input.Wrapper>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @menuclick/panel exec vitest run test/image-field.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/ui/ImageField.tsx apps/panel/src/ui/ImageField.module.css apps/panel/test/image-field.test.tsx
git commit -m "feat(panel): ✨ adiciona o campo de imagem com prévia, troca e remoção"
```

---

### Task 6: Logo e capa por upload em Dados da loja

**Files:**
- Modify: `apps/panel/src/features/settings/storeForm.ts`
- Modify: `apps/panel/src/features/settings/StoreDataPage.tsx`
- Modify: `apps/panel/test/storeForm.test.ts`
- Modify: `apps/panel/test/store-data-page.test.tsx`

**Interfaces:**
- Consumes (Tasks 4 e 5): `uploadImage(restaurantId, file, target)`, `describeSaveError`, `type ImageChange`, `KEEP`; `ImageField`; `useUpdateRestaurant(id)` de `features/restaurant/useRestaurant.ts` (mutação que recebe `RestaurantPatch`); `uploadHandlers`, `UPLOADED_URL` de `test/fixtures.ts`.
- Produces: `StoreForm` sem `logoUrl`/`coverUrl`; a tela "Dados da loja" com os campos "Logo" e "Capa do cardápio".

- [ ] **Step 1: Ajustar os testes do formulário puro**

Em `apps/panel/test/storeForm.test.ts`:

- no teste "carrega o restaurante no formulário", apague as linhas `logoUrl: "",` e `coverUrl: "",` do objeto esperado;
- troque o teste "capa e cor esvaziadas vão como null; preenchidas, como texto" por:

```ts
  it("cor esvaziada vai como null; preenchida, em maiúsculas", () => {
    const withBrand = { ...initial, brandColor: "#0B7A48" };
    expect(changedPatch({ ...withBrand, brandColor: "" }, withBrand)).toEqual({ brandColor: null });
    expect(changedPatch({ ...initial, brandColor: "#0b7a48" }, initial)).toEqual({ brandColor: "#0B7A48" });
  });
```

- apague o teste "logo esvaziado vai como null: é assim que a API tira o logo";
- no teste "recusa o que a API recusaria", apague as duas últimas asserções (as de `logoUrl`).

- [ ] **Step 2: Escrever os testes de tela que falham**

Em `apps/panel/test/store-data-page.test.tsx`, importe `UPLOADED_URL` e `uploadHandlers` de `./fixtures.ts` e acrescente dentro do `describe`:

```tsx
  const SAVED_LOGO = `https://res.cloudinary.com/nuvem/image/upload/v1/menuclick/${RESTAURANT_ID}/logo.jpg`;
  const pickLogo = async () =>
    fireEvent.change(await screen.findByLabelText("Logo"), {
      target: { files: [new File(["x"], "logo.jpg", { type: "image/jpeg" })] },
    });

  it("não tem mais campo de URL de imagem", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    await screen.findByLabelText("Nome da loja");
    expect(screen.queryByLabelText("URL do logo")).toBeNull();
    expect(screen.queryByLabelText("Capa do cardápio (URL)")).toBeNull();
    expect(screen.getByLabelText("Logo")).toBeTruthy();
    expect(screen.getByLabelText("Capa do cardápio")).toBeTruthy();
  });

  it("trocar o logo: escolher suja o formulário, e salvar assina, envia e grava a secure_url", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ logoUrl: UPLOADED_URL }) },
      ...uploadHandlers(),
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    await pickLogo();
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
    // escolher não envia nada
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ logoUrl: UPLOADED_URL }),
    );
    const posts = api.calls.filter((call) => call.method === "POST");
    expect(posts.map((call) => call.host)).toEqual(["localhost", "api.cloudinary.com"]);
    expect(posts[0].body).toEqual({ target: "logo" });
    await waitFor(() => expect(screen.queryByText("Alterações não salvas")).toBeNull());
  });

  it("a capa é assinada como capa", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant() },
      ...uploadHandlers(),
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.change(await screen.findByLabelText("Capa do cardápio"), {
      target: { files: [new File(["x"], "capa.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(api.calls.find((call) => call.method === "POST" && call.host === "localhost")?.body).toEqual({
      target: "cover",
    });
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ coverUrl: UPLOADED_URL });
  });

  it("envio que falha mostra o motivo, não chama o PATCH e deixa o formulário sujo", async () => {
    signIn();
    const api = mockApi([...uploadHandlers({ uploadStatus: 401 }), ...panelHandlers()]);
    renderInPanel(routes, "/dados-da-loja");
    await pickLogo();
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    expect(await screen.findByText("O envio da imagem falhou. Tente de novo.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
  });

  it("Remover manda null, sem enviar nada", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant() },
      ...panelHandlers({ restaurant: { logoUrl: SAVED_LOGO } }),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.click(await screen.findByRole("button", { name: "Remover Logo" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ logoUrl: null }),
    );
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("mudar só o nome não manda campo de imagem", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ name: "Trattoria Bela" }) },
      ...panelHandlers({ restaurant: { logoUrl: SAVED_LOGO } }),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.change(await screen.findByLabelText("Nome da loja"), { target: { value: "Trattoria Bela" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ name: "Trattoria Bela" }),
    );
  });

  it("Cancelar desfaz a imagem escolhida", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    await pickLogo();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(screen.getAllByText("Sem imagem")).toHaveLength(2);
  });

  it("dois cliques em Salvar durante o envio fazem um envio só", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ logoUrl: UPLOADED_URL }) },
      ...uploadHandlers(),
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    await pickLogo();
    const save = screen.getByRole("button", { name: "Salvar dados" });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(api.calls.filter((call) => call.host === "api.cloudinary.com")).toHaveLength(1);
    expect(api.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
  });
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @menuclick/panel exec vitest run test/store-data-page.test.tsx test/storeForm.test.ts`
Expected: FAIL — não existe campo "Logo", e `fromRestaurant` ainda devolve `logoUrl`/`coverUrl`.

- [ ] **Step 4: Tirar as imagens do formulário de texto**

Em `apps/panel/src/features/settings/storeForm.ts`:

- no tipo `StoreForm`, apague `logoUrl: string;` e `coverUrl: string;`;
- em `fromRestaurant`, apague as linhas de `logoUrl` e `coverUrl`;
- apague a função `isHttpUrl` inteira;
- em `validateStoreForm`, apague o bloco das três linhas `const logoUrl…`, `const coverUrl…` e o `if` da mensagem "Cole um endereço completo de imagem…";
- em `changedPatch`, apague o bloco de `logoUrl` (com o comentário "Esvaziar o campo tira o logo…") e o de `coverUrl`, e troque o comentário de documentação da função por:

```ts
/**
 * Só o que mudou. O endereço vai INTEIRO quando qualquer campo dele muda: a
 * API o recebe como objeto, e mandar meio endereço apagaria o resto.
 *
 * Logo e capa não passam por aqui: são arquivos, enviados no salvar pela tela
 * (`ImageChange`), e só então viram `logoUrl`/`coverUrl` no `PATCH`.
 */
```

- [ ] **Step 5: Ligar o upload na tela**

Em `apps/panel/src/features/settings/StoreDataPage.tsx`:

Imports — acrescente `useMutation` e os módulos novos, e troque o `describeError` do salvar:

```tsx
import { useMutation } from "@tanstack/react-query";
import type { RestaurantPatch } from "../../api/restaurant.ts";
import { describeSaveError, type ImageChange, KEEP, uploadImage } from "../../lib/upload.ts";
import { ImageField } from "../../ui/ImageField.tsx";
```

Dentro de `StoreDataEditor`, depois de `const update = useUpdateRestaurant(restaurant.id);`:

```tsx
  const [logo, setLogo] = useState<ImageChange>(KEEP);
  const [cover, setCover] = useState<ImageChange>(KEEP);
  // Trava contra o segundo clique. É um `ref`, e não o `isPending` da mutação:
  // o TanStack Query avisa a mudança de estado depois do clique, então dois
  // cliques seguidos enxergariam `isPending: false` — e fariam dois envios.
  const saving = useRef(false);

  // O salvar tem dois tempos: as imagens sobem ANTES do PATCH, e é a URL que
  // o Cloudinary devolve que vai nele. Envio que falha interrompe aqui, sem
  // gravar nada. Se o envio der certo e o PATCH falhar, o arquivo novo já
  // está lá, mas o cardápio segue na versão antiga — o banco guarda a URL com
  // versão — e salvar de novo conserta.
  const save = useMutation({
    mutationFn: async (textPatch: RestaurantPatch) => {
      const patch: RestaurantPatch = { ...textPatch };
      if (logo.kind === "replace") patch.logoUrl = await uploadImage(restaurant.id, logo.file, "logo");
      if (logo.kind === "remove") patch.logoUrl = null;
      if (cover.kind === "replace") patch.coverUrl = await uploadImage(restaurant.id, cover.file, "cover");
      if (cover.kind === "remove") patch.coverUrl = null;
      return update.mutateAsync(patch);
    },
    onSuccess: () => {
      setLogo(KEEP);
      setCover(KEEP);
    },
    onSettled: () => {
      saving.current = false;
    },
  });
```

(`useRef` entra no import de `react`, ao lado do `useState`.)

Troque o cálculo de `dirty` por:

```tsx
  const patch = changedPatch(form, initial);
  const dirty = Object.keys(patch).length > 0 || logo.kind !== "keep" || cover.kind !== "keep";
```

Troque `submit` por:

```tsx
  const submit = () => {
    const found = validateStoreForm(form);
    setProblem(found);
    if (found !== null || !dirty || saving.current) return;
    saving.current = true;
    save.mutate(patch);
  };
```

Troque os dois `TextInput` de "URL do logo" e "Capa do cardápio (URL)" por:

```tsx
            <ImageField
              label="Logo"
              description="JPG, PNG ou WebP, até 5 MB. Aparece ao lado do nome da loja no cardápio."
              saved={restaurant.logoUrl}
              change={logo}
              onChange={setLogo}
            />
            <ImageField
              label="Capa do cardápio"
              description="A imagem do topo do cardápio que o cliente abre pelo QR code. Fica melhor na horizontal."
              saved={restaurant.coverUrl}
              change={cover}
              onChange={setCover}
              shape="wide"
            />
```

Troque o bloco de erro `{update.isError && (…)}` por:

```tsx
        {save.isError && (
          <p role="alert" className={classes.error}>
            {describeSaveError(save.error)}
          </p>
        )}
```

Na `SaveBar`, troque `busy={update.isPending}` por `busy={save.isPending}` e o `cancel.onClick` por:

```tsx
          onClick: () => {
            setForm(initial);
            setProblem(null);
            setLogo(KEEP);
            setCover(KEEP);
            save.reset();
          },
```

Se o import de `describeError` ainda for usado no componente `StoreDataPage` (o texto de carregamento), mantenha-o.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @menuclick/panel exec vitest run test/store-data-page.test.tsx test/storeForm.test.ts test/save-bar.test.tsx test/unsaved-guard.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/features/settings apps/panel/test/storeForm.test.ts apps/panel/test/store-data-page.test.tsx
git commit -m "feat(panel): ✨ envia logo e capa pelo painel em dados da loja"
```

---

### Task 7: Foto do produto por upload

**Files:**
- Modify: `apps/panel/src/api/products.ts`
- Modify: `apps/panel/src/features/products/productForm.ts`
- Modify: `apps/panel/src/features/products/ProductFormPage.tsx`
- Modify: `apps/panel/src/features/products/ProductsPage.tsx` (miniatura)
- Modify: `apps/panel/test/productForm.test.ts`
- Modify: `apps/panel/test/product-form.test.tsx`

**Interfaces:**
- Consumes (Tasks 4 e 5): `uploadImage(restaurantId, file, "product", productId)`, `describeSaveError`, `type ImageChange`, `KEEP`, `ImageField`, `imageUrl`; `uploadHandlers`, `makeUploadSignature`, `UPLOADED_URL` de `test/fixtures.ts`.
- Produces: `CreateProductBody` sem `photoUrl`; `UpdateProductBody.photoUrl?: string | null` (opcional); `updateProduct(restaurantId, id, body: Partial<UpdateProductBody>)`; `ProductForm` e `ValidProduct` sem `photoUrl`.

- [ ] **Step 1: Ajustar os testes do formulário puro**

Em `apps/panel/test/productForm.test.ts`:

- no teste "valida e converte o preço por string", apague a linha `photoUrl: null,` do valor esperado;
- no teste "recusa com mensagem que a pessoa entende", apague a última asserção (a de `photoUrl: "foto.jpg"`);
- no teste "edição manda categoryId null para tirar da seção", apague a linha `photoUrl: null,` do corpo esperado;
- apague o teste "foto esvaziada vai como null: é assim que a API tira a foto".

- [ ] **Step 2: Escrever os testes de tela que falham**

Em `apps/panel/test/product-form.test.tsx`, importe `waitFor` de `@testing-library/react` e `makeUploadSignature`, `UPLOADED_URL`, `uploadHandlers` de `./fixtures.ts`, e acrescente dentro do `describe`:

```tsx
  const pickPhoto = async () =>
    fireEvent.change(await screen.findByLabelText("Foto"), {
      target: { files: [new File(["x"], "pizza.jpg", { type: "image/jpeg" })] },
    });
  const SAVED_PHOTO = `https://res.cloudinary.com/nuvem/image/upload/v1/menuclick/${RESTAURANT_ID}/products/prod-1.jpg`;

  it("não tem mais campo de URL da foto", async () => {
    setup([], "/produtos/novo");
    await screen.findByLabelText("Nome");
    expect(screen.queryByLabelText("URL da foto")).toBeNull();
    expect(screen.getByLabelText("Foto")).toBeTruthy();
  });

  it("produto novo com foto: cria, assina com o id novo, envia e grava a foto", async () => {
    const api = setup(
      [
        { method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) },
        { method: "PATCH", path: `${BASE}/products/prod-9`, body: makeProduct({ id: "prod-9" }) },
        ...uploadHandlers(),
      ],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    await pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect((await screen.findByTestId("location")).textContent).toBe("/produtos");
    const writes = api.calls.filter((call) => call.method !== "GET");
    expect(writes.map((call) => `${call.method} ${call.host}${call.path}`)).toEqual([
      `POST localhost${BASE}/products`,
      `POST localhost${BASE}/uploads/signature`,
      "POST api.cloudinary.com/v1_1/nuvem/image/upload",
      `PATCH localhost${BASE}/products/prod-9`,
    ]);
    // a criação não leva foto: o endereço da imagem depende do id
    expect(writes[0].body).toEqual({ name: "Pizza Grande", priceInCents: 4590, stock: 0 });
    expect(writes[1].body).toEqual({ target: "product", productId: "prod-9" });
    expect(writes[3].body).toEqual({ photoUrl: UPLOADED_URL });
  });

  it("produto novo cuja foto não sobe: fica criado e a tela vira a de edição, com o aviso", async () => {
    const api = setup(
      [
        { method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) },
        { method: "GET", path: `${BASE}/products/prod-9`, body: makeProduct({ id: "prod-9" }) },
        ...uploadHandlers({ uploadStatus: 401 }),
      ],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    await pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect(await screen.findByText("Produto criado, mas a foto não subiu. Tente de novo.")).toBeTruthy();
    // é a edição do produto criado: salvar de novo não cria um segundo
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === "GET" && call.path === `${BASE}/products/prod-9`)).toBe(true),
    );
    expect(api.calls.filter((call) => call.method === "POST" && call.path === `${BASE}/products`)).toHaveLength(1);
  });

  it("editar e trocar a foto: envia antes, e a foto vai no mesmo PATCH", async () => {
    const api = setup(
      [
        { method: "GET", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1", photoUrl: SAVED_PHOTO }) },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
        {
          method: "POST",
          path: `${BASE}/uploads/signature`,
          body: makeUploadSignature({ publicId: `menuclick/${RESTAURANT_ID}/products/prod-1` }),
        },
        ...uploadHandlers(),
      ],
      "/produtos/prod-1",
    );
    await pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    await screen.findByTestId("location");
    const patches = api.calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toMatchObject({ name: "Pizza Grande", photoUrl: UPLOADED_URL });
    expect(api.calls.find((call) => call.path === `${BASE}/uploads/signature`)?.body).toEqual({
      target: "product",
      productId: "prod-1",
    });
  });

  it("editar sem mexer na foto não manda photoUrl", async () => {
    const api = setup(
      [
        { method: "GET", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1", photoUrl: SAVED_PHOTO }) },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
      ],
      "/produtos/prod-1",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Gigante");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    await screen.findByTestId("location");
    const body = api.calls.find((call) => call.method === "PATCH")?.body as Record<string, unknown>;
    expect("photoUrl" in body).toBe(false);
  });

  it("Remover a foto manda photoUrl null", async () => {
    const api = setup(
      [
        { method: "GET", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1", photoUrl: SAVED_PHOTO }) },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
      ],
      "/produtos/prod-1",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remover Foto" }));
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    await screen.findByTestId("location");
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toMatchObject({ photoUrl: null });
  });

  it("dois cliques em Salvar num produto novo criam um produto só", async () => {
    const api = setup(
      [{ method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) }],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    const save = screen.getByRole("button", { name: "Salvar produto" });
    fireEvent.click(save);
    fireEvent.click(save);

    await screen.findByTestId("location");
    expect(api.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("editar: envio que falha mostra o motivo e não grava nada", async () => {
    const api = setup(
      [
        { method: "GET", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
        ...uploadHandlers({ uploadStatus: 401 }),
      ],
      "/produtos/prod-1",
    );
    await pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect(await screen.findByText("O envio da imagem falhou. Tente de novo.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "PATCH")).toBe(false);
  });
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @menuclick/panel exec vitest run test/product-form.test.tsx test/productForm.test.ts`
Expected: FAIL — não existe campo "Foto", e o formulário ainda tem `photoUrl`.

- [ ] **Step 4: API e formulário puro**

Em `apps/panel/src/api/products.ts`:

- em `CreateProductBody`, apague `photoUrl?: string;`;
- troque o comentário e o tipo `UpdateProductBody` por:

```ts
/**
 * `categoryId: null` tira da seção (F12). `photoUrl` só vai quando a foto
 * mudou: `null` tira, e a URL é a `secure_url` que o Cloudinary devolveu — a
 * API recusa qualquer outra, inclusive a URL externa antiga reenviada.
 */
export type UpdateProductBody = {
  name: string;
  priceInCents: number;
  stock: number;
  categoryId: string | null;
  description: string;
  photoUrl?: string | null;
};
```

- troque a assinatura de `updateProduct` por:

```ts
export function updateProduct(
  restaurantId: string,
  id: string,
  body: Partial<UpdateProductBody>,
): Promise<Product> {
  return apiRequest<Product>(`/restaurants/${restaurantId}/products/${id}`, { method: "PATCH", body });
}
```

Em `apps/panel/src/features/products/productForm.ts`:

- em `ProductForm`, apague `photoUrl: string;`; em `EMPTY_FORM`, apague `photoUrl: "",`; em `fromProduct`, apague a linha de `photoUrl`;
- em `ValidProduct`, apague `photoUrl: string | null;`;
- apague a função `isHttpUrl` inteira;
- em `validateProductForm`, apague as quatro linhas de `const photoUrl…` até o fim do `if`, e a linha `photoUrl: photoUrl === "" ? null : photoUrl,` do valor devolvido;
- em `toCreateBody`, apague a linha `...(value.photoUrl !== null ? { photoUrl: value.photoUrl } : {}),`;
- em `toUpdateBody`, apague o comentário e a linha `photoUrl: value.photoUrl,`.

- [ ] **Step 5: A tela**

Em `apps/panel/src/features/products/ProductFormPage.tsx`:

Imports novos:

```tsx
import { describeSaveError, type ImageChange, KEEP, uploadImage } from "../../lib/upload.ts";
import { ImageField } from "../../ui/ImageField.tsx";
```

Troque a classe `GroupsNotSaved` por:

```tsx
/**
 * O produto foi salvo; uma etapa de DEPOIS falhou (os grupos de opções, ou a
 * foto de um produto recém-criado). O `notice` é o texto inteiro para a tela.
 */
class SavedWithProblem extends Error {
  readonly productId: string;

  constructor(productId: string, notice: string) {
    super(notice);
    this.name = "SavedWithProblem";
    this.productId = productId;
  }
}
```

Dentro de `ProductEditor`, depois do `useState` do `error`:

```tsx
  const [photo, setPhoto] = useState<ImageChange>(KEEP);
  // Trava contra o segundo clique — `ref`, não `isPending`: a mutação avisa a
  // mudança de estado depois do clique, e dois cliques seguidos fariam dois
  // envios (e, em produto novo, dois produtos).
  const saving = useRef(false);
```

(`useRef` entra no import de `react`, ao lado do `useState`.) No `useMutation` do `save`, acrescente ao lado de `onSuccess` e `onError`:

```tsx
    onSettled: () => {
      saving.current = false;
    },
```

Troque o `mutationFn` do `save` por:

```tsx
    mutationFn: async (value: ValidProduct) => {
      // Produto que já existe: a foto sobe ANTES, e vai no mesmo PATCH — envio
      // que falha interrompe sem gravar nada.
      const photoPatch: { photoUrl?: string | null } = {};
      if (photo.kind === "remove") photoPatch.photoUrl = null;
      if (product && photo.kind === "replace") {
        photoPatch.photoUrl = await uploadImage(restaurantId, photo.file, "product", product.id);
      }
      const saved = product
        ? await updateProduct(restaurantId, product.id, { ...toUpdateBody(value), ...photoPatch })
        : await createProduct(restaurantId, toCreateBody(value));

      // Daqui para baixo o produto JÁ está salvo — e o erro precisa dizer
      // isso, senão a pessoa salva de novo e duplica. As duas etapas são
      // tentadas mesmo que a outra falhe.
      const problems: string[] = [];

      // Produto novo: o endereço da foto tem o id, que só existe agora.
      if (!product && photo.kind === "replace") {
        try {
          const photoUrl = await uploadImage(restaurantId, photo.file, "product", saved.id);
          await updateProduct(restaurantId, saved.id, { photoUrl });
        } catch {
          problems.push("Produto criado, mas a foto não subiu. Tente de novo.");
        }
      }
      if (!sameIds(product?.optionGroupIds ?? [], value.optionGroupIds)) {
        try {
          await setProductOptionGroups(restaurantId, saved.id, value.optionGroupIds);
        } catch (cause) {
          problems.push(`O produto foi salvo, mas os grupos de opções não: ${describeError(cause)}`);
        }
      }
      if (problems.length > 0) throw new SavedWithProblem(saved.id, problems.join(" "));
      return saved;
    },
```

Troque o `onError` do `save` por:

```tsx
    onError: (cause) => {
      if (!(cause instanceof SavedWithProblem)) {
        setError(describeSaveError(cause));
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["products", restaurantId] });
      void queryClient.invalidateQueries({ queryKey: optionGroupsQueryKey(restaurantId) });
      if (product) setError(cause.message);
      // produto recém-criado: a tela passa a ser a de edição, senão salvar de
      // novo criaria um segundo produto
      else navigate(`/produtos/${cause.productId}`, {
        replace: true,
        state: { ...LEAVE_WITHOUT_ASKING, notice: cause.message },
      });
    },
```

Troque `submit` por:

```tsx
  const submit = () => {
    if (saving.current) return;
    const result = validateProductForm(form);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    saving.current = true;
    save.mutate(result.value);
  };
```

Troque o `TextInput` de "URL da foto" por:

```tsx
            <ImageField
              label="Foto"
              description="JPG, PNG ou WebP, até 5 MB."
              saved={product?.photoUrl}
              change={photo}
              onChange={setPhoto}
            />
```

Na `SaveBar`, troque `dirty={isDirty(form, initial)}` por:

```tsx
        dirty={isDirty(form, initial) || photo.kind !== "keep"}
```

- [ ] **Step 6: Miniatura da listagem**

Em `apps/panel/src/features/products/ProductsPage.tsx`, importe `imageUrl` de `../../lib/image.ts` e troque:

```tsx
                <img className={classes.thumb} src={product.photoUrl} alt="" />
```

por:

```tsx
                <img className={classes.thumb} src={imageUrl(product.photoUrl, 200)} alt="" />
```

- [ ] **Step 7: Rodar e ver passar; suíte, type-check e lint do painel**

Run: `pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/panel build && pnpm lint`
Expected: PASS nos três. Os testes antigos de "grupos que falham…" continuam passando: a mensagem dos grupos é a mesma de antes.

- [ ] **Step 8: Commit**

```bash
git add apps/panel/src apps/panel/test
git commit -m "feat(panel): ✨ envia a foto do produto pelo painel"
```

---

### Task 8: Imagem na largura certa no app do cliente

**Files:**
- Create: `apps/menu/src/lib/image.ts`
- Create: `apps/menu/test/image.test.ts`
- Modify: `apps/menu/src/components/MenuHeader.tsx`
- Modify: `apps/menu/src/components/ProductGrid.tsx`
- Modify: `apps/menu/src/components/ProductScreen.tsx`
- Modify: `apps/menu/src/app/[slug]/page.tsx`

**Interfaces:**
- Consumes: nada das outras tasks (a função é cópia deliberada da do painel — pequena demais para virar pacote).
- Produces: `imageUrl(url: string, width: number): string` em `apps/menu/src/lib/image.ts`.

Antes de escrever código neste app, leia `apps/menu/AGENTS.md`: o Next 16 tem diferenças do que você conhece.

- [ ] **Step 1: Escrever o teste que falha**

`apps/menu/test/image.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @menuclick/menu exec vitest run test/image.test.ts`
Expected: FAIL — `../src/lib/image.ts` não existe.

- [ ] **Step 3: Implementar**

`apps/menu/src/lib/image.ts`:

```ts
const UPLOAD_MARKER = "/image/upload/";

/**
 * A imagem do Cloudinary na largura pedida, no formato e na qualidade que o
 * navegador aguenta: o lojista sobe a foto da câmera, e o cardápio abre em 4G.
 * URL de fora — as coladas à mão antes de o upload existir — volta intacta.
 *
 * ⚠️ Use só as larguras fixas de cada tela (grade 400, produto 800, capa
 * 1200, logo 200): cada combinação nova é uma transformação cobrada da cota
 * da conta.
 */
export function imageUrl(url: string, width: number): string {
  if (!url.startsWith("https://res.cloudinary.com/")) return url;
  const at = url.indexOf(UPLOAD_MARKER);
  if (at === -1) return url;
  const cut = at + UPLOAD_MARKER.length;
  return `${url.slice(0, cut)}f_auto,q_auto,c_limit,w_${width}/${url.slice(cut)}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @menuclick/menu exec vitest run test/image.test.ts`
Expected: PASS.

- [ ] **Step 5: Usar nas quatro telas**

Em cada arquivo abaixo, importe a função como os outros imports de `lib/` do app: `import { imageUrl } from "@/lib/image.ts";`.

`apps/menu/src/components/MenuHeader.tsx` — troque os dois `src`:

```tsx
          <img src={imageUrl(restaurant.coverUrl, 1200)} alt="" className="h-full w-full object-cover" />
```

```tsx
            <img src={imageUrl(restaurant.logoUrl, 200)} alt="" className="h-full w-full object-cover" />
```

`apps/menu/src/components/ProductGrid.tsx`:

```tsx
        <img src={imageUrl(product.photoUrl, 400)} alt="" loading="lazy" className="h-full w-full object-cover" />
```

`apps/menu/src/components/ProductScreen.tsx`:

```tsx
          <img src={imageUrl(product.photoUrl, 800)} alt="" className="h-full w-full object-cover" />
```

`apps/menu/src/app/[slug]/page.tsx`, em `generateMetadata`:

```tsx
    openGraph: {
      title: menu.restaurant.name,
      images: menu.restaurant.coverUrl ? [imageUrl(menu.restaurant.coverUrl, 1200)] : [],
    },
```

- [ ] **Step 6: Suíte, build e lint do app**

Run: `pnpm --filter @menuclick/menu test && pnpm --filter @menuclick/menu build && pnpm lint`
Expected: PASS. No `next build`, a rota `/[slug]` continua com `●` (ISR), não `ƒ`. `test/ssr.test.tsx` continua passando: a função é pura e não depende de relógio nem de `window`.

- [ ] **Step 7: Commit**

```bash
git add apps/menu/src apps/menu/test/image.test.ts
git commit -m "feat(menu): ✨ pede a imagem ao cloudinary na largura de cada tela"
```

---

### Task 9: Documentação e conferência real

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/deploy.md`
- Modify: `docs/superpowers/specs/2026-10-08-upload-de-imagens-design.md` (linha de estado)

**Interfaces:**
- Consumes: tudo das Tasks 1 a 8, funcionando.
- Produces: documentação; nenhuma interface de código.

- [ ] **Step 1: `CLAUDE.md`**

Na seção "Comandos", no parágrafo que começa com "A API respeita `PORT`", depois da frase do `MENU_BASE_URL`, acrescente: `🚨 **\`CLOUDINARY_URL\` também é obrigatória** (a conta que guarda logo, capa e foto; ver a seção de imagens).`

Antes da seção "### Documentação: OpenAPI derivado das rotas", acrescente:

```markdown
### Imagens (Cloudinary)

Logo, capa e foto de produto eram três campos de URL colada à mão. Agora o
painel envia o arquivo **direto do navegador para o Cloudinary**, e a API só
**assina** (`POST /restaurants/:restaurantId/uploads/signature`, em
`src/cloudinary.ts`, com `node:crypto` — sem SDK). O arquivo nunca passa pela
API: o `bodyLimit` é 128 KB e o Render gratuito não aguentaria.

- **O endereço é fixo por dono** (`menuclick/<restaurantId>/logo`, `…/cover`,
  `…/products/<productId>`), e é a API que o escolhe, nunca o cliente. Trocar a
  imagem **sobrescreve** o mesmo arquivo: não sobra órfã na conta e a API nunca
  chama o Cloudinary. A assinatura também trava os formatos (`jpg,png,webp`) e
  uma transformação de entrada (`c_limit,w_2000,h_2000`).
- 🔒 **A API só grava URL do nosso Cloudinary, na pasta daquela loja**
  (`assertOwnImageUrl`, nos serviços de restaurante e de produto): forma exata,
  com versão, sem transformação no caminho, e com o `restaurantId`/`productId`
  **da rota**. O endereço vai direto para o `<img>` de todo cliente — URL
  arbitrária ali é rastreador. ⚠️ A forma é comparada por igualdade, não por
  prefixo: afrouxar para "começa com" deixa passar `…/logo.jpg?x=…`.
- ⚠️ **A versão na URL (`/v<n>/`) não é enfeite**: como o arquivo é sobrescrito,
  é ela que faz a foto trocada aparecer. O que o banco guarda é o original
  versionado; a transformação de exibição (`f_auto,q_auto,c_limit,w_<n>`) é
  posta pelo app (`lib/image.ts`), com poucas larguras fixas — cada combinação
  nova é uma transformação cobrada da cota.
- **A imagem só entra por `PATCH`.** `POST …/products` e o cadastro descartam
  `photoUrl`/`logoUrl`: o endereço tem o id, que ainda não existe.
- **URL externa antiga continua sendo lida**; só gravação nova é conferida.
  Reenviar a URL antiga num `PATCH` é 400 — o painel só manda o campo de imagem
  quando ela mudou.
- **Foto removida não é apagada do Cloudinary**, e produto removido também não:
  é coerente com o soft delete (restaurar devolve a foto), e o limite é um
  arquivo por dono.
- ⚠️ **A cota é da conta inteira** (plano gratuito, 25 créditos/mês entre
  espaço, banda e transformações), e dev e produção dividem a mesma conta e a
  mesma pasta. Estourar restringe a conta até virar o mês.
- 🚨 **`CLOUDINARY_URL` derruba o boot se faltar ou vier malformada**, e está no
  `logger.redact`: o segredo está dentro dela. A mensagem de erro nunca repete
  o valor.
```

Na seção "### Painel da loja (`apps/panel`)", acrescente ao fim da lista:

```markdown
- **Imagem é upload, e o arquivo sobe no SALVAR, não ao escolher** (`ImageField` em `src/ui/`, envio em `lib/upload.ts`). Como a troca sobrescreve o mesmo endereço, subir ao escolher mudaria o cardápio antes de a pessoa confirmar, e "Cancelar" não desfaria. A ordem é assinatura → envio → `PATCH` com a `secure_url`; envio que falha interrompe antes do `PATCH`. ⚠️ O envio ao Cloudinary é `fetch` cru, **sem** `apiRequest`: o Bearer não pode sair para outro domínio.
- **Produto novo sobe a foto depois de criado** (o endereço tem o id): `POST` → envio → `PATCH`. Se a foto falhar, o produto fica criado e a tela vira a de edição, com o aviso — o mesmo caminho dos grupos de opções que falham (`SavedWithProblem`).
```

Na seção "### App do cliente (`apps/menu`)", acrescente ao fim da lista:

```markdown
- **Toda imagem passa por `imageUrl()`** (`lib/image.ts`): grade 400, tela do produto 800, capa e `og:image` 1200, logo 200. URL de fora do Cloudinary volta intacta. Largura nova é transformação nova na cota — reuse uma das quatro.
```

Na tabela da seção "### Deploy (plano gratuito)", acrescente a linha:

```markdown
| Imagens | Cloudinary gratuito, conta `bird-corp`, pasta `menuclick/` | — |
```

- [ ] **Step 2: `docs/deploy.md`**

No passo 4 da seção do Render, troque "Preencher os três segredos (`sync: false`) quando o Render pedir: … e `SMTP_URL`." por "Preencher os quatro segredos (`sync: false`) quando o Render pedir: `DATABASE_URL` com a URL do **papel da aplicação** (`APP_DATABASE_URL` do `.env.neon`), `MIGRATION_DATABASE_URL` com a do **dono**, `SMTP_URL`, e `CLOUDINARY_URL` (painel do Cloudinary → "API Keys" → "API environment variable", no formato `cloudinary://<api_key>:<api_secret>@<cloud_name>`)." — mantendo o resto do parágrafo.

Como o serviço já existe, acrescente ao fim da mesma seção:

```markdown
**Variável nova num serviço que já existe (`CLOUDINARY_URL`):** o Blueprint só pergunta os segredos na criação. Cadastre a variável em "Environment" **antes** de publicar o código que a exige — sem ela a API não sobe —, e depois faça o "Manual sync" do Blueprint.
```

Run: `pnpm --filter @menuclick/api exec vitest run test/deploy-doc.test.ts`
Expected: PASS.

- [ ] **Step 3: Conferência real, na mão**

É o único passo que fala com o Cloudinary de verdade, e confirma duas coisas que a suíte não confirma: o algoritmo da assinatura (SHA-1) e o formato da `secure_url`.

1. `apps/api/.env` precisa ter a `CLOUDINARY_URL` de verdade (já está, da sessão de desenho) e `CORS_ORIGINS` com `http://localhost:3000`.
2. `pnpm dev`, abrir `http://localhost:5173`, entrar numa loja.
3. Em "Dados da loja", escolher um logo e uma capa, salvar. Esperado: a prévia vira a imagem salva depois do reload, e a URL em `GET /restaurants/:id` tem a forma `https://res.cloudinary.com/bird-corp/image/upload/v<n>/menuclick/<restaurantId>/logo.<ext>`.
4. Trocar o logo por outro arquivo e salvar. Esperado: a imagem nova aparece (a versão `v<n>` mudou) e a "Media Library" do Cloudinary continua com **um** arquivo `logo` naquela pasta.
5. Criar um produto novo com foto; editar e trocar; remover.
6. Abrir `http://localhost:3000/<slug>`: capa, logo e foto aparecem, e no inspetor de rede as URLs têm `f_auto,q_auto,c_limit,w_…`.

Se o passo 3 falhar com "Invalid Signature": a conta está configurada para SHA-256 (painel do Cloudinary → Settings → Security → "Signature algorithm"). **Pare e avise** — é decisão do dono trocar a configuração da conta ou o algoritmo em `signUpload`.

- [ ] **Step 4: Estado da spec e commit**

Na segunda linha de `docs/superpowers/specs/2026-10-08-upload-de-imagens-design.md`, troque o estado por: `**Estado:** implementado (branch \`feat/upload-de-imagens\`)`.

```bash
git add CLAUDE.md docs/deploy.md docs/superpowers/specs/2026-10-08-upload-de-imagens-design.md
git commit -m "docs: 📝 documenta o upload de imagens e a variável do cloudinary"
```

- [ ] **Step 5: Verificação final do monorepo**

Run: `pnpm lint && pnpm build && pnpm --filter @menuclick/api test && pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/menu test`
Expected: PASS em tudo.
