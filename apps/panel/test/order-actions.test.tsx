import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "../src/api/types.ts";
import { OrdersPage } from "../src/features/orders/OrdersPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOrder, makeOrderDetail, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;
const ID = "a3f9c2d1-0000-4000-8000-000000000001";

function listHandler(orders: Order[], once = false): MockHandler {
  return { method: "GET", path: LIST, once, body: { data: orders, limit: 100, offset: 0, total: orders.length } };
}

const noTables: MockHandler = {
  method: "GET",
  path: `/restaurants/${RESTAURANT_ID}/tables`,
  body: { data: [], limit: 100, offset: 0, total: 0 },
};

const routes = [
  { path: "/pedidos", element: <OrdersPage />, children: [{ path: ":orderId", element: <LocationProbe /> }] },
  { path: "/produtos", element: <LocationProbe /> },
];

function cardOf(code: string) {
  return screen.findByRole("article", { name: `Pedido ${code}` });
}

describe("ações do pedido", () => {
  it("recusar pedido novo pede confirmação com o texto de recusa, e não abre o detalhe", async () => {
    signIn();
    const api = mockApi([
      { method: "POST", path: `${LIST}/${ID}/cancel`, body: makeOrderDetail({ id: ID, status: "cancelled" }) },
      listHandler([makeOrder({ id: ID, status: "pending" })]),
      noTables,
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    fireEvent.click(within(await cardOf("#A3F9")).getByRole("button", { name: "Recusar" }));
    const dialog = await screen.findByRole("dialog", { name: "Recusar o pedido #A3F9?" });
    expect(
      within(dialog).getByText("O pedido sai da lista. O estoque não tinha sido baixado, então nada muda nele."),
    ).toBeTruthy();
    expect(screen.queryByTestId("location")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Recusar pedido" }));
    await waitFor(() => expect(api.calls.some((call) => call.path === `${LIST}/${ID}/cancel`)).toBe(true));
  });

  it("aceitar confirma e encadeia o preparo; se o preparo falhar, 'Começar preparo' é a rede", async () => {
    signIn();
    const api = mockApi([
      { method: "POST", path: `${LIST}/${ID}/confirm`, body: makeOrderDetail({ id: ID, status: "confirmed" }) },
      { method: "POST", path: `${LIST}/${ID}/start-preparing`, status: 409, body: { message: "Transição inválida" } },
      listHandler([makeOrder({ id: ID, status: "pending" })], true),
      listHandler([makeOrder({ id: ID, status: "confirmed" })]),
      noTables,
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    fireEvent.click(within(await cardOf("#A3F9")).getByRole("button", { name: "Aceitar" }));
    const dialog = await screen.findByRole("dialog", { name: "Aceitar o pedido #A3F9?" });
    expect(within(dialog).getByText("Não existe desconfirmar. Depois de aceito, só cabe cancelar.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Aceitar pedido" }));

    const preparo = screen.getByRole("region", { name: "Em preparo" });
    expect(await within(preparo).findByRole("button", { name: "Começar preparo" })).toBeTruthy();
    expect(api.calls.map((call) => call.path)).toEqual(
      expect.arrayContaining([`${LIST}/${ID}/confirm`, `${LIST}/${ID}/start-preparing`]),
    );
  });

  it("estoque acabou ao aceitar: explica e oferece repor ou recusar", async () => {
    signIn();
    mockApi([
      {
        method: "POST",
        path: `${LIST}/${ID}/confirm`,
        status: 409,
        body: { message: 'Estoque insuficiente de "Pizza Grande": 3 pedidos, 2 disponíveis' },
      },
      listHandler([makeOrder({ id: ID, status: "pending" })]),
      noTables,
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    fireEvent.click(within(await cardOf("#A3F9")).getByRole("button", { name: "Aceitar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Aceitar pedido" }));
    const dialog = await screen.findByRole("dialog", { name: "Estoque acabou ao aceitar" });
    expect(
      within(dialog).getByText(
        'Estoque insuficiente de "Pizza Grande": 3 pedidos, 2 disponíveis. O pedido não foi aceito e o estoque não mudou. Reponha o estoque ou recuse explicando ao cliente.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Recusar pedido" }));
    expect(await screen.findByRole("dialog", { name: "Recusar o pedido #A3F9?" })).toBeTruthy();
  });

  it("despachar não pede confirmação", async () => {
    signIn();
    const api = mockApi([
      { method: "POST", path: `${LIST}/${ID}/dispatch`, body: makeOrderDetail({ id: ID, status: "out_for_delivery" }) },
      listHandler([makeOrder({ id: ID, status: "preparing", type: "delivery" })]),
      noTables,
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    fireEvent.click(within(await cardOf("#A3F9")).getByRole("button", { name: "Despachar" }));
    await waitFor(() => expect(api.calls.some((call) => call.path === `${LIST}/${ID}/dispatch`)).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sem internet, as ações ficam travadas", async () => {
    signIn();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mockApi([listHandler([makeOrder({ id: ID, status: "pending" })]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");
    const accept = within(await cardOf("#A3F9")).getByRole("button", { name: "Aceitar" });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
  });
});
