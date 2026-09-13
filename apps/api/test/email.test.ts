import { describe, expect, it } from "vitest";
import { assertEmailDriverIsSafe, configureEmail, sendEmail } from "../src/email.ts";

describe("porta de e-mail", () => {
  it("recusa o driver de console em produção", () => {
    // o link que ele escreve no log É o token: rodar assim em produção
    // derramaria credencial de troca de senha em log de aplicação (S13)
    expect(() => assertEmailDriverIsSafe("console", "production")).toThrow();
  });

  it("aceita o driver de console fora de produção", () => {
    expect(() => assertEmailDriverIsSafe("console", "development")).not.toThrow();
    expect(() => assertEmailDriverIsSafe("console", undefined)).not.toThrow();
  });

  it("aceita smtp em qualquer ambiente", () => {
    expect(() => assertEmailDriverIsSafe("smtp", "production")).not.toThrow();
  });

  it("recusa driver desconhecido", () => {
    expect(() => assertEmailDriverIsSafe("pombo-correio", "development")).toThrow();
  });

  /**
   * 🚨 Uma `SMTP_URL` malformada não pode produzir erro com a senha dentro.
   *
   * Medido no `nodemailer`: três formas de URL inválida vazam por caminhos
   * DIFERENTES — `smtp://u:senha@h:abc` vaza em `err.input`, enquanto
   * `u:senha@host:587` e `://u:senha@h` vazam em `err.message` e `err.stack`.
   * Redigir uma chave no `logger.redact` não resolveria, porque são três; e o
   * Node ainda imprime a URL inteira no stderr como DeprecationWarning, fora
   * de qualquer logger nosso.
   *
   * Por isso a defesa é validar antes e **nunca produzir o erro original**.
   */
  it("erro de SMTP_URL inválida não carrega a senha", async () => {
    const anterior = { ...process.env };
    process.env.EMAIL_DRIVER = "smtp";
    process.env.EMAIL_FROM = "nao-responda@exemplo.com";
    process.env.SMTP_URL = "smtp://usuario:SENHA_SECRETA@host:porta-invalida";

    try {
      await expect(
        sendEmail({ to: "a@b.com", subject: "s", text: "t" }),
      ).rejects.toThrow(/SMTP_URL/);

      // e a senha não aparece em NENHUMA parte do erro
      const erro = await sendEmail({ to: "a@b.com", subject: "s", text: "t" })
        .then(() => null)
        .catch((e: unknown) => e as Error);
      const tudo = [
        erro?.message,
        erro?.stack,
        JSON.stringify(erro, Object.getOwnPropertyNames(erro ?? {})),
      ].join(" ");
      expect(tudo).not.toContain("SENHA_SECRETA");
    } finally {
      process.env = anterior;
    }
  });

  /**
   * Subir com `smtp` e sem as variáveis é falha de boot, não surpresa depois.
   *
   * `PASSWORD_RESET_URL` é a que mais importa aqui: sem ela o link cai num
   * default de desenvolvimento e a loja recebe um e-mail apontando para
   * `localhost` — quebrado, e **sem erro nenhum**. Ninguém descobre até o dono
   * reclamar que o link não abre, e a feature inteira existe para dar caminho
   * de volta a quem perdeu o acesso.
   */
  it("recusa subir com smtp e variável faltando", () => {
    const anterior = { ...process.env };
    try {
      process.env.SMTP_URL = "smtp://u:p@host:587";
      process.env.EMAIL_FROM = "nao-responda@exemplo.com";
      delete process.env.PASSWORD_RESET_URL;

      expect(() => configureEmail("smtp", "production", () => {})).toThrow(
        /PASSWORD_RESET_URL/,
      );

      process.env.PASSWORD_RESET_URL = "https://painel.exemplo.com/recuperar";
      expect(() =>
        configureEmail("smtp", "production", () => {}),
      ).not.toThrow();
    } finally {
      process.env = anterior;
    }
  });

  it("recusa subir com SMTP_URL malformada, não só no primeiro envio", () => {
    const anterior = { ...process.env };
    try {
      process.env.EMAIL_FROM = "nao-responda@exemplo.com";
      process.env.PASSWORD_RESET_URL = "https://painel.exemplo.com/recuperar";
      process.env.SMTP_URL = "smtp://usuario:SENHA_SECRETA@host:porta-invalida";

      // sem esta guarda o processo sobe e só quebra no primeiro envio — ou
      // seja, quando alguém já está trancado para fora e precisa dele
      let erro: Error | undefined;
      try {
        configureEmail("smtp", "production", () => {});
      } catch (e) {
        erro = e as Error;
      }
      expect(erro?.message).toMatch(/SMTP_URL/);
      // e a mensagem não carrega o valor (S13)
      expect(`${erro?.message} ${erro?.stack}`).not.toContain("SENHA_SECRETA");
    } finally {
      process.env = anterior;
    }
  });
});
