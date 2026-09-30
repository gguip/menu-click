// apps/menu/test/link-flow.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { saveCart } from "../src/lib/cart.ts";
import { makeMenu } from "./fixtures.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function cartLink(unitPriceInCents = 5200) {
  saveCart("cart:cantina-do-porto:link", [
    { key: "p-marg|note:", productId: "p-marg", name: "Margherita", unitPriceInCents, quantity: 1, options: [], note: null },
  ]);
}

const RECEIPT = {
  id: "o1",
  number: 42,
  type: "takeaway",
  totalInCents: 5200,
  deliveryFeeInCents: null,
  table: null,
  items: [{ name: "Margherita", quantity: 1, unitPriceInCents: 5200, note: null }],
  trackingToken: "tk-1",
};

describe("pedido pelo link", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("o carrinho do link diz 'Itens', avisa o mínimo e não trava", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    cartLink();
    render(<MenuApp menu={makeMenu({ minimumOrderInCents: 6000 })} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    expect(screen.getByText("Itens")).toBeTruthy();
    expect(screen.getByText("Entrega ou retirada")).toBeTruthy();
    expect(screen.getByText("Para entrega, faltam R$ 8,00 para o pedido mínimo")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Finalizar pedido" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("sem entrega nem retirada: só navega, e diz por quê", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    cartLink();
    render(<MenuApp menu={makeMenu({ isDelivery: false, isTakeaway: false })} />);
    expect(await screen.findByText("Esta loja não está recebendo pedidos pelo app agora.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ver carrinho/ })).toBeNull();
  });

  it("retirada até o enviado, com o link de acompanhamento", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => (init?.method === "POST" ? json(RECEIPT, 201) : json({}, 404))),
    );
    cartLink();
    render(<MenuApp menu={makeMenu()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    fireEvent.click(screen.getByRole("button", { name: /Retirada/ }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11988887777" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));

    expect(await screen.findByRole("heading", { name: "Pedido enviado" })).toBeTruthy();
    expect(screen.getByText("A loja vai confirmar e avisar quando estiver pronto para retirada.")).toBeTruthy();
    expect(screen.getByText("Guarde este link — ele não se recupera")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Acompanhar pedido" }).getAttribute("href")).toBe(
      "/cantina-do-porto/pedido/o1?t=tk-1",
    );
    expect(localStorage.getItem("cart:cantina-do-porto:link")).toBeNull();
  });

  it("o voltar do celular volta um passo do finalizar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    cartLink();
    render(<MenuApp menu={makeMenu()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    fireEvent.click(screen.getByRole("button", { name: /Retirada/ }));
    expect(screen.getByText("Passo 2 de 3")).toBeTruthy();
    window.history.back();
    expect(await screen.findByText("Como você quer receber?")).toBeTruthy();
  });

  it("a loja desliga a entrega depois do cache: só a retirada aparece", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ isOpen: true, acceptingOrders: true, isQrcode: true, isDelivery: false, isTakeaway: true })),
    );
    cartLink();
    render(<MenuApp menu={makeMenu()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Ver carrinho/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    await waitFor(() => expect(screen.getByLabelText("Nome")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Entrega/ })).toBeNull();
  });
});
