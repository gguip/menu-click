import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTodaySummary } from "../src/features/orders/useSummary.ts";
import { SummaryPage } from "../src/features/summary/SummaryPage.tsx";
import { mockApi } from "./api-mock.ts";
import { makeSummary, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const SUMMARY = `/restaurants/${RESTAURANT_ID}/orders/summary`;

/** Faz o papel do header: a MESMA query de "hoje". */
function HeaderProbe() {
  const summary = useTodaySummary(RESTAURANT_ID);
  return <p data-testid="header">{summary.data?.revenueOrderCount ?? "—"}</p>;
}

const routes = [
  {
    path: "/resumo",
    element: (
      <>
        <HeaderProbe />
        <SummaryPage />
        <LocationProbe />
      </>
    ),
  },
];

const counts = {
  pending: 2,
  confirmed: 1,
  preparing: 1,
  ready_for_pickup: 0,
  out_for_delivery: 1,
  completed: 4,
  cancelled: 1,
};

describe("SummaryPage", () => {
  it("com Hoje, o Resumo e o header dividem UMA chamada", async () => {
    signIn();
    const api = mockApi(
      panelHandlers({ summary: { counts, revenueInCents: 45000, revenueOrderCount: 6, averageTicketInCents: 7500 } }),
    );
    renderInPanel(routes, "/resumo");
    expect(await screen.findByText("de 6 pedidos aceitos — inclui o frete cobrado")).toBeTruthy();
    expect(screen.getByTestId("header").textContent).toBe("6");
    const todayCalls = api.calls.filter((call) => call.path === SUMMARY && call.query.period === "today");
    expect(todayCalls).toHaveLength(1);
  });

  it("os três números, as cinco linhas e as três notas", async () => {
    signIn();
    mockApi(
      panelHandlers({ summary: { counts, revenueInCents: 45000, revenueOrderCount: 6, averageTicketInCents: 7500 } }),
    );
    renderInPanel(routes, "/resumo");
    expect(await screen.findByText("10 chegaram no período")).toBeTruthy();
    expect(screen.getByText("faturamento ÷ pedidos aceitos")).toBeTruthy();
    for (const label of ["Novos", "Em preparo", "Prontos / em rota", "Concluídos", "Cancelados"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("Pedidos por status")).toBeTruthy();
    expect(screen.getByText("Como ler estes números")).toBeTruthy();
    expect(screen.getByText("Faturamento conta de aceito em diante.")).toBeTruthy();
    expect(screen.getByText("O ticket médio mistura comida e frete.")).toBeTruthy();
  });

  it("Ontem busca period=yesterday e vai para a URL", async () => {
    signIn();
    const api = mockApi([
      {
        method: "GET",
        path: SUMMARY,
        query: { period: "yesterday" },
        body: makeSummary({ revenueOrderCount: 3 }),
      },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/resumo");
    fireEvent.click(await screen.findByRole("button", { name: "Ontem" }));
    expect(await screen.findByText("de 3 pedidos aceitos — inclui o frete cobrado")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/resumo?period=yesterday");
    expect(api.calls.some((call) => call.path === SUMMARY && call.query.period === "yesterday")).toBe(true);
  });

  it("Ontem não diz 'Fechamento parcial'", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/resumo?period=yesterday");
    expect(await screen.findByText(/^atualizado há/)).toBeTruthy();
    expect(screen.queryByText(/Fechamento parcial/)).toBeNull();
  });

  it("um refetch que falha não troca os números pela mensagem", async () => {
    signIn();
    const api = mockApi(panelHandlers({ summary: { counts, revenueOrderCount: 6 } }));
    const { queryClient } = renderInPanel(routes, "/resumo");
    await screen.findByText("10 chegaram no período");
    api.add({
      method: "GET",
      path: SUMMARY,
      status: 503,
      body: { statusCode: 503, error: "Service Unavailable", message: "Fora do ar" },
      once: true,
    });
    await queryClient.refetchQueries({ queryKey: ["orders", "summary"] });
    await waitFor(() => expect(screen.getByText("10 chegaram no período")).toBeTruthy());
    expect(screen.queryByText("Fora do ar")).toBeNull();
  });
});
