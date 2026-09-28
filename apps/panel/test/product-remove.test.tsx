import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductFormPage } from "../src/features/products/ProductFormPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeProduct, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;
const PRODUCT = `${BASE}/products/prod-1`;

const reference: MockHandler[] = [
  { method: "GET", path: PRODUCT, body: makeProduct({ id: "prod-1", name: "Pizza Margherita" }) },
  { method: "GET", path: `${BASE}/categories`, body: { data: [], limit: 100, offset: 0, total: 0 } },
  { method: "GET", path: `${BASE}/option-groups`, body: { data: [], limit: 100, offset: 0, total: 0 } },
];

const routes = [
  { path: "/produtos/novo", element: <ProductFormPage /> },
  { path: "/produtos/:productId", element: <ProductFormPage /> },
  { path: "/produtos", element: <LocationProbe /> },
];

function setup(handlers: MockHandler[], path = "/produtos/prod-1") {
  signIn();
  const api = mockApi([...handlers, ...reference, ...panelHandlers()]);
  renderInPanel(routes, path);
  return api;
}

async function openConfirm() {
  fireEvent.click(await screen.findByRole("button", { name: "Remover produto" }));
  return screen.getByRole("dialog", { name: "Remover «Pizza Margherita»?" });
}

describe("remover produto", () => {
  it("confirma, manda o DELETE e volta para a lista", async () => {
    const api = setup([{ method: "DELETE", path: PRODUCT, status: 204 }]);
    const dialog = await openConfirm();
    expect(
      within(dialog).getByText(
        "O produto sai do cardápio e da lista. Pedidos que já o tiveram continuam com o nome e o preço de quando foram feitos.",
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("Para tirar do ar só por um tempo, zere o estoque: remover não tem volta pelo painel."),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover produto" }));

    expect((await screen.findByTestId("location")).textContent).toBe("/produtos");
    expect(api.calls.some((call) => call.method === "DELETE" && call.path === PRODUCT)).toBe(true);
  });

  it("'Voltar' não remove nada", async () => {
    const api = setup([]);
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("DELETE que falha fica na tela com a mensagem da API", async () => {
    setup([
      { method: "DELETE", path: PRODUCT, status: 404, body: { message: "Produto não encontrado" } },
    ]);
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover produto" }));
    expect(await screen.findByText("Produto não encontrado")).toBeTruthy();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("produto novo não tem o que remover", async () => {
    setup([], "/produtos/novo");
    await screen.findByLabelText("Nome");
    expect(screen.queryByRole("button", { name: "Remover produto" })).toBeNull();
  });
});
