import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ForgotPasswordPage } from "../src/features/access/ForgotPasswordPage.tsx";
import { ResetPasswordPage } from "../src/features/access/ResetPasswordPage.tsx";
import { mockApi } from "./api-mock.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  { path: "/esqueci-senha", element: <ForgotPasswordPage /> },
  { path: "/recuperar-senha", element: <ResetPasswordPage /> },
  { path: "*", element: <LocationProbe /> },
];

const EXPIRED =
  "Link expirado ou já usado: peça outro na etapa 1. Cada link vale uma vez.";

describe("recuperação de senha", () => {
  it("responde sempre a mesma coisa, exista a conta ou não", async () => {
    const api = mockApi([{ method: "POST", path: "/auth/forgot-password", status: 202, body: { message: "ok" } }]);
    renderRoutes(routes, "/esqueci-senha");
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "qualquer@coisa.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar link" }));
    expect(
      await screen.findByText(
        "Se existir uma conta com esse e-mail, o link de redefinição chega em alguns minutos. Confira o spam.",
      ),
    ).toBeTruthy();
    expect(api.calls[0].body).toEqual({ email: "qualquer@coisa.com" });
  });

  it("senhas diferentes não chegam à API", () => {
    const api = mockApi([]);
    renderRoutes(routes, "/recuperar-senha?token=abc");
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "senha-nova-1" } });
    fireEvent.change(screen.getByLabelText("Repita a nova senha"), { target: { value: "senha-nova-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(screen.getByText("As duas senhas não conferem.")).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it("troca e manda para o login (a API não devolve sessão)", async () => {
    const api = mockApi([{ method: "POST", path: "/auth/reset-password", body: { message: "ok" } }]);
    renderRoutes(routes, "/recuperar-senha?token=abc");
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "senha-nova-1" } });
    fireEvent.change(screen.getByLabelText("Repita a nova senha"), { target: { value: "senha-nova-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/login?motivo=senha-trocada");
    expect(api.calls[0].body).toEqual({ token: "abc", newPassword: "senha-nova-1" });
  });

  it("link vencido mostra a faixa âmbar", async () => {
    mockApi([
      {
        method: "POST",
        path: "/auth/reset-password",
        status: 400,
        body: { message: "Link de recuperação inválido ou expirado" },
      },
    ]);
    renderRoutes(routes, "/recuperar-senha?token=abc");
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "senha-nova-1" } });
    fireEvent.change(screen.getByLabelText("Repita a nova senha"), { target: { value: "senha-nova-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
  });

  it("sem token na URL, avisa de cara", () => {
    mockApi([]);
    renderRoutes(routes, "/recuperar-senha");
    expect(screen.getByText(EXPIRED)).toBeTruthy();
  });
});
