import { describe, expect, it } from "vitest";
import { orderCode } from "../src/lib/orderCode.ts";

describe("orderCode", () => {
  it("usa os quatro primeiros hex do UUID, em maiúsculas", () => {
    expect(orderCode("a3f9c2d1-0000-4000-8000-000000000001")).toBe("#A3F9");
  });
});
