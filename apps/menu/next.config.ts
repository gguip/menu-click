import type { NextConfig } from "next";

const config: NextConfig = {
  // o pacote de preço é TypeScript cru (a API o roda direto no Node)
  transpilePackages: ["@menuclick/pricing"],
  // o type-check é o `tsc --noEmit` do script de build — o mesmo TS do
  // monorepo; o do Next não roda duas vezes
  typescript: { ignoreBuildErrors: true },
};

export default config;
