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

  it("removeu: a sessão acaba e a pessoa volta ao login", async () => {
    signIn();
    const api = mockApi([
      { method: "DELETE", path: `/restaurants/${RESTAURANT_ID}`, status: 204 },
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
  });
});
