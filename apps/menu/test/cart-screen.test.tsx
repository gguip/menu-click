import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CartScreen } from "@/components/CartScreen.tsx";
import { MenuApp } from "@/components/MenuApp.tsx";
import { type CartLine, saveCart } from "@/lib/cart.ts";
import { makeMenu } from "./fixtures.ts";

const PHOTO = "https://res.cloudinary.com/nuvem/image/upload/v1/menuclick/r1/products/p1.jpg";

function line(productId: string, name: string): CartLine {
  return { key: productId, productId, name, unitPriceInCents: 3190, quantity: 1, options: [], note: null };
}

function renderCart(lines: CartLine[], photos?: Record<string, string>) {
  const view = render(
    <CartScreen lines={lines} context="Mesa 7" photos={photos} onChange={() => {}} onBack={() => {}} onCheckout={() => {}} />,
  );
  const rows = [...view.container.querySelectorAll("li")];
  return { rows, images: () => [...view.container.querySelectorAll("img")] };
}

describe("foto do produto no carrinho", () => {
  it("mostra a miniatura do produto, pedida na largura da grade", () => {
    const { images } = renderCart([line("p1", "Tiramisù")], { p1: PHOTO });
    expect(images().map((image) => image.getAttribute("src"))).toEqual([
      "https://res.cloudinary.com/nuvem/image/upload/f_auto,q_auto,c_limit,w_400/v1/menuclick/r1/products/p1.jpg",
    ]);
    // o nome já está escrito ao lado
    expect(images()[0].getAttribute("alt")).toBe("");
  });

  it("com alguma foto no carrinho, a linha sem foto guarda o lugar dela", () => {
    const { rows } = renderCart([line("p1", "Tiramisù"), line("p2", "Água")], { p1: PHOTO });
    expect(rows[0].querySelector("img")).not.toBeNull();
    expect(rows[1].querySelector("img")).toBeNull();
    expect(rows[1].querySelector('[data-slot="photo"]')).not.toBeNull();
  });

  it("sem nenhuma foto no carrinho, a tela fica como era: sem miniatura nem lugar vazio", () => {
    const semMapa = renderCart([line("p1", "Tiramisù")]);
    expect(semMapa.rows[0].querySelector('[data-slot="photo"]')).toBeNull();

    // a loja tem foto em OUTRO produto, que não está no carrinho
    const outroProduto = renderCart([line("p2", "Água")], { p1: PHOTO });
    expect(outroProduto.rows[0].querySelector('[data-slot="photo"]')).toBeNull();
    expect(screen.getAllByText("Água").length).toBeGreaterThan(0);
  });

  it("a foto vem do cardápio de agora, não do carrinho guardado", async () => {
    const menu = makeMenu();
    const product = menu.sections[0].products.find((p) => p.name === "Margherita")!;
    product.photoUrl = PHOTO;
    saveCart("cart:cantina-do-porto:a7f3", [line(product.id, "Margherita")]);
    const view = render(<MenuApp menu={menu} table={{ kind: "found", hash: "a7f3", label: "Mesa 7" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    expect(view.container.querySelector("li img")?.getAttribute("src")).toContain("w_400/v1/menuclick/r1/products/p1.jpg");
  });
});
