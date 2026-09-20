import { describe, expect, it } from "vitest";
import { stockText, stockTone } from "../src/features/products/stock.ts";

describe("estoque na grade", () => {
  it("vermelho esgotado, âmbar até 5", () => {
    expect(stockTone(0)).toBe("danger");
    expect(stockTone(5)).toBe("warn");
    expect(stockTone(6)).toBe("normal");
    expect(stockText(0)).toBe("esgotado");
    expect(stockText(12)).toBe("12");
  });
});
