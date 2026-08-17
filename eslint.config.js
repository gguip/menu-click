import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Config única pra todo o workspace. O `typescript-eslint` daqui roda em
 * cima do `typescript` 6.x deste `package.json` da raiz — de propósito
 * separado do `typescript@^7` do `apps/api` (usado só pra build/typecheck):
 * typescript-eslint ainda não suporta TS 7 (erro fatal ao carregar), e cada
 * `package.json` do pnpm resolve sua própria peer dependency `typescript`
 * de forma isolada, então essa separação é o que faz o lint funcionar sem
 * baixar a versão real do TypeScript do projeto.
 */
export default tseslint.config(
  { ignores: ["**/node_modules", "**/dist", "**/build", "**/.turbo", "**/migrations"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      // TS já cobre isso via type-checking; no-undef do eslint puro não
      // conhece globals do Node (`process`, `console`, ...) e gera falso
      // positivo — recomendação oficial do typescript-eslint.
      "no-undef": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        // `disallowTypeAnnotations: false` permite `typeof import("pkg")`
        // inline — usado no interop de pacotes CJS (`ajv`, `ajv-formats`)
        // carregados via `createRequire`, onde um `import type` no topo do
        // arquivo não é equivalente (ver comentário em routes/restaurants.ts).
        { prefer: "type-imports", disallowTypeAnnotations: false },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
