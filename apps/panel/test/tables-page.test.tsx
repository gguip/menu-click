import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TablesPage } from "../src/features/tables/TablesPage.tsx";
import { mockApi } from "./api-mock.ts";
import { panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const TABLES = `/restaurants/${RESTAURANT_ID}/tables`;
const routes = [{ path: "/mesas", element: <TablesPage /> }];

function makeTable(id: string, label: string) {
  return {
    id,
    restaurantId: RESTAURANT_ID,
    label,
    hash: `hash-${id}`,
    qrUrl: `http://localhost:5173/trattoria-bella?mesa=hash-${id}`,
  };
}

function withTables(tables: ReturnType<typeof makeTable>[]) {
  return mockApi([
    { method: "GET", path: TABLES, body: { data: tables, limit: 100, offset: 0, total: tables.length } },
    ...panelHandlers(),
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tela de mesas", () => {
  it("mostra o QR e a URL de cada mesa", async () => {
    signIn();
    withTables([makeTable("t-1", "Mesa 1"), makeTable("t-2", "Mesa 2")]);
    const { container } = renderInPanel(routes, "/mesas");
    await screen.findByText("Mesa 1");
    expect(screen.getByText("http://localhost:5173/trattoria-bella?mesa=hash-t-1")).not.toBeNull();
    // um <svg> por mesa na grade, mais um por mesa na folha de impressão
    expect(container.querySelectorAll("svg").length >= 2).toBe(true);
  });

  it("cadastra mandando o rótulo, e a mesa nova aparece", async () => {
    signIn();
    const api = withTables([]);
    renderInPanel(routes, "/mesas");
    fireEvent.change(await screen.findByLabelText("Rótulo da nova mesa"), {
      target: { value: "Varanda 1" },
    });
    api.add({ method: "POST", path: TABLES, status: 201, body: makeTable("t-9", "Varanda 1") });
    api.add({
      method: "GET",
      path: TABLES,
      body: { data: [makeTable("t-9", "Varanda 1")], limit: 100, offset: 0, total: 1 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar mesa" }));
    await screen.findByText("Varanda 1");
    const post = api.calls.find((call) => call.method === "POST");
    expect(post?.body).toEqual({ label: "Varanda 1" });
  });

  it("rótulo repetido mostra o 409 da API no cartão de cadastro", async () => {
    signIn();
    const api = withTables([]);
    renderInPanel(routes, "/mesas");
    fireEvent.change(await screen.findByLabelText("Rótulo da nova mesa"), { target: { value: "mesa 1" } });
    api.add({
      method: "POST",
      path: TABLES,
      status: 409,
      body: { statusCode: 409, error: "Conflict", message: "Já existe uma mesa com esse rótulo." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar mesa" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Já existe uma mesa com esse rótulo.");
  });

  it("renomear manda só o rótulo e não chama a rota do código novo", async () => {
    signIn();
    const api = withTables([makeTable("t-1", "Mesa 1")]);
    renderInPanel(routes, "/mesas");
    fireEvent.click(await screen.findByRole("button", { name: "Renomear Mesa 1" }));
    fireEvent.change(screen.getByLabelText("Novo rótulo da mesa"), { target: { value: "Mesa 10" } });
    api.add({ method: "PATCH", path: `${TABLES}/t-1`, body: makeTable("t-1", "Mesa 10") });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ label: "Mesa 10" });
    expect(api.calls.some((call) => call.path.endsWith("/rotate-hash"))).toBe(false);
  });

  it("'Novo código' confirma com o texto literal antes de chamar", async () => {
    signIn();
    const api = withTables([makeTable("t-1", "Mesa 1")]);
    renderInPanel(routes, "/mesas");
    fireEvent.click(await screen.findByRole("button", { name: "Novo código Mesa 1" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(
      "O adesivo que está na mesa para de funcionar imediatamente.",
    );
    expect(dialog.textContent).toContain("Só faça isso se você vai reimprimir e trocar o adesivo agora.");
    expect(api.calls.some((call) => call.path.endsWith("/rotate-hash"))).toBe(false);
    api.add({ method: "POST", path: `${TABLES}/t-1/rotate-hash`, body: makeTable("t-1", "Mesa 1") });
    fireEvent.click(screen.getByRole("button", { name: "Gerar código novo" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.path.endsWith("/rotate-hash"))).toBe(true),
    );
  });

  it("remover confirma e chama o DELETE", async () => {
    signIn();
    const api = withTables([makeTable("t-1", "Mesa 1")]);
    renderInPanel(routes, "/mesas");
    fireEvent.click(await screen.findByRole("button", { name: "Remover Mesa 1" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("continuam no histórico");
    api.add({ method: "DELETE", path: `${TABLES}/t-1`, status: 204 });
    api.add({ method: "GET", path: TABLES, body: { data: [], limit: 100, offset: 0, total: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "Remover mesa" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
  });
});
