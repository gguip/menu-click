import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readSession } from "../src/api/session.ts";
import { EmailBlockedPage } from "../src/features/access/EmailBlockedPage.tsx";
import { mockApi } from "./api-mock.ts";
import { makeMe, signIn } from "./fixtures.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  { path: "/confirme-seu-email", element: <EmailBlockedPage /> },
  { path: "*", element: <LocationProbe /> },
];

const me = { method: "GET" as const, path: "/auth/me", body: makeMe({ emailVerified: false }) };

describe("EmailBlockedPage", () => {
  it("mostra o endereço que recebeu o link", async () => {
    signIn();
    mockApi([me]);
    renderRoutes(routes, "/confirme-seu-email");
    expect(await screen.findByText("gerencia@trattoriabella.com.br")).toBeTruthy();
    expect(screen.getByText("Painel bloqueado")).toBeTruthy();
  });

  it("reenvio aceito mostra a mensagem neutra", async () => {
    signIn();
    mockApi([me, { method: "POST", path: "/auth/resend-verification", status: 202, body: { message: "ok" } }]);
    renderRoutes(routes, "/confirme-seu-email");
    fireEvent.click(await screen.findByRole("button", { name: "Não recebi, reenviar" }));
    expect(await screen.findByText("Link reenviado. Confira também a caixa de spam.")).toBeTruthy();
  });

  it("429 trava o botão com a contagem do Retry-After", async () => {
    signIn();
    mockApi([
      me,
      {
        method: "POST",
        path: "/auth/resend-verification",
        status: 429,
        body: { message: "Rate limit exceeded" },
        headers: { "retry-after": "38" },
      },
    ]);
    renderRoutes(routes, "/confirme-seu-email");
    fireEvent.click(await screen.findByRole("button", { name: "Não recebi, reenviar" }));
    const locked = await screen.findByRole("button", { name: "Reenviar em 0:38" });
    expect((locked as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(
        "Aguarde um instante: são no máximo 3 reenvios por minuto. O último link continua valendo.",
      ),
    ).toBeTruthy();
  });

  it("loja já verificada vai para os pedidos", async () => {
    signIn();
    mockApi([{ method: "GET", path: "/auth/me", body: makeMe() }]);
    renderRoutes(routes, "/confirme-seu-email");
    expect((await screen.findByTestId("location")).textContent).toBe("/pedidos");
  });

  it("sair da conta encerra a sessão", async () => {
    signIn();
    const api = mockApi([me, { method: "POST", path: "/auth/logout", status: 204 }]);
    renderRoutes(routes, "/confirme-seu-email");
    fireEvent.click(await screen.findByRole("button", { name: "Sair da conta" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/login");
    expect(readSession()).toBeNull();
    expect(api.calls.some((call) => call.path === "/auth/logout")).toBe(true);
  });

  const corrected = "joao@gmail.com";

  async function fillAndSubmit(email: string, password: string) {
    fireEvent.change(await screen.findByLabelText("E-mail correto"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Senha atual"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Corrigir e-mail" }));
  }

  it("corrige o e-mail e passa a mostrar o endereço novo", async () => {
    signIn();
    const api = mockApi([
      { ...me, once: true },
      { method: "GET", path: "/auth/me", body: makeMe({ emailVerified: false, email: corrected }) },
      { method: "POST", path: "/auth/change-email", status: 204 },
    ]);
    renderRoutes(routes, "/confirme-seu-email");

    // espaço nas pontas, como num endereço colado: o painel apara
    await fillAndSubmit(`  ${corrected} `, "senha-do-dono-123");

    expect(
      await screen.findByText("E-mail corrigido. Enviamos o link de confirmação para o endereço novo."),
    ).toBeTruthy();
    expect(await screen.findByText(corrected)).toBeTruthy();
    const call = api.calls.find((c) => c.path === "/auth/change-email");
    expect(call?.body).toEqual({ currentPassword: "senha-do-dono-123", newEmail: corrected });
    // o formulário recomeça vazio
    expect((screen.getByLabelText("E-mail correto") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Senha atual") as HTMLInputElement).value).toBe("");
  });

  it("senha errada mostra o erro e NÃO encerra a sessão", async () => {
    signIn();
    mockApi([
      me,
      {
        method: "POST",
        path: "/auth/change-email",
        status: 401,
        body: { statusCode: 401, error: "Unauthorized", message: "Senha atual incorreta" },
      },
    ]);
    renderRoutes(routes, "/confirme-seu-email");

    await fillAndSubmit(corrected, "senha-errada");

    expect(await screen.findByText("Senha atual incorreta")).toBeTruthy();
    expect(readSession()).not.toBeNull();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("409 mostra a mensagem da API", async () => {
    signIn();
    mockApi([
      me,
      {
        method: "POST",
        path: "/auth/change-email",
        status: 409,
        body: { statusCode: 409, error: "Conflict", message: `O e-mail "${corrected}" já está cadastrado` },
      },
    ]);
    renderRoutes(routes, "/confirme-seu-email");

    await fillAndSubmit(corrected, "senha-do-dono-123");

    expect(await screen.findByText(`O e-mail "${corrected}" já está cadastrado`)).toBeTruthy();
  });

  it("429 na correção trava o botão com a contagem", async () => {
    signIn();
    mockApi([
      me,
      {
        method: "POST",
        path: "/auth/change-email",
        status: 429,
        body: { message: "Rate limit exceeded" },
        headers: { "retry-after": "38" },
      },
    ]);
    renderRoutes(routes, "/confirme-seu-email");

    await fillAndSubmit(corrected, "senha-do-dono-123");

    const locked = await screen.findByRole("button", { name: "Tentar de novo em 0:38" });
    expect((locked as HTMLButtonElement).disabled).toBe(true);
    // o teto da correção é outro: o reenvio continua livre
    expect((screen.getByRole("button", { name: "Não recebi, reenviar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("campo vazio avisa na tela e não chama a API", async () => {
    signIn();
    const api = mockApi([me]);
    renderRoutes(routes, "/confirme-seu-email");

    await fillAndSubmit("   ", "");

    expect(await screen.findByText("Informe o e-mail correto e a senha atual.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/auth/change-email")).toBe(false);
  });

  it("clique duplo manda uma chamada só", async () => {
    signIn();
    const api = mockApi([
      me,
      { method: "POST", path: "/auth/change-email", status: 204 },
    ]);
    renderRoutes(routes, "/confirme-seu-email");

    fireEvent.change(await screen.findByLabelText("E-mail correto"), { target: { value: corrected } });
    fireEvent.change(screen.getByLabelText("Senha atual"), { target: { value: "senha-do-dono-123" } });
    const form = screen.getByRole("button", { name: "Corrigir e-mail" }).closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => {
      expect(api.calls.filter((c) => c.path === "/auth/change-email").length).toBe(1);
    });
    await screen.findByText("E-mail corrigido. Enviamos o link de confirmação para o endereço novo.");
    expect(api.calls.filter((c) => c.path === "/auth/change-email").length).toBe(1);
  });
});
