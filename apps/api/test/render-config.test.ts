// apps/api/test/render-config.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// o render.yaml é a configuração do deploy da API; estes são os pontos que,
// errados, derrubam produção em silêncio ou vazam segredo
describe("render.yaml", () => {
  const yaml = readFileSync(resolve(process.cwd(), "../../render.yaml"), "utf8");

  it("uma instância gratuita, com verificação de saúde e deploy só com o CI verde", () => {
    expect(yaml).toMatch(/plan: free/);
    expect(yaml).toMatch(/healthCheckPath: \/health/);
    expect(yaml).toMatch(/autoDeployTrigger: checksPass/);
    expect(yaml).toMatch(/region: virginia/);
  });

  // revisão final: subir pelo pnpm dependia dos atalhos do corepack existirem
  // na hora de rodar, e punha o pnpm entre o Render e o Node no SIGTERM (F26)
  // S14: o servidor conecta com o papel sem DELETE/TRUNCATE/DDL, e só as
  // migrations recebem a URL do dono. Trocar as duas daria ao processo da API
  // o poder de apagar o banco, sem nada avisar
  it("roda as migrations antes do servidor, direto pelo node, e só elas com o dono do banco", () => {
    expect(yaml).toMatch(
      /startCommand: cd apps\/api && DATABASE_URL="\$\{MIGRATION_DATABASE_URL:-\$DATABASE_URL\}" node src\/db\/migrate\.ts up && node src\/server\.ts/,
    );
  });

  // primeiro deploy: `corepack enable` quebrou com EROFS — ele troca o atalho
  // /usr/bin/pnpm, e no Render /usr é só leitura. `corepack pnpm` roda a versão
  // do packageManager sem criar atalho; sem o prompt, o download não espera
  // resposta num build sem terminal
  it("instala pelo corepack sem gravar atalho em /usr", () => {
    const build = yaml.split("\n").find((line) => line.trim().startsWith("buildCommand:"));
    expect(build).not.toMatch(/corepack enable/);
    expect(build).toMatch(
      /buildCommand: COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile --filter "@menuclick\/api\.\.\."/,
    );
  });

  it("segredos nunca têm valor no arquivo", () => {
    for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL", "SMTP_URL", "CLOUDINARY_URL"]) {
      // da chave até a próxima variável — o recorte não pode pegar o `value:` vizinho
      const start = yaml.indexOf(`key: ${key}`);
      const end = yaml.indexOf("- key:", start);
      const block = yaml.slice(start, end === -1 ? undefined : end);
      expect(block, key).toMatch(/sync: false/);
      expect(block, key).not.toMatch(/value:/);
    }
  });

  it("IP do cliente pelo header do Cloudflare, sem confiar no X-Forwarded-For", () => {
    expect(yaml).toMatch(/key: CLIENT_IP_HEADER\s+value: cf-connecting-ip/);
    expect(yaml).toMatch(/key: TRUST_PROXY\s+value: "false"/);
  });
});
