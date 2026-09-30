import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotFound from "../src/app/not-found.tsx";

describe("esqueleto do app", () => {
  it("renderiza a tela de link inexistente", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Este link não existe mais" })).toBeTruthy();
  });
});
