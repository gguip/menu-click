import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTodaySummary } from "../src/features/orders/useSummary.ts";
import { StoreDataPage } from "../src/features/settings/StoreDataPage.tsx";
import { mockApi } from "./api-mock.ts";
import { makeRestaurant, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const routes = [{ path: "/dados-da-loja", element: <StoreDataPage /> }];

/** Fica ao lado da tela, do mesmo jeito que o header do painel ficaria. */
function SummaryProbe() {
  useTodaySummary(RESTAURANT_ID);
  return null;
}

describe("StoreDataPage", () => {
  it("mostra o slug, desabilitado, com o porquê", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    const slug = (await screen.findByLabelText("Endereço público")) as HTMLInputElement;
    expect(slug.disabled).toBe(true);
    expect(slug.value).toContain("trattoria-bella");
    expect(
      screen.getByText("É a URL dentro do QR code impresso — por isso não muda por aqui."),
    ).toBeTruthy();
  });

  it("salva só o que mudou", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ name: "Trattoria Bela" }) },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.change(await screen.findByLabelText("Nome da loja"), {
      target: { value: "Trattoria Bela" },
    });
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({
        name: "Trattoria Bela",
      }),
    );
  });

  it("o fuso é uma lista fechada, com o aviso do que ele decide", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    const timezone = await screen.findByLabelText("Fuso horário");
    expect(timezone.tagName).toBe("SELECT");
    expect(screen.getByText("É ele que decide onde o dia começa: “pedidos de hoje” e o faturamento do topo mudam junto.")).toBeTruthy();
  });

  it("campo obrigatório vazio nem chega à API", async () => {
    signIn();
    const api = mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.change(await screen.findByLabelText("Nome da loja"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));
    expect(screen.getByText("Informe o nome da loja.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("um refetch que falha não troca o editor pela mensagem, e o que foi digitado continua lá", async () => {
    signIn();
    const api = mockApi(panelHandlers());
    const { queryClient } = renderInPanel(routes, "/dados-da-loja");
    const nome = (await screen.findByLabelText("Nome da loja")) as HTMLInputElement;
    fireEvent.change(nome, { target: { value: "Trattoria Bela" } });

    api.add({
      method: "GET",
      path: `/restaurants/${RESTAURANT_ID}`,
      status: 503,
      body: { statusCode: 503, error: "Service Unavailable", message: "Fora do ar" },
      once: true,
    });
    await queryClient.refetchQueries({ queryKey: ["restaurant", RESTAURANT_ID] });

    expect(await screen.findByLabelText("Nome da loja")).toBeTruthy();
    expect((screen.getByLabelText("Nome da loja") as HTMLInputElement).value).toBe("Trattoria Bela");
    expect(screen.queryByText("Fora do ar")).toBeNull();
  });

  it("trocar o fuso invalida as queries de pedidos, para o header atualizar na hora", async () => {
    signIn();
    const api = mockApi([
      {
        method: "PATCH",
        path: `/restaurants/${RESTAURANT_ID}`,
        body: makeRestaurant({ timezone: "America/Bahia" }),
      },
      ...panelHandlers(),
    ]);
    renderInPanel(
      [{ path: "/dados-da-loja", element: <><StoreDataPage /><SummaryProbe /></> }],
      "/dados-da-loja",
    );
    const timezone = await screen.findByLabelText("Fuso horário");
    const summaryCallsBefore = api.calls.filter(
      (call) => call.method === "GET" && call.path.endsWith("/orders/summary"),
    ).length;

    fireEvent.change(timezone, { target: { value: "America/Bahia" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    await waitFor(() =>
      expect(
        api.calls.filter((call) => call.method === "GET" && call.path.endsWith("/orders/summary")).length,
      ).toBeGreaterThan(summaryCallsBefore),
    );
  });
});
