import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Order } from "../src/api/types.ts";
import { KitchenPage } from "../src/features/kitchen/KitchenPage.tsx";
import { OrdersPage } from "../src/features/orders/OrdersPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOrder, makeOrderDetail, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;
const NEW_ID = "a3f9c2d1-0000-4000-8000-000000000001";
const DOING_ID = "b7e10000-0000-4000-8000-000000000002";

function page(orders: Order[]) {
  return { data: orders, limit: 100, offset: 0, total: orders.length };
}

function kitchenHandlers(
  pending: Order[],
  confirmed: Order[],
  preparing: Order[],
): MockHandler[] {
  const details = [...pending, ...confirmed, ...preparing].map(
    (order): MockHandler => ({
      method: "GET",
      path: `${LIST}/${order.id}`,
      body: makeOrderDetail({ id: order.id, type: order.type, status: order.status }),
    }),
  );
  return [
    ...details,
    { method: "GET", path: LIST, query: { status: "confirmed" }, body: page(confirmed) },
    { method: "GET", path: LIST, query: { status: "preparing" }, body: page(preparing) },
    ...panelHandlers({ pending }),
  ];
}

const routes = [
  { path: "/cozinha", element: <KitchenPage /> },
  { path: "/pedidos", element: <LocationProbe /> },
];

