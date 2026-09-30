import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O roteiro de deploy é executado à mão, uma vez, nas contas do dono — o que
 * ele diz errado vira produção quebrada sem nenhum teste de código por perto.
 * Estes são os pontos que a revisão final pegou.
 */
describe("roteiro de deploy", () => {
  const doc = readFileSync(resolve(process.cwd(), "../../docs/deploy.md"), "utf8");

  // o Render gratuito bloqueia a saída para as portas 25, 465 e 587 desde
  // set/2025: pela 465, nenhum e-mail sairia, em silêncio
  it("SMTP do Resend pela porta 2465", () => {
    expect(doc).toMatch(/smtp\.resend\.com:2465/);
    expect(doc).not.toMatch(/smtp\.resend\.com:(465|587)\b/);
  });

  // a senha do seed está no repositório público: a loja de demonstração não
  // pode ficar com ela nem por um minuto
  it("a demonstração troca a senha conhecida do seed junto com o e-mail", () => {
    expect(doc).toMatch(/password_hash = /);
    expect(doc).toMatch(/senha-de-exemplo-123/);
  });

  it("a verificação confere que o e-mail de recuperação chega", () => {
    expect(doc).toMatch(/e-mail de recuperação.*chega/i);
  });
});
