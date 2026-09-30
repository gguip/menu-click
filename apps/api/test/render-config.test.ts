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

  it("roda as migrations antes do servidor", () => {
    expect(yaml).toMatch(/startCommand: .*migrate:up.*&&.*start/);
  });

  it("segredos nunca têm valor no arquivo", () => {
    for (const key of ["DATABASE_URL", "SMTP_URL"]) {
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
