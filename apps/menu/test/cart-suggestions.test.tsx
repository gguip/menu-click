import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type CartSuggestion, CartScreen } from "@/components/CartScreen.tsx";
import { MenuApp } from "@/components/MenuApp.tsx";
import { type CartLine, saveCart } from "@/lib/cart.ts";
import type { MenuSection } from "@/lib/types.ts";
import { makeMenu, SECTIONS } from "./fixtures.ts";

function line(productId: string, name: string): CartLine {
  return { key: productId, productId, name, unitPriceInCents: 4900, quantity: 1, options: [], note: null };
}

const agua: CartSuggestion = { id: "p-agua", name: "Água com gás", priceLabel: "R$ 6,00", needsChoice: false };
const meio: CartSuggestion = { id: "p-meio", name: "Meio a meio", priceLabel: "a partir de R$ 75,00", needsChoice: true };

function renderCart(suggestions: CartSuggestion[], onSuggestion = vi.fn()) {
  render(
    <CartScreen
      lines={[line("p-cala", "Calabresa")]}
      context="Mesa 7"
      suggestions={suggestions}
      onSuggestion={onSuggestion}
      onChange={() => {}}
      onBack={() => {}}
      onCheckout={() => {}}
    />,
  );
  return onSuggestion;
}

/** O cardápio de exemplo, com alguns produtos marcados como sugestão. */
function menuWith(suggested: string[]) {
  const sections: MenuSection[] = SECTIONS.map((section) => ({
    ...section,
    products: section.products.map((product) => ({ ...product, suggested: suggested.includes(product.id) })),
  }));
  return makeMenu({}, sections);
}

async function openCart(suggested: string[]) {
  saveCart("cart:cantina-do-porto:a7f3", [line("p-cala", "Calabresa")]);
  render(<MenuApp menu={menuWith(suggested)} table={{ kind: "found", hash: "a7f3", label: "Mesa 7" }} />);
  fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
  return screen.findByRole("region", { name: "Que tal adicionar?" });
}

describe("faixa de sugestões do carrinho", () => {
  it("sem sugestão, a faixa não aparece", () => {
    renderCart([]);
    expect(screen.queryByText("Que tal adicionar?")).toBeNull();
  });

  it("mostra nome e preço, com o botão certo para cada caso", () => {
    renderCart([agua, meio]);
    const strip = screen.getByRole("region", { name: "Que tal adicionar?" });
    within(strip).getByText("Água com gás");
    within(strip).getByText("R$ 6,00");
    within(strip).getByRole("button", { name: "Adicionar Água com gás" });
    within(strip).getByText("a partir de R$ 75,00");
    within(strip).getByRole("button", { name: "Escolher Meio a meio" });
  });

  it("o toque avisa qual produto foi escolhido", () => {
    const onSuggestion = renderCart([agua]);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar Água com gás" }));
    expect(onSuggestion).toHaveBeenCalledWith("p-agua");
  });

  it("a miniatura é pedida na largura da grade", () => {
    const photoUrl = "https://res.cloudinary.com/nuvem/image/upload/v1/menuclick/r1/products/p1.jpg";
    renderCart([{ ...agua, photoUrl }]);
    const strip = screen.getByRole("region", { name: "Que tal adicionar?" });
    expect(strip.querySelector("img")?.getAttribute("src")).toContain("c_limit,w_400/v1/");
  });
});

describe("sugestão no fluxo do pedido", () => {
  it("Adicionar põe o item no carrinho e o tira da faixa", async () => {
    const strip = await openCart(["p-agua", "p-marg"]);
    fireEvent.click(within(strip).getByRole("button", { name: "Adicionar Água com gás" }));

    // entrou como linha do carrinho
    screen.getByRole("button", { name: "Aumentar Água com gás" });
    // saiu da faixa; a outra sugestão continua
    const after = screen.getByRole("region", { name: "Que tal adicionar?" });
    expect(within(after).queryByText("Água com gás")).toBeNull();
    within(after).getByRole("button", { name: "Adicionar Margherita" });
  });

  it("a última sugestão adicionada leva a faixa embora", async () => {
    const strip = await openCart(["p-agua"]);
    fireEvent.click(within(strip).getByRole("button", { name: "Adicionar Água com gás" }));
    expect(screen.queryByText("Que tal adicionar?")).toBeNull();
  });

  it("não sugere o que já está no carrinho nem o que está indisponível", async () => {
    // Calabresa está no carrinho; Quatro queijos está indisponível
    const strip = await openCart(["p-cala", "p-quatro", "p-agua"]);
    expect(within(strip).getAllByRole("button")).toHaveLength(1);
    within(strip).getByRole("button", { name: "Adicionar Água com gás" });
  });

  it("Escolher abre a tela do produto, e o voltar cai no carrinho", async () => {
    const strip = await openCart(["p-meio"]);
    fireEvent.click(within(strip).getByRole("button", { name: "Escolher Meio a meio" }));

    // tela do produto, com o grupo obrigatório
    expect((await screen.findAllByText("Sabores")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Seu carrinho")).toBeNull();

    window.history.back();
    await screen.findByText("Seu carrinho");
    screen.getByRole("button", { name: "Escolher Meio a meio" });
  });

  it("adicionar pela tela do produto volta ao carrinho com o item", async () => {
    const strip = await openCart(["p-meio"]);
    fireEvent.click(within(strip).getByRole("button", { name: "Escolher Meio a meio" }));

    fireEvent.click(await screen.findByRole("checkbox", { name: /Margherita/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Calabresa/ }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ao carrinho" }));

    await screen.findByText("Seu carrinho");
    screen.getByRole("button", { name: "Aumentar Meio a meio" });
    // era a única sugestão, e agora está no carrinho
    expect(screen.queryByText("Que tal adicionar?")).toBeNull();
  });
});
