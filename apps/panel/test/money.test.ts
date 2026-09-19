import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, parseReaisToCents } from "../src/lib/money.ts";

const nbsp = " ";

describe("money", () => {
  it("formata centavos em reais, com espaço inseparável depois do R$", () => {
    expect(formatCents(10100)).toBe(`R$${nbsp}101,00`);
    expect(formatCents(0)).toBe(`R$${nbsp}0,00`);
    expect(formatCents(123456)).toBe(`R$${nbsp}1.234,56`);
  });

  it("converte o texto digitado em centavos sem passar por float", () => {
    expect(parseReaisToCents("45,90")).toBe(4590);
    expect(parseReaisToCents("45,9")).toBe(4590);
    expect(parseReaisToCents("45")).toBe(4500);
    expect(parseReaisToCents("1.234,56")).toBe(123456);
    expect(parseReaisToCents("R$ 0,29")).toBe(29);
    expect(parseReaisToCents(" 12,50 ")).toBe(1250);
  });

  it("recusa o que não é valor em reais", () => {
    for (const bad of ["", "abc", "12,345", "12.5", "-3", "1,2,3", "12.34,5"]) {
      expect(parseReaisToCents(bad)).toBeNull();
    }
  });

  it("devolve o valor para edição, sem separador de milhar", () => {
    expect(centsToInput(123456)).toBe("1234,56");
    expect(centsToInput(5)).toBe("0,05");
  });
});
