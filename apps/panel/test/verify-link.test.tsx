import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerifyEmailLinkPage } from "../src/features/access/VerifyEmailLinkPage.tsx";
import { mockApi } from "./api-mock.ts";
import { signIn } from "./fixtures.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  { path: "/verificar-email", element: <VerifyEmailLinkPage /> },
  { path: "*", element: <LocationProbe /> },
];

describe("VerifyEmailLinkPage", () => {
  it("com sessão, confirma e abre o painel", async () => {
    signIn();
    const api = mockApi([{ method: "POST", path: "/auth/verify-email", body: { message: "ok" } }]);
    renderRoutes(routes, "/verificar-email?token=tok-1");
    expect((await screen.findByTestId("location")).textContent).toBe("/pedidos");
    expect(api.calls[0].body).toEqual({ token: "tok-1" });
    expect(api.calls[0].headers.Authorization).toBeUndefined();
  });

  it("sem sessão, confirma e manda para o login com aviso", async () => {
    mockApi([{ method: "POST", path: "/auth/verify-email", body: { message: "ok" } }]);
    renderRoutes(routes, "/verificar-email?token=tok-1");
    expect((await screen.findByTestId("location")).textContent).toBe("/login?motivo=email-confirmado");
  });

  it("link usado explica e oferece um novo a quem tem sessão", async () => {
    signIn();
    mockApi([{ method: "POST", path: "/auth/verify-email", status: 400, body: { message: "inválido" } }]);
    renderRoutes(routes, "/verificar-email?token=tok-1");
    expect(await screen.findByText("Este link não vale mais")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mandar um link novo" })).toBeTruthy();
  });
});
