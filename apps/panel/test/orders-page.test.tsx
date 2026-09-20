import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "../src/api/types.ts";
import { OrdersPage } from "../src/features/orders/OrdersPage.tsx";
import { orderCode } from "../src/lib/orderCode.ts";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOrder, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const LIST = `/restaurants/${RESTAURANT_ID}/orders`;

function listHandler(orders: Order[]): MockHandler {
  return { method: "GET", path: LIST, body: { data: orders, limit: 100, offset: 0, total: orders.length } };
}

const noTables: MockHandler = {
  method: "GET",
  path: `/restaurants/${RESTAURANT_ID}/tables`,
  body: { data: [], limit: 100, offset: 0, total: 0 },
};

const routes = [
  {
    path: "/pedidos",
    element: <OrdersPage />,
    children: [{ path: ":orderId", element: <LocationProbe /> }],
  },
];

function card(order: Order) {
  return screen.getByRole("article", { name: `Pedido ${orderCode(order.id)}` });
}

describe("OrdersPage", () => {
  it("distribui os pedidos nas colunas pela ação que cada um pede", async () => {
    signIn();
    const pending = makeOrder({ status: "pending" });
    const preparing = makeOrder({ status: "preparing", type: "takeaway", deliveryAddress: null });
    const out = makeOrder({ status: "out_for_delivery" });
    const cancelled = makeOrder({ status: "cancelled" });
    mockApi([listHandler([pending, preparing, out, cancelled]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");

    const novos = await screen.findByRole("region", { name: "Novos" });
    expect(within(novos).getByRole("article", { name: `Pedido ${orderCode(pending.id)}` })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Em preparo" })).getByRole("article", {
        name: `Pedido ${orderCode(preparing.id)}`,
      }),
    ).toBeTruthy();
    const prontos = screen.getByRole("region", { name: "Prontos" });
    expect(within(prontos).getByText("Entrega · Saiu para entrega")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Finalizados" })).getByRole("article", {
        name: `Pedido ${orderCode(cancelled.id)}`,
      }),
    ).toBeTruthy();
    expect(within(card(pending)).getByText("R$ 101,00")).toBeTruthy();
  });

  it("coluna vazia diz o que significa", async () => {
    signIn();
    mockApi([listHandler([makeOrder({ status: "pending" })]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");
    const preparo = await screen.findByRole("region", { name: "Em preparo" });
    expect(await within(preparo).findByText("A cozinha está livre.")).toBeTruthy();
  });

  it("dia sem pedido tranquiliza em vez de parecer quebrado", async () => {
    signIn();
    mockApi([listHandler([]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");
    expect(await screen.findByText("Nenhum pedido ainda hoje")).toBeTruthy();
    expect(
      screen.getByText(
        "A tela se atualiza sozinha e avisa com som quando o primeiro chegar. Não é preciso recarregar.",
      ),
    ).toBeTruthy();
  });

  it("falha real na lista mostra o aviso de erro, e NUNCA 'Nenhum pedido ainda hoje'", async () => {
    signIn();
    const api = mockApi([
      { method: "GET", path: LIST, status: 500, body: { statusCode: 500, error: "Internal", message: "Falhou" } },
      noTables,
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    expect(await screen.findByText("Não foi possível carregar os pedidos")).toBeTruthy();
    expect(screen.getByText("Falhou")).toBeTruthy();
    expect(screen.queryByText("Nenhum pedido ainda hoje")).toBeNull();

    api.add(listHandler([]));
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(screen.getByText("Nenhum pedido ainda hoje")).toBeTruthy());
  });

  it("falha de um POLL em segundo plano mantém o kanban com a lista antiga (regressão)", async () => {
    signIn();
    const order = makeOrder({ status: "pending" });
    const api = mockApi([listHandler([order]), noTables, ...panelHandlers()]);
    const { queryClient } = renderInPanel(routes, "/pedidos");

    // primeira carga: sucesso, o cartão aparece
    expect(await screen.findByRole("article", { name: `Pedido ${orderCode(order.id)}` })).toBeTruthy();

    // um poll seguinte falha (429/500/403) — troca o handler e força o refetch,
    // como o refetchInterval faria em segundo plano
    api.add({
      method: "GET",
      path: LIST,
      status: 500,
      body: { statusCode: 500, error: "Internal", message: "Falhou de novo" },
    });
    await queryClient.refetchQueries({ queryKey: ["orders", "list"] });

    // o aviso aparece, ADITIVO — e o cartão que já estava na tela continua lá:
    // um poll ruim não pode apagar um kanban bom que um segundo antes estava
    // certo (a mesma degradação que o OfflineNotice já fazia para NetworkError)
    expect(await screen.findByText("Não foi possível carregar os pedidos")).toBeTruthy();
    expect(screen.getByRole("article", { name: `Pedido ${orderCode(order.id)}` })).toBeTruthy();
  });

  it("teto de 1000 pedidos avisa em vez de sumir os mais antigos calado", async () => {
    signIn();
    const manyOrders = Array.from({ length: 100 }, () => makeOrder());
    mockApi([
      { method: "GET", path: LIST, body: { data: manyOrders, limit: 100, offset: 0, total: 5000 } },
      noTables,
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    expect(
      await screen.findByText("Mostrando só os 1000 pedidos mais recentes do período"),
    ).toBeTruthy();
  });

  it("intervalo de datas desliga o período, na tela e na requisição", async () => {
    signIn();
    const api = mockApi([listHandler([]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos?from=2026-09-12&to=2026-09-17");
    expect(await screen.findByText("12/09 – 17/09 · limpar")).toBeTruthy();
    expect(
      screen.getByText("Intervalo de datas ativo — o filtro por período fica desligado. Os dois não se combinam."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hoje" }).getAttribute("aria-pressed")).toBe("false");
    const listCall = api.calls.find((call) => call.path === LIST);
    expect(listCall?.query).toMatchObject({ from: "2026-09-12", to: "2026-09-17" });
    expect(listCall?.query.period).toBeUndefined();
  });

  it("trocar o período refaz a busca", async () => {
    signIn();
    const api = mockApi([listHandler([]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");
    fireEvent.click(await screen.findByRole("button", { name: "Ontem" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === LIST && call.query.period === "yesterday")).toBe(true),
    );
  });

  it("clicar no cartão abre o detalhe, preservando os filtros", async () => {
    signIn();
    const order = makeOrder({ status: "completed" });
    mockApi([listHandler([order]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos?period=yesterday");
    fireEvent.click(await screen.findByRole("article", { name: `Pedido ${orderCode(order.id)}` }));
    expect((await screen.findByTestId("location")).textContent).toBe(`/pedidos/${order.id}?period=yesterday`);
  });

  it("entrega por bairro sem bairro vira alerta persistente", async () => {
    signIn();
    mockApi([
      listHandler([]),
      noTables,
      { method: "GET", path: `/restaurants/${RESTAURANT_ID}/delivery-neighborhoods`, body: { neighborhoods: [] } },
      ...panelHandlers({ restaurant: { isDelivery: true, deliveryFeeMode: "neighborhood" } }),
    ]);
    renderInPanel(routes, "/pedidos");
    expect(await screen.findByText("Entrega por bairro sem nenhum bairro cadastrado")).toBeTruthy();
    expect(
      screen.getByText(
        "Não é frete grátis: a loja não consegue calcular o frete e vai recusar pedidos de entrega. Cadastre os bairros ou mude para taxa fixa.",
      ),
    ).toBeTruthy();
  });

  it("sem internet, avisa que a lista pode estar velha", async () => {
    signIn();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mockApi([listHandler([]), noTables, ...panelHandlers()]);
    renderInPanel(routes, "/pedidos");
    expect(await screen.findByText("Sem internet")).toBeTruthy();
  });

  it("filtro de mesa só aparece quando a loja tem mesas", async () => {
    signIn();
    mockApi([
      listHandler([]),
      {
        method: "GET",
        path: `/restaurants/${RESTAURANT_ID}/tables`,
        body: {
          data: [{ id: "t7", restaurantId: RESTAURANT_ID, label: "Mesa 7", hash: "h", qrUrl: "u" }],
          limit: 100,
          offset: 0,
          total: 1,
        },
      },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    const select = await screen.findByLabelText("Mesa");
    expect(within(select).getByText("Mesa 7")).toBeTruthy();
  });
});
