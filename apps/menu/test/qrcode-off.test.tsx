import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CheckoutScreen } from "../src/components/CheckoutScreen.tsx";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { saveCart } from "../src/lib/cart.ts";
import { makeMenu, makeRestaurant } from "./fixtures.ts";

const found = { kind: "found", hash: "a7f3", label: "Mesa 7" } as const;
const NOTICE = "Esta loja não está recebendo pedidos pela mesa agora. Chame o garçom.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function cart() {
  saveCart("cart:cantina-do-porto:a7f3", [
    { key: "p-marg|note:", productId: "p-marg", name: "Margherita", unitPriceInCents: 5200, quantity: 1, options: [], note: null },
  ]);
}

// I4 da revisão final: o app ignorava o interruptor de salão, e a pessoa
// montava o carrinho inteiro para levar 409 no "Enviar"
describe("salão desligado pela loja", () => {
  it("não deixa montar pedido, e diz por quê", () => {
    cart();
    render(<MenuApp menu={makeMenu({ isQrcode: false })} table={found} />);
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ver carrinho/ })).toBeNull();
  });

  it("vale também quando a loja desliga depois do cache", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ isOpen: true, acceptingOrders: true, isQrcode: false })));
    cart();
    render(<MenuApp menu={makeMenu()} table={found} />);
    expect(await screen.findByText(NOTICE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ver carrinho/ })).toBeNull();
  });

  it("sem forma de pagamento do salão, o finalizar diz o que fazer", () => {
    render(
      <CheckoutScreen
        restaurant={makeRestaurant({ paymentMethods: ["meal_voucher"] })}
        lines={[]}
        tableHash="a7f3"
        onBack={() => {}}
        onSent={() => {}}
      />,
    );
    expect(screen.getByText("Nenhuma forma de pagamento está disponível no salão agora. Chame o garçom.")).toBeTruthy();
  });
});
