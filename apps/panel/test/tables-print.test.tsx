import { fireEvent, screen } from "@testing-library/react";
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

describe("impressão dos adesivos", () => {
  it("sem seleção o botão está desabilitado e diz o que fazer", async () => {
    signIn();
    withTables([makeTable("t-1", "Mesa 1")]);
    renderInPanel(routes, "/mesas");
    const button = await screen.findByRole("button", { name: "Selecione para imprimir" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("com duas mesas selecionadas o texto conta, e o clique manda imprimir", async () => {
    signIn();
    withTables([makeTable("t-1", "Mesa 1"), makeTable("t-2", "Mesa 2")]);
    const print = vi.fn();
    vi.stubGlobal("print", print);
    renderInPanel(routes, "/mesas");
    fireEvent.click(await screen.findByLabelText("Selecionar Mesa 1"));
    fireEvent.click(screen.getByLabelText("Selecionar Mesa 2"));
    const button = screen.getByRole("button", { name: "Imprimir 2 adesivos" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("'Selecionar todas' marca tudo e vira 'Limpar seleção'", async () => {
    signIn();
    withTables([makeTable("t-1", "Mesa 1"), makeTable("t-2", "Mesa 2")]);
    renderInPanel(routes, "/mesas");
    // Espera as mesas carregarem antes de clicar: o botão "Selecionar todas"
    // já existe (desabilitado) desde o primeiro render, e clicar nele antes
    // da lista chegar não faz nada.
    await screen.findByLabelText("Selecionar Mesa 1");
    fireEvent.click(screen.getByRole("button", { name: "Selecionar todas" }));
    expect(screen.getByRole("button", { name: "Imprimir 2 adesivos" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(screen.getByRole("button", { name: "Selecione para imprimir" })).not.toBeNull();
  });

  it("a folha tem um adesivo por mesa selecionada, com o nome da loja", async () => {
    signIn();
    withTables([makeTable("t-1", "Mesa 1"), makeTable("t-2", "Mesa 2")]);
    renderInPanel(routes, "/mesas");
    fireEvent.click(await screen.findByLabelText("Selecionar Mesa 2"));
    const sheet = screen.getByTestId("folha-de-impressao");
    expect(sheet.querySelectorAll("[data-testid='adesivo']").length).toBe(1);
    expect(sheet.textContent).toContain("Mesa 2");
    expect(sheet.textContent).toContain("Trattoria Bella");
    expect(sheet.textContent).not.toContain("Mesa 1");
  });
});
