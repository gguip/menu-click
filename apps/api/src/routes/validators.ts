import type { FastifyInstance } from "fastify";
import { createRequire } from "node:module";

/**
 * Os validadores de entrada das rotas.
 *
 * Existe porque a mesma dupla de instâncias do Ajv era declarada em cada plugin
 * de rota que valida corpo com número — e "o corpo é estrito, a URL é
 * coercitiva" é uma decisão só, que não deve ser reescrita a cada arquivo novo.
 *
 * ajv e ajv-formats são pacotes CJS com `export default`. Sob NodeNext +
 * verbatimModuleSyntax o import default não fica construível no type-check,
 * então carregamos via require (CJS no runtime) e tipamos pelo próprio módulo.
 */
const nodeRequire = createRequire(import.meta.url);
const Ajv = nodeRequire("ajv") as typeof import("ajv")["default"];
const addFormats = nodeRequire(
  "ajv-formats",
) as typeof import("ajv-formats")["default"];

/**
 * Validador de **corpo**.
 *
 * Diferença para o padrão do Fastify: `coerceTypes: false`, então uma string
 * como `"4890"` NÃO vira 4890 — é rejeitada com 400. É o que garante que
 * `priceInCents` (e qualquer outro inteiro) só aceite inteiro de verdade.
 * Mantemos `removeAdditional`, `useDefaults` e os formats (uri) para o
 * comportamento ficar igual ao resto.
 */
const strictAjv = new Ajv({
  coerceTypes: false,
  useDefaults: true,
  removeAdditional: true,
  allErrors: false,
});
addFormats(strictAjv);

/**
 * Validador de **params e querystring**.
 *
 * Aqui a coerção é obrigatória, não opcional: tudo que vem na URL chega como
 * string, então `?limit=20` seria rejeitado por `type: "integer"` se usássemos o
 * estrito. Mesmas opções do default do Fastify.
 */
const coercingAjv = new Ajv({
  coerceTypes: "array",
  useDefaults: true,
  removeAdditional: true,
  allErrors: false,
});
addFormats(coercingAjv);

/**
 * Liga os dois validadores num plugin de rota: estrito para o corpo (é lá que
 * `"4890"` não pode virar 4890), coercitivo para o resto, porque URL não tem
 * tipo.
 *
 * Chamar isto dentro do plugin (e não no `buildApp`) é o que mantém o
 * encapsulamento do Fastify fazendo o trabalho: o validador vale para as rotas
 * daquele plugin e não vaza para as irmãs (F2).
 */
export function installRouteValidators(app: FastifyInstance): void {
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === "body" ? strictAjv : coercingAjv).compile(schema as object),
  );
}
