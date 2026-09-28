import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readSession } from "../src/api/session.ts";
import { RequireVerified } from "../src/auth/guards.tsx";
import { PanelLayout } from "../src/layout/PanelLayout.tsx";
import { mockApi } from "./api-mock.ts";
import { panelHandlers, signIn } from "./fixtures.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

const routes = [
  {
    element: <RequireVerified />,
    children: [
      {
        element: <PanelLayout />,
        children: [{ path: "/pedidos", handle: { title: "Pedidos" }, element: <LocationProbe /> }],
      },
    ],
  },
  { path: "/login", element: <LocationProbe /> },
];

const CHANGE = "/auth/change-password";

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Menu da conta" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Trocar senha" }));
  return screen.getByRole("dialog", { name: "Trocar senha" });
}

function fill(dialog: HTMLElement, values: { current: string; next: string; repeat: string }) {
  const view = within(dialog);
  fireEvent.change(view.getByLabelText("Senha atual"), { target: { value: values.current } });
  fireEvent.change(view.getByLabelText("Nova senha"), { target: { value: values.next } });
  fireEvent.change(view.getByLabelText("Repita a nova senha"), { target: { value: values.repeat } });
  fireEvent.click(view.getByRole("button", { name: "Salvar nova senha" }));
}

describe("trocar senha pelo menu da conta", () => {
  it("manda a atual e a nova, e avisa que as outras sessões caíram", async () => {
    signIn();
    const api = mockApi([{ method: "POST", path: CHANGE, status: 204 }, ...panelHandlers()]);
    renderRoutes(routes, "/pedidos");
    const dialog = await openDialog();
    fill(dialog, { current: "senha-antiga", next: "senha-nova-123", repeat: "senha-nova-123" });

    expect(
      await within(dialog).findByText(
        "As outras sessões desta conta foram encerradas; este aparelho continua conectado.",
      ),
    ).toBeTruthy();
    expect(api.calls.find((call) => call.path === CHANGE)?.body).toEqual({
      currentPassword: "senha-antiga",
      newPassword: "senha-nova-123",
    });
    expect(within(dialog).queryByLabelText("Senha atual")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("senha atual errada (401) aparece no campo e NÃO desloga", async () => {
    signIn();
    mockApi([
      { method: "POST", path: CHANGE, status: 401, body: { message: "Senha atual incorreta" } },
      ...panelHandlers(),
    ]);
    renderRoutes(routes, "/pedidos");
    const dialog = await openDialog();
    fill(dialog, { current: "chutei-errado", next: "senha-nova-123", repeat: "senha-nova-123" });

    expect(await within(dialog).findByText("Senha atual incorreta")).toBeTruthy();
    expect(readSession()).not.toBeNull();
    expect(screen.getByTestId("location").textContent).toBe("/pedidos");
  });

  it.each([
    [{ current: "", next: "senha-nova-123", repeat: "senha-nova-123" }, "Informe a senha atual."],
    [{ current: "senha-antiga", next: "curta", repeat: "curta" }, "A senha precisa de pelo menos 8 caracteres."],
    [{ current: "senha-antiga", next: "senha-nova-123", repeat: "senha-nova-124" }, "As duas senhas não conferem."],
    [{ current: "senha-antiga", next: "senha-antiga", repeat: "senha-antiga" }, "A nova senha é igual à atual."],
  ])("não chama a API quando a tela já sabe o problema: %j", async (values, message) => {
    signIn();
    const api = mockApi(panelHandlers());
    renderRoutes(routes, "/pedidos");
    const dialog = await openDialog();
    fill(dialog, values);

    expect(await within(dialog).findByText(message)).toBeTruthy();
    expect(api.calls.some((call) => call.path === CHANGE)).toBe(false);
  });

  it("outros erros usam o texto de sempre (429)", async () => {
    signIn();
    mockApi([
      { method: "POST", path: CHANGE, status: 429, body: { message: "Rate limit exceeded" } },
      ...panelHandlers(),
    ]);
    renderRoutes(routes, "/pedidos");
    const dialog = await openDialog();
    fill(dialog, { current: "senha-antiga", next: "senha-nova-123", repeat: "senha-nova-123" });

    expect(
      await within(dialog).findByText("Muitas tentativas seguidas. Aguarde um instante e tente de novo."),
    ).toBeTruthy();
  });

  it("enquanto salva, o modal não fecha", async () => {
    signIn();
    mockApi(panelHandlers());
    // A troca fica pendurada: a resposta nunca chega durante o teste.
    const mocked = vi.mocked(fetch);
    const delegate = mocked.getMockImplementation()!;
    mocked.mockImplementation((input, init) =>
      String(input).endsWith(CHANGE) ? new Promise<Response>(() => {}) : delegate(input, init),
    );
    renderRoutes(routes, "/pedidos");
    const dialog = await openDialog();
    fill(dialog, { current: "senha-antiga", next: "senha-nova-123", repeat: "senha-nova-123" });

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cancelar" }).hasAttribute("disabled")).toBe(true),
    );
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Trocar senha" })).toBeTruthy();
    expect(dialog.querySelector(".mantine-Modal-close")).toBeNull();
  });
});