describe("KitchenPage", () => {
  it("pendente em 'Entraram agora', em preparo em 'Fazendo'", async () => {
    signIn();
    mockApi(
      kitchenHandlers(
        [makeOrder({ id: NEW_ID, status: "pending" })],
        [],
        [makeOrder({ id: DOING_ID, status: "preparing", type: "delivery" })],
      ),
    );
    renderInPanel(routes, "/cozinha");
    const novos = await screen.findByRole("region", { name: "Entraram agora" });
    const fazendo = screen.getByRole("region", { name: "Fazendo" });
    expect(await within(novos).findByText("#A3F9")).toBeTruthy();
    expect(await within(fazendo).findByText("#B7E1")).toBeTruthy();
  });

  it("nenhum dinheiro na tela", async () => {
    signIn();
    mockApi(
      kitchenHandlers(
        [makeOrder({ id: NEW_ID, status: "pending" })],
        [],
        [makeOrder({ id: DOING_ID, status: "preparing" })],
      ),
    );
    renderInPanel(routes, "/cozinha");
    // os itens chegam do detalhe: espere-os, e aí nada em reais pode ter vindo junto
    expect((await screen.findAllByText("Pizza Grande")).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/R\$/);
    expect(document.body.textContent).not.toContain("Marcela");
  });

  it("'Aceitar e começar' confirma e manda confirm + start-preparing", async () => {
    signIn();
    const api = mockApi([
      { method: "POST", path: `${LIST}/${NEW_ID}/confirm`, body: makeOrderDetail({ id: NEW_ID, status: "confirmed" }) },
      {
        method: "POST",
        path: `${LIST}/${NEW_ID}/start-preparing`,
        body: makeOrderDetail({ id: NEW_ID, status: "preparing" }),
      },
      ...kitchenHandlers([makeOrder({ id: NEW_ID, status: "pending" })], [], []),
    ]);
    renderInPanel(routes, "/cozinha");
    fireEvent.click(await screen.findByRole("button", { name: "Aceitar e começar" }));
    const dialog = await screen.findByRole("dialog", { name: "Aceitar o pedido #A3F9?" });
    expect(dialog.textContent).not.toMatch(/R\$/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Aceitar pedido" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === `${LIST}/${NEW_ID}/start-preparing`)).toBe(true),
    );
    const confirmIndex = api.calls.findIndex((call) => call.path === `${LIST}/${NEW_ID}/confirm`);
    const startIndex = api.calls.findIndex((call) => call.path === `${LIST}/${NEW_ID}/start-preparing`);
    expect(confirmIndex).toBeLessThan(startIndex);
  });

  it("'Pronto — despachar' manda dispatch num pedido de entrega", async () => {
    signIn();
    const api = mockApi([
      {
        method: "POST",
        path: `${LIST}/${DOING_ID}/dispatch`,
        body: makeOrderDetail({ id: DOING_ID, status: "out_for_delivery" }),
      },
      ...kitchenHandlers([], [], [makeOrder({ id: DOING_ID, status: "preparing", type: "delivery" })]),
    ]);
    renderInPanel(routes, "/cozinha");
    fireEvent.click(await screen.findByRole("button", { name: "Pronto — despachar" }));
    await waitFor(() => expect(api.calls.some((call) => call.path === `${LIST}/${DOING_ID}/dispatch`)).toBe(true));
  });

  it("o detalhe de cada pedido é buscado uma vez só, mesmo com as listas atualizando", async () => {
    signIn();
    const api = mockApi(
      kitchenHandlers([], [], [makeOrder({ id: DOING_ID, status: "preparing" })]),
    );
    const { queryClient } = renderInPanel(routes, "/cozinha");
    expect((await screen.findAllByText("Pizza Grande")).length).toBeGreaterThan(0);
    await queryClient.invalidateQueries({ queryKey: ["orders"] });
    await waitFor(() =>
      expect(api.calls.filter((call) => call.query.status === "preparing").length).toBeGreaterThan(1),
    );
    expect(api.calls.filter((call) => call.path === `${LIST}/${DOING_ID}`)).toHaveLength(1);
  });

  it("itens com erro no detalhe deixam 'Tentar de novo', que traz os itens", async () => {
    signIn();
    const order = makeOrder({ id: DOING_ID, status: "preparing" });
    mockApi([
      { method: "GET", path: `${LIST}/${DOING_ID}`, status: 500, once: true },
      ...kitchenHandlers([], [], [order]),
    ]);
    renderInPanel(routes, "/cozinha");
    expect(await screen.findByText("Não foi possível carregar os itens.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Pizza Grande")).toBeTruthy();
  });

  it("'Fazendo' mostra o que chegou mesmo quando uma das duas listas falha", async () => {
    signIn();
    const order = makeOrder({ id: DOING_ID, status: "confirmed" });
    mockApi([
      {
        method: "GET",
        path: `${LIST}/${DOING_ID}`,
        body: makeOrderDetail({ id: DOING_ID, status: "confirmed" }),
      },
      { method: "GET", path: LIST, query: { status: "confirmed" }, body: page([order]) },
      { method: "GET", path: LIST, query: { status: "preparing" }, status: 500 },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/cozinha");
    const fazendo = await screen.findByRole("region", { name: "Fazendo" });
    expect(await within(fazendo).findByText("#B7E1")).toBeTruthy();
    expect(within(fazendo).getByText(/Parte da lista não carregou/)).toBeTruthy();
  });

  it("'Entraram agora' mostra o erro dos pendentes, não 'Carregando pedidos…'", async () => {
    signIn();
    mockApi([
      { method: "GET", path: LIST, query: { status: "pending" }, status: 500 },
      ...kitchenHandlers([], [], []),
    ]);
    renderInPanel(routes, "/cozinha");
    const novos = await screen.findByRole("region", { name: "Entraram agora" });
    expect(await within(novos).findByText("Algo deu errado. Tente de novo.")).toBeTruthy();
    expect(within(novos).queryByText("Carregando pedidos…")).toBeNull();
  });

  it("colunas vazias dizem o texto do protótipo", async () => {
    signIn();
    mockApi(kitchenHandlers([], [], []));
    renderInPanel(routes, "/cozinha");
    expect(await screen.findByText("Nada novo.")).toBeTruthy();
    expect(await screen.findByText("Bancada limpa.")).toBeTruthy();
  });

  it("'Sair do modo cozinha' volta a /pedidos", async () => {
    signIn();
    mockApi(kitchenHandlers([], [], []));
    renderInPanel(routes, "/cozinha");
    fireEvent.click(await screen.findByRole("link", { name: "Sair do modo cozinha" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/pedidos");
  });

  it("o botão 'Modo cozinha' em Pedidos leva a /cozinha", async () => {
    signIn();
    mockApi([
      { method: "GET", path: `/restaurants/${RESTAURANT_ID}/tables`, body: page([]) },
      ...panelHandlers(),
      { method: "GET", path: LIST, body: page([]) },
    ]);
    renderInPanel(
      [
        { path: "/pedidos", element: <OrdersPage /> },
        { path: "/cozinha", element: <LocationProbe /> },
      ],
      "/pedidos",
    );
    fireEvent.click(await screen.findByRole("link", { name: "Modo cozinha" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/cozinha");
  });
});
