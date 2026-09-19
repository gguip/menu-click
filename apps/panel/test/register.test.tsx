import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegisterPage } from "../src/features/access/RegisterPage.tsx";
import { mockApi } from "./api-mock.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  { path: "/cadastro", element: <RegisterPage /> },
  { path: "*", element: <LocationProbe /> },
];

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillAll(password = "senha-forte-1") {
  type("Nome da loja", "Trattoria Bella");
  type("Tipo de cozinha", "Italiana");
  type("Rua", "Rua Aspicuelta");
  type("Número", "120");
  type("Bairro", "Vila Madalena");
  type("Cidade", "São Paulo");
  type("UF", "sp");
  type("CEP", "05433-010");
  type("Seu nome", "Cláudia Mendes");
  type("E-mail", "gerencia@trattoriabella.com.br");
  type("Senha", password);
}

describe("RegisterPage", () => {
  it("entrega nasce desligada; retirada e salão ligados", () => {
    mockApi([]);
    renderRoutes(routes, "/cadastro");
    expect((screen.getByRole("switch", { name: "Entrega" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("switch", { name: "Retirada no balcão" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("switch", { name: "Salão" }) as HTMLInputElement).checked).toBe(true);
  });

  it("cria a loja, entra em seguida e cai no bloqueio de e-mail", async () => {
    const api = mockApi([
      { method: "POST", path: "/auth/register", status: 201, body: {} },
      { method: "POST", path: "/auth/login", body: { token: "tok", expiresAt: "2099-01-01T00:00:00.000Z" } },
    ]);
    renderRoutes(routes, "/cadastro");
    fillAll();
    fireEvent.click(screen.getByRole("button", { name: "Criar loja e continuar" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/confirme-seu-email");
    expect(api.calls[0].body).toEqual({
      restaurant: {
        name: "Trattoria Bella",
        cuisineType: "Italiana",
        address: {
          street: "Rua Aspicuelta",
          number: "120",
          neighborhood: "Vila Madalena",
          city: "São Paulo",
          state: "SP",
          zipCode: "05433-010",
        },
        isDelivery: false,
        isTakeaway: true,
        isQrcode: true,
      },
      user: { name: "Cláudia Mendes", email: "gerencia@trattoriabella.com.br", password: "senha-forte-1" },
    });
    expect(api.calls[1]).toMatchObject({
      path: "/auth/login",
      body: { email: "gerencia@trattoriabella.com.br", password: "senha-forte-1" },
    });
  });

  it("e-mail em uso mostra a mensagem da API", async () => {
    mockApi([
      {
        method: "POST",
        path: "/auth/register",
        status: 409,
        body: { message: 'O e-mail "gerencia@trattoriabella.com.br" já está em uso' },
      },
    ]);
    renderRoutes(routes, "/cadastro");
    fillAll();
    fireEvent.click(screen.getByRole("button", { name: "Criar loja e continuar" }));
    expect(await screen.findByText('O e-mail "gerencia@trattoriabella.com.br" já está em uso')).toBeTruthy();
  });

  it("senha curta não chega à API", () => {
    const api = mockApi([]);
    renderRoutes(routes, "/cadastro");
    fillAll("curta");
    fireEvent.click(screen.getByRole("button", { name: "Criar loja e continuar" }));
    expect(screen.getByText("A senha precisa de pelo menos 8 caracteres.")).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it("conta criada mas login barrado vai para o login com aviso", async () => {
    mockApi([
      { method: "POST", path: "/auth/register", status: 201, body: {} },
      { method: "POST", path: "/auth/login", status: 429, body: { message: "Rate limit exceeded" } },
    ]);
    renderRoutes(routes, "/cadastro");
    fillAll();
    fireEvent.click(screen.getByRole("button", { name: "Criar loja e continuar" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/login?motivo=conta-criada");
  });
});
