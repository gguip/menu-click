import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readSession } from "../src/api/session.ts";
import { StoreDataPage } from "../src/features/settings/StoreDataPage.tsx";
import { mockApi } from "./api-mock.ts";
import { panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const routes = [
  { path: "/dados-da-loja", element: <StoreDataPage /> },
  { path: "*", element: <LocationProbe /> },
];

describe("zona destrutiva", () => {
  it("não existe para quem é equipe", async () => {
    signIn();
    mockApi(panelHandlers({ me: { role: "staff" } }));
    renderInPanel(routes, "/dados-da-loja");
    await screen.findByLabelText("Nome da loja");
    expect(screen.queryByRole("button", { name: "Remover restaurante" })).toBeNull();
  });

  it("o dono precisa digitar o nome da loja para o botão liberar", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.click(await screen.findByRole("button", { name: "Remover restaurante" }));
    const dialog = await screen.findByRole("dialog", { name: "Remover a Trattoria Bella?" });
    const confirm = screen.getByRole("button", { name: "Remover para sempre" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Digite o nome da loja para confirmar"), {
      target: { value: "Trattoria" },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Digite o nome da loja para confirmar"), {
      target: { value: "Trattoria Bella" },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    expect(dialog.textContent).toContain("cardápio");
  });

  it("removeu: a sessão acaba (também no servidor) e a pessoa volta ao login", async () => {
    signIn();
    const api = mockApi([
      { method: "DELETE", path: `/restaurants/${RESTAURANT_ID}`, status: 204 },
      { method: "POST", path: "/auth/logout", status: 204 },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.click(await screen.findByRole("button", { name: "Remover restaurante" }));
    fireEvent.change(screen.getByLabelText("Digite o nome da loja para confirmar"), {
      target: { value: "Trattoria Bella" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remover para sempre" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/login?motivo=loja-removida");
    expect(readSession()).toBeNull();
    expect(api.calls.some((call) => call.method === "DELETE")).toBe(true);
    expect(api.calls.some((call) => call.method === "POST" && call.path === "/auth/logout")).toBe(true);
  });

  it("DELETE que falha: a sessão continua, não navega, e o erro aparece no diálogo", async () => {
    signIn();
    const api = mockApi([
      {
        method: "DELETE",
        path: `/restaurants/${RESTAURANT_ID}`,
        status: 403,
        body: { statusCode: 403, error: "Forbidden", message: "Só o dono pode remover o restaurante" },
      },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.click(await screen.findByRole("button", { name: "Remover restaurante" }));
    fireEvent.change(screen.getByLabelText("Digite o nome da loja para confirmar"), {
      target: { value: "Trattoria Bella" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remover para sempre" }));
    const dialog = await screen.findByRole("dialog", { name: "Remover a Trattoria Bella?" });
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(
      "Só o dono pode remover o restaurante",
    );
    expect(screen.queryByTestId("location")).toBeNull();
    expect(readSession()).not.toBeNull();
    expect(api.calls.some((call) => call.method === "POST" && call.path === "/auth/logout")).toBe(false);
  });
});
