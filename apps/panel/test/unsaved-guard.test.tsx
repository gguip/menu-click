import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";
import { apiRequest } from "../src/api/client.ts";
import { installSessionExpiry } from "../src/auth/sessionExpiry.ts";
import { SaveBar } from "../src/ui/SaveBar.tsx";
import { LEAVE_WITHOUT_ASKING } from "../src/ui/unsavedChanges.ts";
import { mockApi } from "./api-mock.ts";
import { signIn } from "./fixtures.ts";
import { LocationProbe, renderRoutes } from "./render.tsx";

function Form() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();
  return (
    <>
      <input aria-label="campo" value={value} onChange={(event) => setValue(event.currentTarget.value)} />
      <Link to="/outra">Ir para outra tela</Link>
      <button type="button" onClick={() => navigate("/outra", { state: LEAVE_WITHOUT_ASKING })}>
        Salvou e saiu
      </button>
      <SaveBar dirty={value !== ""} saveLabel="Salvar" onSave={() => {}} cancel={{ to: "/outra" }} />
    </>
  );
}

const routes = [
  { path: "/form", element: <Form /> },
  { path: "/outra", element: <LocationProbe /> },
  { path: "/login", element: <LocationProbe /> },
];

function dirtyForm() {
  renderRoutes(routes, "/form");
  fireEvent.change(screen.getByLabelText("campo"), { target: { value: "mexi" } });
}

describe("aviso de alteração não salva", () => {
  it("tela suja: trocar de tela pergunta; 'Voltar' fica e 'Sair sem salvar' sai", async () => {
    dirtyForm();
    fireEvent.click(screen.getByRole("link", { name: "Ir para outra tela" }));
    const dialog = await screen.findByRole("dialog", { name: "Sair sem salvar?" });
    expect(within(dialog).getByText("As alterações desta tela ainda não foram salvas.")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("location")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Ir para outra tela" }));
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Sair sem salvar?" })).getByRole("button", {
        name: "Sair sem salvar",
      }),
    );
    expect((await screen.findByTestId("location")).textContent).toBe("/outra");
  });

  it("tela limpa sai sem perguntar", async () => {
    renderRoutes(routes, "/form");
    fireEvent.click(screen.getByRole("link", { name: "Ir para outra tela" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/outra");
  });

  it("'Cancelar' já é a decisão de descartar: não pergunta", async () => {
    dirtyForm();
    fireEvent.click(screen.getByRole("link", { name: "Cancelar" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/outra");
  });

  it("saída marcada (salvou, sessão expirou, saiu da conta) não pergunta", async () => {
    dirtyForm();
    fireEvent.click(screen.getByRole("button", { name: "Salvou e saiu" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/outra");
  });

  it("sessão expirada com a tela suja vai direto ao login: ficar não salvaria nada", async () => {
    signIn();
    mockApi([{ method: "GET", path: "/auth/me", status: 401, body: { message: "Sessão inválida ou expirada" } }]);
    let uninstall = () => {};
    renderRoutes(routes, "/form", {
      beforeRender: ({ router, queryClient }) => {
        uninstall = installSessionExpiry(queryClient, router);
      },
    });
    fireEvent.change(screen.getByLabelText("campo"), { target: { value: "mexi" } });
    await apiRequest("/auth/me").catch(() => {});
    expect((await screen.findByTestId("location")).textContent).toBe("/login?motivo=sessao-expirada");
    expect(screen.queryByRole("dialog")).toBeNull();
    uninstall();
  });

  it("recarregar ou fechar a aba com a tela suja pede o aviso do navegador", () => {
    dirtyForm();
    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    fireEvent.change(screen.getByLabelText("campo"), { target: { value: "" } });
    const cleanEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });
});
