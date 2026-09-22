import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { listOrdersByStatus } from "../src/api/orders.ts";
import type { Order } from "../src/api/types.ts";
import { OrderActionProvider, useOrderAction } from "../src/features/orders/orderActionFlow.tsx";
import { mockApi } from "./api-mock.ts";
import { makeOrder, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;
const ID = "a3f9c2d1-0000-4000-8000-000000000001";

function AcceptButton({ order }: { order: Order }) {
  const { request } = useOrderAction();
  return (
    <button type="button" onClick={() => request(order, "accept")}>
      aceitar
    </button>
  );
}

describe("listOrdersByStatus", () => {
  it("filtra só pelo status, sem período, do mais antigo para o mais novo", async () => {
    const api = mockApi([
      { method: "GET", path: LIST, body: { data: [makeOrder({ status: "preparing" })], limit: 100, offset: 0, total: 1 } },
    ]);
    const orders = await listOrdersByStatus(RESTAURANT_ID, "preparing");
    expect(orders).toHaveLength(1);
    expect(api.calls[0].query).toEqual({ status: "preparing", sort: "createdAt", order: "asc", limit: "100", offset: "0" });
  });
});

describe("OrderActionProvider em modo cozinha", () => {
  it("a confirmação de aceite não mostra nome nem total", async () => {
    signIn();
    mockApi(panelHandlers());
    const order = makeOrder({ id: ID, status: "pending", totalInCents: 10100 });
    renderInPanel(
      [
        {
          path: "/cozinha",
          element: (
            <OrderActionProvider restaurantId={RESTAURANT_ID} disabled={false} mode="kitchen">
              <AcceptButton order={order} />
            </OrderActionProvider>
          ),
        },
      ],
      "/cozinha",
    );
    fireEvent.click(await screen.findByRole("button", { name: "aceitar" }));
    const dialog = await screen.findByRole("dialog", { name: "Aceitar o pedido #A3F9?" });
    expect(within(dialog).getByText("Aceitar manda o pedido para a cozinha e baixa o estoque dos itens.")).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/R\$/);
    expect(dialog.textContent).not.toContain("Marcela");
  });

  it("no painel, a confirmação continua com nome e total", async () => {
    signIn();
    mockApi(panelHandlers());
    const order = makeOrder({ id: ID, status: "pending", totalInCents: 10100 });
    renderInPanel(
      [
        {
          path: "/pedidos",
          element: (
            <OrderActionProvider restaurantId={RESTAURANT_ID} disabled={false}>
              <AcceptButton order={order} />
            </OrderActionProvider>
          ),
        },
      ],
      "/pedidos",
    );
    fireEvent.click(await screen.findByRole("button", { name: "aceitar" }));
    const dialog = await screen.findByRole("dialog", { name: "Aceitar o pedido #A3F9?" });
    expect(dialog.textContent).toMatch(/R\$/);
  });

  it("estoque insuficiente na cozinha só oferece Fechar", async () => {
    signIn();
    mockApi([
      {
        method: "POST",
        path: `${LIST}/${ID}/confirm`,
        status: 409,
        body: { statusCode: 409, error: "Conflict", message: "Estoque insuficiente para Pizza Grande" },
      },
      ...panelHandlers(),
    ]);
    const order = makeOrder({ id: ID, status: "pending" });
    renderInPanel(
      [
        {
          path: "/cozinha",
          element: (
            <OrderActionProvider restaurantId={RESTAURANT_ID} disabled={false} mode="kitchen">
              <AcceptButton order={order} />
            </OrderActionProvider>
          ),
        },
      ],
      "/cozinha",
    );
    fireEvent.click(await screen.findByRole("button", { name: "aceitar" }));
    const confirm = await screen.findByRole("dialog", { name: "Aceitar o pedido #A3F9?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Aceitar pedido" }));
    const failure = await screen.findByRole("dialog", { name: "Estoque acabou ao aceitar" });
    expect(within(failure).getByRole("button", { name: "Fechar" })).toBeTruthy();
    expect(within(failure).queryByRole("button", { name: "Recusar pedido" })).toBeNull();
    expect(within(failure).queryByRole("button", { name: "Repor estoque" })).toBeNull();
  });
});
