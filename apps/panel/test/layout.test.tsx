import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSession } from "../src/api/session.ts";
import { RequireVerified } from "../src/auth/guards.tsx";
import { PanelLayout } from "../src/layout/PanelLayout.tsx";
import { mockApi } from "./api-mock.ts";
import { makeRestaurant, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  {
    element: <RequireVerified />,
    children: [
      {
        element: <PanelLayout />,
        children: [{ path: "/pedidos", handle: { title: "Pedidos" }, element: <p>conteúdo</p> }],
      },
    ],
  },
  { path: "/login", element: <LocationProbe /> },
];

const PAUSED_TEXT = "A loja não está recebendo pedidos novos. O horário cadastrado não foi alterado.";

describe("PanelLayout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra a loja, o título da tela e os números do dia", async () => {
    signIn();
    mockApi(
      panelHandlers({
        summary: { revenueOrderCount: 6, revenueInCents: 45000, averageTicketInCents: 7500 },
      }),
    );
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByText("Trattoria Bella")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pedidos" })).toBeTruthy();
    expect(await screen.findByText("R$ 450,00")).toBeTruthy();
    expect(screen.getByText("R$ 75,00")).toBeTruthy();
    expect(screen.getByText("Aceitos hoje")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    // o rail diz a GRADE ("Aberta · fecha …"); "Aceitando pedidos" é o interruptor do header
    expect(screen.getByText("Aberta · fecha 23:30")).toBeTruthy();
  });

  it("o interruptor pausa a loja e a faixa aparece", async () => {
    signIn();
    const api = mockApi([
      {
        method: "PATCH",
        path: `/restaurants/${RESTAURANT_ID}`,
        body: makeRestaurant({ acceptingOrders: false }),
      },
      ...panelHandlers(),
    ]);
    renderRoutes(routes, "/pedidos");
    const pause = await screen.findByRole("switch", { name: "Aceitando pedidos" });
    fireEvent.click(pause);
    expect(await screen.findByText(PAUSED_TEXT)).toBeTruthy();
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ acceptingOrders: false });
    expect(pause.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Pausada agora")).toBeTruthy();

    // despausa: o PATCH volta sem `openingStatus`, e o rail NÃO pode esquecê-lo
    api.add({
      method: "PATCH",
      path: `/restaurants/${RESTAURANT_ID}`,
      body: makeRestaurant({ acceptingOrders: true, openingStatus: undefined }),
    });
    fireEvent.click(pause);
    expect(await screen.findByText("Aberta · fecha 23:30")).toBeTruthy();
  });

  it("copia o link do cardápio que a API montou e avisa", async () => {
    signIn();
    const menuUrl = "https://menu.example/trattoria-bella";
    mockApi(panelHandlers({ restaurant: { menuUrl } }));
    const copied: string[] = [];
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: async (text: string) => void copied.push(text) },
    });
    renderRoutes(routes, "/pedidos");
    fireEvent.click(await screen.findByRole("button", { name: "Copiar link do cardápio" }));
    expect(await screen.findByText("Link copiado")).toBeTruthy();
    expect(copied).toEqual([menuUrl]);
  });

  it("sem permissão para copiar, mostra o link para a pessoa copiar à mão", async () => {
    signIn();
    const menuUrl = "https://menu.example/trattoria-bella";
    mockApi(panelHandlers({ restaurant: { menuUrl } }));
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: async () => Promise.reject(new Error("negado")) },
    });
    renderRoutes(routes, "/pedidos");
    fireEvent.click(await screen.findByRole("button", { name: "Copiar link do cardápio" }));
    expect(await screen.findByText("Não deu para copiar")).toBeTruthy();
    expect(screen.getByText(menuUrl)).toBeTruthy();
  });

  it("sem o link ainda, o botão não aparece", async () => {
    signIn();
    mockApi(panelHandlers());
    renderRoutes(routes, "/pedidos");
    await screen.findByRole("switch", { name: "Aceitando pedidos" });
    expect(screen.queryByRole("button", { name: "Copiar link do cardápio" })).toBeNull();
  });

  it("loja já pausada abre com a faixa", async () => {
    signIn();
    mockApi(panelHandlers({ restaurant: { acceptingOrders: false } }));
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByText(PAUSED_TEXT)).toBeTruthy();
  });

  it("o menu da conta troca o tema e sai", async () => {
    signIn();
    const api = mockApi([{ method: "POST", path: "/auth/logout", status: 204 }, ...panelHandlers()]);
    renderRoutes(routes, "/pedidos");
    fireEvent.click(await screen.findByRole("button", { name: "Menu da conta" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Tema escuro" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Sair" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/login");
    expect(readSession()).toBeNull();
    expect(api.calls.some((call) => call.path === "/auth/logout")).toBe(true);
  });

  it("o item Usuários existe para o dono e some para a equipe", async () => {
    signIn();
    mockApi(panelHandlers());
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByRole("link", { name: "Usuários" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Mesas e QR" })).not.toBeNull();
  });

  it("para a equipe, Usuários não aparece no rail", async () => {
    signIn();
    mockApi(panelHandlers({ me: { role: "staff" } }));
    renderRoutes(routes, "/pedidos");
    await screen.findByRole("link", { name: "Mesas e QR" });
    expect(screen.queryByRole("link", { name: "Usuários" })).toBeNull();
  });
});
