import { describe, expect, it } from "vitest";
import { contrastWithWhite, MIN_ACTION_CONTRAST } from "../src/domain/color.ts";

describe("contraste da cor de ação com o texto branco", () => {
  it("o azul do design passa folgado", () => {
    expect(contrastWithWhite("#1E5AE8")).toBeGreaterThan(MIN_ACTION_CONTRAST);
  });
  it("preto é o máximo (21:1) e branco o mínimo (1:1)", () => {
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 1);
    expect(contrastWithWhite("#FFFFFF")).toBeCloseTo(1, 5);
  });
  it("amarelo não passa", () => {
    expect(contrastWithWhite("#F5C518")).toBeLessThan(MIN_ACTION_CONTRAST);
  });
  it("#767676 é o cinza de fronteira do AA (≈ 4.54:1) e passa", () => {
    expect(contrastWithWhite("#767676")).toBeGreaterThanOrEqual(MIN_ACTION_CONTRAST);
    expect(contrastWithWhite("#777777")).toBeLessThan(MIN_ACTION_CONTRAST);
  });
});
