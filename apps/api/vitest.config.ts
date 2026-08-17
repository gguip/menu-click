import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { TEST_DB_NAME } from "./test/test-db.ts";

// Mesma credencial do dev (`DB_HOST`/`DB_USER`/`DB_PASSWORD`), lida direto do
// `.env` local — só o `DB_NAME` é sobrescrito abaixo para o banco de teste.
// Sem dotenv (o projeto não usa, ver `pool.ts`): API nativa do Node, mesmo
// espírito do `--env-file-if-exists` dos scripts em package.json.
try {
  process.loadEnvFile(fileURLToPath(new URL("./.env", import.meta.url)));
} catch {
  // .env não existe (ex.: CI) — segue só com os defaults de pool.ts
}

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    env: {
      DB_NAME: TEST_DB_NAME,
    },
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    // Todos os arquivos de teste batem no mesmo banco; rodar em paralelo
    // faria o `truncate` de um arquivo apagar dado que outro ainda está usando.
    fileParallelism: false,
  },
});
