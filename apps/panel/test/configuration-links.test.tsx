import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductFormPage } from "../src/features/products/ProductFormPage.tsx";
import { ModalitiesPage } from "../src/features/settings/ModalitiesPage.tsx";
import { routes as realRoutes } from "../src/router.tsx";
import { mockApi } from "./api-mock.ts";
import { panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel, renderRoutes } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;

const routes = [
  { path: "/modalidades", element: <ModalitiesPage /> },
  { path: "/produtos/novo", element: <ProductFormPage /> },
  { path: "/entrega", element: <LocationProbe /> },
  { path: "/grupos-de-opcoes", element: <LocationProbe /> },
];

describe("ligações da parte 2b", () => {
  it("'Configurar entrega' no aviso de bairro leva a /entrega", async () => {
    signIn();
    mockApi([
      { method: "GET", path: `${BASE}/delivery-neighborhoods`, body: { neighborhoods: [] } },
      ...panelHandlers({ restaurant: { isDelivery: true, deliveryFeeMode: "neighborhood" } }),
    ]);
    renderInPanel(routes, "/modalidades");
    fireEvent.click(await screen.findByRole("link", { name: "Configurar entrega" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/entrega");
  });

  it("a ajuda do interruptor de Entrega aponta para a tela de Entrega", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/modalidades");
    const link = await screen.findByRole("link", { name: "Entrega" });
    expect(link.getAttribute("href")).toBe("/entrega");
  });

  it("o aviso de frete grátis também leva a /entrega", async () => {
    signIn();
    mockApi(
      panelHandlers({ restaurant: { isDelivery: true, deliveryFeeMode: "fixed", deliveryFixedFeeInCents: 0 } }),
    );
    renderInPanel(routes, "/modalidades");
    await screen.findByText("Entrega ligada com frete grátis");
    expect(screen.getByRole("link", { name: "Configurar entrega" }).getAttribute("href")).toBe("/entrega");
  });

  it("o formulário de produto leva a Grupos de opções", async () => {
    signIn();
    mockApi([
      { method: "GET", path: `${BASE}/categories`, body: { data: [], limit: 100, offset: 0, total: 0 } },
      { method: "GET", path: `${BASE}/option-groups`, body: { data: [], limit: 100, offset: 0, total: 0 } },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/produtos/novo");
    const link = await screen.findByRole("link", { name: "Grupos de opções" });
    expect(link.getAttribute("href")).toBe("/grupos-de-opcoes");
  });
});

describe("o roteador de verdade (src/router.tsx)", () => {
  // As outras suítes deste arquivo montam cada tela sob uma tabela de rotas
  // própria — um typo em `router.tsx` passaria batido. Este teste usa a
  // ÁRVORE REAL exportada pelo router (não uma cópia local dela) para provar
  // que /mesas e /usuarios de fato chegam em TablesPage e UsersPage.
  it("/mesas e /usuarios chegam nas telas certas", async () => {
    signIn();
    mockApi([
      { method: "GET", path: `${BASE}/tables`, body: { data: [], limit: 100, offset: 0, total: 0 } },
      ...panelHandlers(),
    ]);
    const mesas = renderRoutes(realRoutes, "/mesas");
    expect(await screen.findByRole("heading", { name: "Mesas e QR" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cadastrar mesa" })).not.toBeNull();
    mesas.unmount();

    mockApi([{ method: "GET", path: `${BASE}/users`, body: { data: [] } }, ...panelHandlers()]);
    renderRoutes(realRoutes, "/usuarios");
    expect(await screen.findByRole("heading", { name: "Usuários" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Convidar" })).not.toBeNull();
  });
});
