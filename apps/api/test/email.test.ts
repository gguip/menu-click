import { describe, expect, it } from "vitest";
import { assertEmailDriverIsSafe } from "../src/email.ts";

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
});
