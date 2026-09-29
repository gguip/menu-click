import { describe, expect, it } from "vitest";
import { orderNumber } from "../src/lib/orderNumber.ts";

describe("número do pedido", () => {
  it("é o número da loja com #", () => {
    expect(orderNumber({ number: 1042 })).toBe("#1042");
  });
});
