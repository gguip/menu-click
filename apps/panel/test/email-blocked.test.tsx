import { fireEvent, screen } from "@testing-library/react";
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

  it("não promete destravar o login só por esperar 7 dias (FIX 4)", async () => {
    signIn();
    mockApi([me]);
    renderRoutes(routes, "/confirme-seu-email");
    expect(
      await screen.findByText(
        "Não é possível trocar o e-mail pelo painel. Duas saídas: falar com o suporte, ou esperar 7 dias e se cadastrar de novo com o mesmo e-mail — o cadastro antigo sai do caminho nesse momento, e o novo assume. Só esperar não destrava este login: a conta atual continua bloqueada até lá.",
      ),
    ).toBeTruthy();
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
});
