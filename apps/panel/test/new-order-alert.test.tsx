import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireVerified } from "../src/auth/guards.tsx";
import { PanelLayout } from "../src/layout/PanelLayout.tsx";
import { playBeep, unlockAudio } from "../src/lib/audio.ts";
import { mockApi } from "./api-mock.ts";
import { makeOrder, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderRoutes } from "./render.tsx";

vi.mock("../src/lib/audio.ts", () => ({
  playBeep: vi.fn(async () => true),
  unlockAudio: vi.fn(async () => true),
  hasUserGesture: vi.fn(() => false),
}));

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
];

describe("aviso de pedido novo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("conta os novos no rail e no título da aba", async () => {
    signIn();
    mockApi(panelHandlers({ pending: [makeOrder(), makeOrder()] }));
    renderRoutes(routes, "/pedidos");
    const link = await screen.findByRole("link", { name: /Pedidos/ });
    await waitFor(() => expect(link.textContent).toContain("2"));
    expect(document.title).toBe("(2) Pedidos · MenuClick");
  });

  it("pedido que chega depois da primeira carga toca o bipe; a primeira carga não", async () => {
    signIn();
    const api = mockApi([
      {
        method: "GET",
        path: `/restaurants/${RESTAURANT_ID}/orders`,
        query: { status: "pending" },
        once: true,
        body: { data: [], limit: 100, offset: 0, total: 0 },
      },
      ...panelHandlers({ pending: [makeOrder()] }),
    ]);
    const { queryClient } = renderRoutes(routes, "/pedidos");
    await waitFor(() =>
      expect(api.calls.filter((call) => call.query.status === "pending")).toHaveLength(1),
    );
    expect(playBeep).not.toHaveBeenCalled();
    await queryClient.invalidateQueries({ queryKey: ["orders", "pending"] });
    await waitFor(() => expect(playBeep).toHaveBeenCalledOnce());
  });

  it("desmontar restaura o título da aba", async () => {
    signIn();
    mockApi(panelHandlers({ pending: [makeOrder(), makeOrder()] }));
    const view = renderRoutes(routes, "/pedidos");
    await waitFor(() => expect(document.title).toBe("(2) Pedidos · MenuClick"));
    view.unmount();
    expect(document.title).toBe("MenuClick · Painel da loja");
  });

  it("sem gesto na página, oferece ativar o som", async () => {
    signIn();
    mockApi(panelHandlers());
    renderRoutes(routes, "/pedidos");
    fireEvent.click(await screen.findByRole("button", { name: "Som desligado · Ativar som" }));
    await waitFor(() => expect(unlockAudio).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Som desligado · Ativar som" })).toBeNull());
  });
});
