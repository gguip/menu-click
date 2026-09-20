import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoriesPage } from "../src/features/categories/CategoriesPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeCategory, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}/categories`;
const PRODUCTS = `/restaurants/${RESTAURANT_ID}/products`;

const pizzas = makeCategory({ id: "cat-1", name: "Pizzas", position: 0 });
const entradas = makeCategory({ id: "cat-2", name: "Entradas", position: 1 });
const bebidas = makeCategory({ id: "cat-3", name: "Bebidas", position: 2 });

function count(categoryId: string, total: number): MockHandler {
  return {
    method: "GET",
    path: PRODUCTS,
    query: { categoryId },
    body: { data: [], limit: 1, offset: 0, total },
  };
}

function setup(extra: MockHandler[] = []) {
  signIn();
  const api = mockApi([
    ...extra,
    { method: "GET", path: BASE, body: { data: [bebidas, pizzas, entradas], limit: 100, offset: 0, total: 3 } },
    count("cat-1", 3),
    count("cat-2", 1),
    count("cat-3", 0),
    ...panelHandlers(),
  ]);
  renderInPanel([{ path: "/secoes", element: <CategoriesPage /> }], "/secoes");
  return api;
}

function row(name: string) {
  return screen.getByRole("listitem", { name });
}

describe("CategoriesPage", () => {
  it("lista na ordem da refeição, com a contagem de produtos", async () => {
    setup();
    await screen.findByRole("listitem", { name: "Pizzas" });
    expect(screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Pizzas",
      "Entradas",
      "Bebidas",
    ]);
    expect(await within(row("Pizzas")).findByText("3 produtos")).toBeTruthy();
    expect(await within(row("Entradas")).findByText("1 produto")).toBeTruthy();
    expect(await within(row("Bebidas")).findByText("sem produtos")).toBeTruthy();
  });

  it("nome repetido, com outra caixa, nem chega à API", async () => {
    const api = setup();
    await screen.findByRole("listitem", { name: "Bebidas" });
    fireEvent.change(screen.getByLabelText("Nome da nova seção"), { target: { value: "bebidas" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(screen.getByText("Já existe uma seção com esse nome")).toBeTruthy();
    expect(
      screen.getByText('"Bebidas" já está cadastrada. O nome não diferencia maiúsculas: "bebidas" conta como repetido.'),
    ).toBeTruthy();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("adiciona seção nova", async () => {
    const api = setup([
      { method: "POST", path: BASE, status: 201, body: makeCategory({ id: "cat-4", name: "Sobremesas", position: 3 }) },
    ]);
    await screen.findByRole("listitem", { name: "Pizzas" });
    fireEvent.change(screen.getByLabelText("Nome da nova seção"), { target: { value: "Sobremesas" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Sobremesas" }),
    );
  });

  it("descer uma seção manda PATCH só para as duas que trocaram", async () => {
    const api = setup([
      { method: "PATCH", path: `${BASE}/cat-1`, body: { ...pizzas, position: 1 } },
      { method: "PATCH", path: `${BASE}/cat-2`, body: { ...entradas, position: 0 } },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Descer Pizzas" }));
    await waitFor(() => expect(api.calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    const patches = api.calls.filter((call) => call.method === "PATCH").map((call) => [call.path, call.body]);
    expect(patches).toEqual([
      [`${BASE}/cat-2`, { position: 0 }],
      [`${BASE}/cat-1`, { position: 1 }],
    ]);
  });

  it("reordenar não refaz as contagens de produtos (FIX 7)", async () => {
    const api = setup([
      { method: "PATCH", path: `${BASE}/cat-1`, body: { ...pizzas, position: 1 } },
      { method: "PATCH", path: `${BASE}/cat-2`, body: { ...entradas, position: 0 } },
    ]);
    await screen.findByRole("listitem", { name: "Pizzas" });
    await within(row("Pizzas")).findByText("3 produtos");
    const countCallsBefore = api.calls.filter((call) => call.path === PRODUCTS).length;

    fireEvent.click(screen.getByRole("button", { name: "Descer Pizzas" }));
    await waitFor(() => expect(api.calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    // espera o refresh da lista (onSettled) ir e voltar, para dar tempo de
    // qualquer refetch indevido de contagem acontecer também
    await waitFor(() =>
      expect(api.calls.filter((call) => call.path === BASE && call.method === "GET").length).toBeGreaterThan(1),
    );

    expect(api.calls.filter((call) => call.path === PRODUCTS).length).toBe(countCallsBefore);
  });

  it("remover diz o que NÃO acontece com os produtos", async () => {
    const api = setup([{ method: "DELETE", path: `${BASE}/cat-1`, status: 204 }]);
    fireEvent.click(within(await screen.findByRole("listitem", { name: "Pizzas" })).getByRole("button", { name: "Remover" }));
    const dialog = await screen.findByRole("dialog", { name: 'Remover a seção "Pizzas"?' });
    expect(
      within(dialog).getByText(
        'Os produtos dela não são apagados: passam para um grupo "Sem categoria" no fim do cardápio, e continuam à venda.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover seção" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
  });
});
