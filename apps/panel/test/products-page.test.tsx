import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Product } from "../src/api/types.ts";
import { ProductsPage } from "../src/features/products/ProductsPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeCategory, makeProduct, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const PRODUCTS = `/restaurants/${RESTAURANT_ID}/products`;
const CATEGORIES = `/restaurants/${RESTAURANT_ID}/categories`;

function productsHandler(products: Product[], total = products.length): MockHandler {
  return { method: "GET", path: PRODUCTS, body: { data: products, limit: 20, offset: 0, total } };
}

function categoriesHandler(count = 1): MockHandler {
  const data = count === 0 ? [] : [makeCategory({ id: "cat-1", name: "Pizzas" })];
  return { method: "GET", path: CATEGORIES, body: { data, limit: 100, offset: 0, total: data.length } };
}

function setup(handlers: MockHandler[], path = "/produtos") {
  signIn();
  const api = mockApi([...handlers, ...panelHandlers()]);
  renderInPanel([{ path: "/produtos", element: <ProductsPage /> }], path);
  return api;
}

describe("ProductsPage", () => {
  it("mostra seção, preço, estoque e status — o estoque só aqui", async () => {
    setup([
      productsHandler([
        makeProduct({ id: "p1", name: "Pizza Grande", categoryId: "cat-1", priceInCents: 4590, stock: 12 }),
        makeProduct({ id: "p2", name: "Coca 2L", categoryId: undefined, priceInCents: 1200, stock: 0 }),
      ]),
      categoriesHandler(),
    ]);
    expect(await screen.findByText("Pizza Grande")).toBeTruthy();
    expect(await screen.findByText("Pizzas", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("R$ 45,90")).toBeTruthy();
    expect(screen.getByText("esgotado")).toBeTruthy();
    expect(screen.getByText("Esgotado")).toBeTruthy();
    expect(screen.getByText("Disponível")).toBeTruthy();
    expect(screen.getByText("2 de 2 produtos")).toBeTruthy();
    expect(
      screen.getByText("O estoque aparece só aqui. No cardápio público o cliente vê apenas disponível ou esgotado."),
    ).toBeTruthy();
  });

  it("a busca vai para a API depois de uma pausa na digitação", async () => {
    const api = setup([productsHandler([makeProduct()]), categoriesHandler()]);
    fireEvent.change(await screen.findByLabelText("Buscar por nome"), { target: { value: "pizza" } });
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === PRODUCTS && call.query.search === "pizza")).toBe(true),
    );
  });

  it("o chip da seção filtra pela seção", async () => {
    const api = setup([productsHandler([makeProduct()]), categoriesHandler()]);
    fireEvent.click(await screen.findByRole("button", { name: "Pizzas" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === PRODUCTS && call.query.categoryId === "cat-1")).toBe(true),
    );
  });

  it("paginação pede a próxima página", async () => {
    const api = setup([productsHandler([makeProduct()], 45), categoriesHandler()]);
    fireEvent.click(await screen.findByRole("button", { name: "Próxima" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === PRODUCTS && call.query.offset === "20")).toBe(true),
    );
  });

  it("cardápio vazio empurra para criar a primeira seção", async () => {
    setup([productsHandler([]), categoriesHandler(0)]);
    expect(await screen.findByText("Seu cardápio está vazio")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Criar a primeira seção" }).getAttribute("href")).toBe("/secoes");
  });
});
