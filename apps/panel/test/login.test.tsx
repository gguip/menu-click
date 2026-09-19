import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readSession } from "../src/api/session.ts";
import { LoginPage } from "../src/features/access/LoginPage.tsx";
import { mockApi } from "./api-mock.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  { path: "/login", element: <LoginPage /> },
  { path: "/pedidos", element: <LocationProbe /> },
];

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("LoginPage", () => {
  it("entra, guarda a sessão e vai para os pedidos", async () => {
    const api = mockApi([
      {
        method: "POST",
        path: "/auth/login",
        body: { token: "tok", expiresAt: "2099-01-01T00:00:00.000Z" },
      },
    ]);
    renderRoutes(routes, "/login");
    fill(" dono@tokyoramen.com.br ", "senha-de-exemplo-123");
    expect((await screen.findByTestId("location")).textContent).toBe("/pedidos");
    expect(api.calls[0].body).toEqual({
      email: "dono@tokyoramen.com.br",
      password: "senha-de-exemplo-123",
    });
    expect(readSession()?.token).toBe("tok");
  });

  it("login errado mostra a mensagem da API", async () => {
    mockApi([
      { method: "POST", path: "/auth/login", status: 401, body: { message: "E-mail ou senha inválidos" } },
    ]);
    renderRoutes(routes, "/login");
    fill("a@b.com", "12345678");
    expect(await screen.findByText("E-mail ou senha inválidos")).toBeTruthy();
  });

  it("429 pede para aguardar", async () => {
    mockApi([{ method: "POST", path: "/auth/login", status: 429, body: { message: "Rate limit exceeded" } }]);
    renderRoutes(routes, "/login");
    fill("a@b.com", "12345678");
    expect(
      await screen.findByText("Muitas tentativas seguidas. Aguarde um instante e tente de novo."),
    ).toBeTruthy();
  });

  it("não envia com campo vazio", () => {
    const api = mockApi([]);
    renderRoutes(routes, "/login");
    fill("", "");
    expect(screen.getByText("Preencha e-mail e senha.")).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it("explica a sessão expirada", () => {
    mockApi([]);
    renderRoutes(routes, "/login?motivo=sessao-expirada");
    expect(screen.getByText("Sua sessão expirou")).toBeTruthy();
    expect(
      screen.getByText(
        "Entre de novo para continuar. Nada do que estava na tela foi enviado; os pedidos seguem registrados no servidor.",
      ),
    ).toBeTruthy();
  });
});
