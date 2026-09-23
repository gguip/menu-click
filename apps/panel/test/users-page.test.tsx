import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RestaurantUser } from "../src/api/types.ts";
import { UsersPage } from "../src/features/users/UsersPage.tsx";
import { mockApi } from "./api-mock.ts";
import { makeMe, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const USERS = `/restaurants/${RESTAURANT_ID}/users`;
const routes = [{ path: "/usuarios", element: <UsersPage /> }];

const dona = {
  id: makeMe().id,
  restaurantId: RESTAURANT_ID,
  name: "Cláudia Mendes",
  email: "gerencia@trattoriabella.com.br",
  role: "owner" as const,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

const joao = { ...dona, id: "u-2", name: "João Alves", email: "joao@trattoriabella.com.br", role: "staff" as const };

function withUsers(users: RestaurantUser[], me: Parameters<typeof panelHandlers>[0] = {}) {
  return mockApi([{ method: "GET", path: USERS, body: { data: users } }, ...panelHandlers(me)]);
}

describe("tela de usuários", () => {
  it("mostra papel e e-mail, e a própria conta diz 'você' em vez de 'Remover'", async () => {
    signIn();
    withUsers([dona, joao]);
    renderInPanel(routes, "/usuarios");
    await screen.findByText("João Alves");
    // Escopado na lista: o Select de papel do convite mantém as próprias
    // opções ("Equipe"/"Dono") no DOM mesmo fechado (env="test"), e um
    // getByText sem escopo bateria nelas também.
    const list = within(screen.getByRole("list"));
    expect(list.getByText("joao@trattoriabella.com.br")).not.toBeNull();
    expect(list.getByText("Equipe")).not.toBeNull();
    expect(list.getByText("Dono")).not.toBeNull();
    expect(list.getByText("você")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Remover Cláudia Mendes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remover João Alves" })).not.toBeNull();
  });

  it("convida mandando nome, e-mail, senha e papel, com Equipe como padrão", async () => {
    signIn();
    const api = withUsers([dona]);
    renderInPanel(routes, "/usuarios");
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "João Alves" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "joao@trattoriabella.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha provisória"), { target: { value: "provisoria8" } });
    api.add({ method: "POST", path: USERS, status: 201, body: joao });
    api.add({ method: "GET", path: USERS, body: { data: [dona, joao] } });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "POST")).toBe(true));
    expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "João Alves",
      email: "joao@trattoriabella.com.br",
      password: "provisoria8",
      role: "staff",
    });
  });

  it("senha curta é barrada antes da chamada", async () => {
    signIn();
    const api = withUsers([dona]);
    renderInPanel(routes, "/usuarios");
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "João" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "joao@loja.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha provisória"), { target: { value: "1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));
    await screen.findByText("A senha provisória precisa de pelo menos 8 caracteres.");
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("e-mail repetido mostra o 409 da API", async () => {
    signIn();
    const api = withUsers([dona]);
    renderInPanel(routes, "/usuarios");
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "João" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "joao@loja.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha provisória"), { target: { value: "provisoria8" } });
    api.add({
      method: "POST",
      path: USERS,
      status: 409,
      body: { statusCode: 409, error: "Conflict", message: "E-mail já cadastrado." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("E-mail já cadastrado.");
  });

  it("remover confirma e chama o DELETE", async () => {
    signIn();
    const api = withUsers([dona, joao]);
    renderInPanel(routes, "/usuarios");
    fireEvent.click(await screen.findByRole("button", { name: "Remover João Alves" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("a sessão aberta dela morre na próxima ação");
    api.add({ method: "DELETE", path: `${USERS}/u-2`, status: 204 });
    api.add({ method: "GET", path: USERS, body: { data: [dona] } });
    fireEvent.click(screen.getByRole("button", { name: "Remover acesso" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
  });

  it("para quem é equipe a tela não aparece", async () => {
    signIn();
    withUsers([dona], { me: { role: "staff" } });
    renderInPanel(routes, "/usuarios");
    await screen.findByText("Só o dono administra os usuários da loja.");
    expect(screen.queryByLabelText("Senha provisória")).toBeNull();
  });
});
