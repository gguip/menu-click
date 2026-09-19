import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // Porta fixa: os links de e-mail da API (PASSWORD_RESET_URL e
    // EMAIL_VERIFICATION_URL) apontam para :5173 por default. Se a porta
    // estiver ocupada, é melhor falhar do que subir noutra e o link cair no
    // vazio.
    port: 5173,
    strictPort: true,
    // Mesma origem no dev: o navegador fala com /api e o Vite repassa para a
    // API, sem precisar mexer em CORS_ORIGINS.
    proxy: {
      "/api": {
        target: "http://localhost:3333",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./test/setup.ts"],
  },
});
