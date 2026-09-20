import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductFormPage } from "../src/features/products/ProductFormPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeCategory, makeOptionGroup, makeProduct, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;

const reference: MockHandler[] = [
  {
    method: "GET",
    path: `${BASE}/categories`,
    body: { data: [makeCategory({ id: "cat-1", name: "Pizzas" })], limit: 100, offset: 0, total: 1 },
  },
  {
    method: "GET",
    path: `${BASE}/option-groups`,
    body: {
      data: [
        makeOptionGroup({ id: "grp-1", name: "Sabores", priceRule: "highest", minOptions: 1, maxOptions: 2 }),
        makeOptionGroup({ id: "grp-2", name: "Borda", priceRule: "sum", minOptions: 0, maxOptions: 1 }),
      ],
      limit: 100,
      offset: 0,
      total: 2,
    },
  },
];

const routes = [
  { path: "/produtos/novo", element: <ProductFormPage /> },
  { path: "/produtos/:productId", element: <ProductFormPage /> },
  { path: "/produtos", element: <LocationProbe /> },
];

function setup(handlers: MockHandler[], path: string) {
  signIn();
  const api = mockApi([...handlers, ...reference, ...panelHandlers()]);
  renderInPanel(routes, path);
  return api;
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("ProductFormPage", () => {
  it("cria o produto e depois grava os grupos na ordem escolhida", async () => {
    const api = setup(
      [
        { method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) },
        { method: "PUT", path: `${BASE}/products/prod-9/option-groups`, body: { optionGroups: [] } },
      ],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    type("Estoque", "12");
    await screen.findByRole("option", { name: "Pizzas" });
    type("Seção", "cat-1");
    await screen.findByRole("option", { name: "Sabores" });
    type("Adicionar grupo já cadastrado", "grp-1");
    type("Adicionar grupo já cadastrado", "grp-2");
    expect(screen.getByText("Mais caro")).toBeTruthy();
    expect(screen.getByText("Margherita R$ 62 + Calabresa R$ 72 → R$ 72,00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Subir Borda" }));
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect((await screen.findByTestId("location")).textContent).toBe("/produtos");
    expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "Pizza Grande",
      priceInCents: 4590,
      stock: 12,
      categoryId: "cat-1",
    });
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({ optionGroupIds: ["grp-2", "grp-1"] });
  });

  it("editar sem mexer nos grupos não regrava os grupos; 'Sem seção' manda null", async () => {
    const api = setup(
      [
        {
          method: "GET",
          path: `${BASE}/products/prod-1`,
          body: makeProduct({ id: "prod-1", optionGroupIds: ["grp-1"] }),
        },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
      ],
      "/produtos/prod-1",
    );
    expect(((await screen.findByLabelText("Preço (R$)")) as HTMLInputElement).value).toBe("45,90");
    type("Seção", "");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await screen.findByTestId("location");
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      categoryId: null,
      priceInCents: 4590,
    });
    expect(api.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("grupos que falham não escondem que o produto foi salvo", async () => {
    setup(
      [
        {
          method: "GET",
          path: `${BASE}/products/prod-1`,
          body: makeProduct({ id: "prod-1", optionGroupIds: ["grp-1"] }),
        },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
        {
          method: "PUT",
          path: `${BASE}/products/prod-1/option-groups`,
          status: 400,
          body: { message: "Grupo de opções inexistente" },
        },
      ],
      "/produtos/prod-1",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remover Sabores" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(
      await screen.findByText("O produto foi salvo, mas os grupos de opções não: Grupo de opções inexistente"),
    ).toBeTruthy();
  });

  it("produto recém-criado troca para edição quando os grupos falham, e salvar de novo não duplica", async () => {
    const api = setup(
      [
        { method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) },
        {
          method: "PUT",
          path: `${BASE}/products/prod-9/option-groups`,
          status: 400,
          body: { message: "Grupo de opções inexistente" },
        },
        { method: "GET", path: `${BASE}/products/prod-9`, body: makeProduct({ id: "prod-9" }) },
        { method: "PATCH", path: `${BASE}/products/prod-9`, body: makeProduct({ id: "prod-9" }) },
      ],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    type("Estoque", "12");
    await screen.findByRole("option", { name: "Sabores" });
    type("Adicionar grupo já cadastrado", "grp-1");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect(
      await screen.findByText("O produto foi salvo, mas os grupos de opções não: Grupo de opções inexistente"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/produtos");
    expect(api.calls.some((call) => call.method === "PATCH" && call.path === `${BASE}/products/prod-9`)).toBe(
      true,
    );
    expect(api.calls.filter((call) => call.method === "POST" && call.path === `${BASE}/products`)).toHaveLength(1);
  });

  it("preço inválido não chega à API", async () => {
    const api = setup([], "/produtos/novo");
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza");
    type("Preço (R$)", "45,999");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(screen.getByText("Informe o preço no formato 12,50.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });
});
