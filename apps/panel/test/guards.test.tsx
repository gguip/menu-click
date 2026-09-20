import { screen, waitFor } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { describe, expect, it } from "vitest";
import { readSession } from "../src/api/session.ts";
import { RedirectIfSession, RequireSession, RequireVerified } from "../src/auth/guards.tsx";
import { installSessionExpiry } from "../src/auth/sessionExpiry.ts";
import { mockApi } from "./api-mock.ts";
import { makeMe, signIn } from "./fixtures.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes: RouteObject[] = [
  { element: <RedirectIfSession />, children: [{ path: "/login", element: <h1>Login</h1> }] },
  {
    element: <RequireSession />,
    children: [
      { path: "/confirme-seu-email", element: <h1>Bloqueio</h1> },
      { element: <RequireVerified />, children: [{ path: "/pedidos", element: <h1>Pedidos</h1> }] },
    ],
  },
  { path: "*", element: <LocationProbe /> },
];

describe("guardas de rota", () => {
  it("sem sessão, o painel manda para o login", async () => {
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByRole("heading", { name: "Login" })).toBeTruthy();
  });

  it("loja não verificada vai para o bloqueio, sem tentar carregar pedidos", async () => {
    signIn();
    const api = mockApi([{ method: "GET", path: "/auth/me", body: makeMe({ emailVerified: false }) }]);
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByRole("heading", { name: "Bloqueio" })).toBeTruthy();
    expect(api.calls.map((call) => call.path)).toEqual(["/auth/me"]);
  });

  it("loja verificada entra", async () => {
    signIn();
    mockApi([{ method: "GET", path: "/auth/me", body: makeMe() }]);
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeTruthy();
  });

  it("com sessão, o login redireciona para o painel", async () => {
    signIn();
    mockApi([{ method: "GET", path: "/auth/me", body: makeMe() }]);
    renderRoutes(routes, "/login");
    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeTruthy();
  });

  it("401 em qualquer resposta limpa a sessão e leva ao login com o aviso", async () => {
    signIn();
    mockApi([{ method: "GET", path: "/auth/me", status: 401, body: { message: "Sessão inválida ou expirada" } }]);
    let uninstall = () => {};
    const { router } = renderRoutes(routes, "/pedidos", {
      beforeRender: ({ router: r, queryClient }) => {
        uninstall = installSessionExpiry(queryClient, r);
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?motivo=sessao-expirada");
    expect(readSession()).toBeNull();
    uninstall();
  });
});
