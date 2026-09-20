import { DEFAULT_THEME } from "@mantine/core";
import { describe, expect, it } from "vitest";
import { cssVariablesResolver } from "../src/theme/theme.ts";
import { lightTokens } from "../src/theme/tokens.ts";

describe("tema", () => {
  const resolved = cssVariablesResolver(DEFAULT_THEME);

  it("injeta os tokens do handoff nos dois temas", () => {
    expect(resolved.light["--mc-bg"]).toBe("#F5F4F1");
    expect(resolved.dark["--mc-bg"]).toBe("#15140F");
    expect(resolved.light["--mc-accent"]).toBe("#4A6B3A");
    expect(resolved.dark["--mc-accent"]).toBe("#93B375");
  });

  it("todo token claro tem par escuro", () => {
    for (const name of Object.keys(lightTokens)) {
      expect(resolved.dark[`--mc-${name}`]).toBeTruthy();
    }
  });

  it("componentes do Mantine usam a superfície, não o fundo da janela", () => {
    expect(resolved.light["--mantine-color-body"]).toBe("#FFFFFF");
    expect(resolved.light["--mantine-color-default-border"]).toBe("#E4E1DB");
  });
});
