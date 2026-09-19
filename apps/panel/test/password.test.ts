import { describe, expect, it } from "vitest";
import { checkPassword } from "../src/features/access/password.ts";

describe("checkPassword", () => {
  it("exige 8 caracteres", () => {
    expect(checkPassword("1234567")).toBe("A senha precisa de pelo menos 8 caracteres.");
    expect(checkPassword("12345678")).toBeNull();
  });

  it("conta BYTES no teto de 72, como o bcrypt da API", () => {
    // 40 "ç" são 40 caracteres e 80 bytes
    expect(checkPassword("ç".repeat(40))).toBe(
      "A senha passou do limite: use até 72 bytes (letras acentuadas contam em dobro).",
    );
    expect(checkPassword("a".repeat(72))).toBeNull();
  });
});
