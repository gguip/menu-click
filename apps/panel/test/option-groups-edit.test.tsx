import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OptionGroupsPage } from "../src/features/optionGroups/OptionGroupsPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOptionGroup, makeProduct, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;
const routes = [{ path: "/grupos-de-opcoes", element: <OptionGroupsPage /> }];

function setup(extra: MockHandler[], groups = [makeOptionGroup({ id: "grp-1", name: "Sabores" })], products = [makeProduct()]) {
  signIn();
  const api = mockApi([
    ...extra,
    { method: "GET", path: `${BASE}/option-groups`, body: { data: groups, limit: 100, offset: 0, total: groups.length } },
    { method: "GET", path: `${BASE}/products`, body: { data: products, limit: 100, offset: 0, total: products.length } },
    ...panelHandlers(),
  ]);
  renderInPanel(routes, "/grupos-de-opcoes");
  return api;
}

function type(scope: ReturnType<typeof within> | typeof screen, label: string, value: string) {
  fireEvent.change(scope.getByLabelText(label), { target: { value } });
}

describe("OptionGroupsPage (grupos)", () => {
  it("cria um grupo", async () => {
    const api = setup([
      { method: "POST", path: `${BASE}/option-groups`, status: 201, body: makeOptionGroup({ id: "grp-9", name: "Borda" }) },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Novo grupo" }));
    type(screen, "Nome do grupo", "Borda");
    type(screen, "Mínimo", "0");
    type(screen, "Máximo", "1");
    fireEvent.change(screen.getByLabelText("Regra de preço"), { target: { value: "sum" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar grupo" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
        name: "Borda",
        minOptions: 0,
        maxOptions: 1,
        priceRule: "sum",
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Nome do grupo")).toBeNull());
  });

  it("mínimo maior que o máximo é barrado antes da chamada", async () => {
    const api = setup([]);
    fireEvent.click(await screen.findByRole("button", { name: "Novo grupo" }));
    type(screen, "Nome do grupo", "Sabores extras");
    type(screen, "Mínimo", "3");
    type(screen, "Máximo", "2");
    fireEvent.click(screen.getByRole("button", { name: "Criar grupo" }));
    expect(await screen.findByText("O grupo exige 3 opções mas aceita no máximo 2.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("nome repetido: o 409 da API aparece no próprio cartão", async () => {
    setup([
      {
        method: "PATCH",
        path: `${BASE}/option-groups/grp-1`,
        status: 409,
        body: { statusCode: 409, error: "Conflict", message: 'Já existe um grupo de opções chamado "Borda"' },
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Editar grupo Sabores" }));
    const card = within(screen.getByRole("region", { name: "Sabores" }));
    type(card, "Nome do grupo", "Borda");
    fireEvent.click(card.getByRole("button", { name: "Salvar grupo" }));
    expect(await card.findByText('Já existe um grupo de opções chamado "Borda"')).toBeTruthy();
  });

  it("a remoção diz quantos produtos perdem o grupo", async () => {
    const api = setup(
      [{ method: "DELETE", path: `${BASE}/option-groups/grp-1`, status: 204 }],
      [makeOptionGroup({ id: "grp-1", name: "Sabores" })],
      [
        makeProduct({ id: "p1", optionGroupIds: ["grp-1"] }),
        makeProduct({ id: "p2", optionGroupIds: ["grp-1"] }),
      ],
    );
    await screen.findByText("usado em 2 produtos");
    fireEvent.click(screen.getByRole("button", { name: "Remover grupo Sabores" }));
    expect(await screen.findByText("O grupo sai dos 2 produtos que o usam. Pedidos já feitos não mudam.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remover grupo" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
  });
});
