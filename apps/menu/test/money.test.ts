import { describe, expect, it } from "vitest";
import { formatCents } from "../src/lib/money.ts";

describe("dinheiro", () => {
  it("R$ com vírgula e milhar com ponto", () => {
    expect(formatCents(5200)).toBe("R$ 52,00");
    expect(formatCents(123456)).toBe("R$ 1.234,56");
    expect(formatCents(0)).toBe("R$ 0,00");
  });
});
