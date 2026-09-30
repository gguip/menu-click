import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { saveCart } from "../src/lib/cart.ts";
import { makeMenu } from "./fixtures.ts";

const found = { kind: "found", hash: "a7f3", label: "Mesa 7" } as const;

// I5 da revisão final: as telas eram só estado do React, e o voltar do
// celular saía do app — de uma aba aberta pelo QR, de volta para a câmera
describe("voltar do navegador", () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "scrollY");
    window.history.replaceState(null, "", "/");
  });

  it("do produto volta ao cardápio, na mesma altura", async () => {
    render(<MenuApp menu={makeMenu()} table={found} />);
    Object.defineProperty(window, "scrollY", { value: 640, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: /Calabresa/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Calabresa" })).toBeTruthy();

    window.history.back();
    expect(await screen.findByRole("searchbox", { name: "Buscar no cardápio" })).toBeTruthy();
    expect(scrollTo).toHaveBeenLastCalledWith(0, 640);
  });

  it("o voltar da tela usa o mesmo histórico: finalizar → carrinho → cardápio", async () => {
    saveCart("cart:cantina-do-porto:a7f3", [
      { key: "p-marg|note:", productId: "p-marg", name: "Margherita", unitPriceInCents: 5200, quantity: 1, options: [], note: null },
    ]);
    render(<MenuApp menu={makeMenu()} table={found} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    expect(screen.getByRole("heading", { name: "Quem está pedindo?" })).toBeTruthy();

    window.history.back();
    expect(await screen.findByRole("button", { name: "Finalizar pedido" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(await screen.findByRole("searchbox", { name: "Buscar no cardápio" })).toBeTruthy();
  });
});
