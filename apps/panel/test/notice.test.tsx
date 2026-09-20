import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Notice } from "../src/ui/Notice.tsx";

describe("Notice", () => {
  it("tone danger é role=alert (FIX 8)", () => {
    render(<Notice tone="danger" title="Falhou">Deu ruim</Notice>);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("tone warn e accent são role=status", () => {
    const { rerender } = render(<Notice tone="warn" title="Atenção">aviso</Notice>);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(<Notice tone="accent" title="Info">info</Notice>);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
