import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OrderDetail } from "../src/api/types.ts";
import { OrderDrawer } from "../src/features/orders/OrderDrawer.tsx";
import { OrdersPage } from "../src/features/orders/OrdersPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOrderDetail, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;
const ID = "a3f9c2d1-0000-4000-8000-000000000001";

const routes = [
  { path: "/pedidos", element: <OrdersPage />, children: [{ path: ":orderId", element: <OrderDrawer /> }] },
];

function setup(detail: OrderDetail) {
  signIn();
  const handlers: MockHandler[] = [
    { method: "GET", path: `${LIST}/${detail.id}`, body: detail },
    { method: "GET", path: LIST, body: { data: [], limit: 100, offset: 0, total: 0 } },
    { method: "GET", path: `/restaurants/${RESTAURANT_ID}/tables`, body: { data: [], limit: 100, offset: 0, total: 0 } },
    ...panelHandlers(),
  ];
  mockApi(handlers);
  return renderInPanel(routes, `/pedidos/${detail.id}`);
}

async function drawer() {
  return screen.findByRole("dialog", { name: "Detalhe do pedido" });
}

describe("OrderDrawer", () => {
  it("a conta fecha: itens + frete = total", async () => {
    setup(makeOrderDetail({ id: ID, totalInCents: 10100, deliveryFeeInCents: 900, paymentMethod: "cash", changeForInCents: 15000 }));
    const view = await drawer();
    expect(await within(view).findByText("Pizza Grande")).toBeTruthy();
    expect(within(view).getByText("Sabores: Calabresa, Portuguesa")).toBeTruthy();
    expect(within(view).getByText("Borda: Catupiry")).toBeTruthy();
    expect(within(view).getByText("R$ 80,00")).toBeTruthy(); // 2 × R$ 40,00
    expect(within(view).getByText("R$ 92,00")).toBeTruthy(); // Itens
    expect(within(view).getByText("Frete")).toBeTruthy();
    expect(within(view).getByText("R$ 9,00")).toBeTruthy();
    expect(within(view).getByText("R$ 101,00")).toBeTruthy();
    expect(within(view).getByText("Dinheiro · troco para R$ 150,00")).toBeTruthy();
  });

  it("frete grátis e a combinar têm textos próprios", async () => {
    setup(makeOrderDetail({ id: ID, deliveryFeeInCents: 0 }));
    expect(await within(await drawer()).findByText("Entrega grátis")).toBeTruthy();
  });

  it("frete a combinar", async () => {
    setup(makeOrderDetail({ id: ID, deliveryFeeInCents: null }));
    expect(await within(await drawer()).findByText("Frete a combinar")).toBeTruthy();
  });

  it("salão sem mesa (adesivo antigo) diz isso", async () => {
    setup(makeOrderDetail({ id: ID, type: "dine_in", deliveryAddress: null, deliveryFeeInCents: null, table: null }));
    expect(await within(await drawer()).findByText(/Salão · sem mesa/)).toBeTruthy();
  });

  it("em preparo, cancelar devolve o estoque — e o texto diz isso", async () => {
    setup(makeOrderDetail({ id: ID, status: "preparing" }));
    fireEvent.click(await within(await drawer()).findByRole("button", { name: "Cancelar pedido" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancelar o pedido #A3F9?" });
    expect(within(dialog).getByRole("button", { name: "Cancelar e devolver estoque" })).toBeTruthy();
  });

  it("depois de pronto, cancelar NÃO devolve — e o texto avisa", async () => {
    setup(makeOrderDetail({ id: ID, status: "ready_for_pickup", type: "takeaway", deliveryAddress: null, deliveryFeeInCents: null }));
    fireEvent.click(await within(await drawer()).findByRole("button", { name: "Cancelar (sem devolver estoque)" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancelar sem devolver o estoque?" });
    expect(within(dialog).getByText("O estoque NÃO será devolvido.")).toBeTruthy();
  });

  it("pedido encerrado não oferece ação impossível", async () => {
    setup(makeOrderDetail({ id: ID, status: "completed", updatedAt: "2026-09-19T23:10:00.000Z" }));
    const view = await drawer();
    expect(await within(view).findByText("Pedido concluído às 20:10. Não há mais ação possível.")).toBeTruthy();
    expect(within(view).queryByRole("button", { name: /Cancelar|Concluir|Aceitar/ })).toBeNull();
  });

  it("andamento mostra a hora de chegada e '—' no futuro", async () => {
    setup(makeOrderDetail({ id: ID, status: "pending" }));
    const view = await drawer();
    // findBy: a hora sai no fuso da loja, que chega com o restaurante
    expect(await within(view).findByText("19:58")).toBeTruthy();
    expect(within(view).getAllByText("—")).toHaveLength(3);
  });

  it("fechar volta para o kanban", async () => {
    const { router } = setup(makeOrderDetail({ id: ID }));
    fireEvent.click(await within(await drawer()).findByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/pedidos"));
  });
});
