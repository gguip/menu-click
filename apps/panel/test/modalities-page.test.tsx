import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModalitiesPage } from "../src/features/settings/ModalitiesPage.tsx";
import classes from "../src/features/settings/ModalitiesPage.module.css";
import { mockApi } from "./api-mock.ts";
import { makeMe, makeRestaurant, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const routes = [{ path: "/modalidades", element: <ModalitiesPage /> }];

function toggle(name: string) {
  return screen.getByRole("switch", { name });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Promessa resolvida à mão, para controlar a ordem em que dois PATCH voltam. */
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("ModalitiesPage", () => {
  it("liga o vale-refeição e manda só esse campo", async () => {
    signIn();
    const api = mockApi([
      {
        method: "PATCH",
        path: `/restaurants/${RESTAURANT_ID}`,
        body: makeRestaurant({ acceptsMealVoucher: true }),
      },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/modalidades");
    fireEvent.click(await screen.findByRole("switch", { name: "Vale-refeição" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ acceptsMealVoucher: true }),
    );
    expect((toggle("Vale-refeição") as HTMLInputElement).checked).toBe(true);
  });

  it("falha da API volta o interruptor e mostra o erro", async () => {
    signIn();
    mockApi([
      {
        method: "PATCH",
        path: `/restaurants/${RESTAURANT_ID}`,
        status: 500,
        body: { message: "Algo deu errado no servidor" },
      },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/modalidades");
    const pix = await screen.findByRole("switch", { name: "Pix" });
    expect((pix as HTMLInputElement).checked).toBe(true);
    fireEvent.click(pix);
    expect(await screen.findByText("Algo deu errado no servidor")).toBeTruthy();
    await waitFor(() => expect((toggle("Pix") as HTMLInputElement).checked).toBe(true));
  });

  it("um refetch que falha não troca os interruptores pela mensagem", async () => {
    signIn();
    const api = mockApi(panelHandlers());
    const { queryClient } = renderInPanel(routes, "/modalidades");
    await screen.findByRole("switch", { name: "Pix" });

    api.add({
      method: "GET",
      path: `/restaurants/${RESTAURANT_ID}`,
      status: 503,
      body: { statusCode: 503, error: "Service Unavailable", message: "Fora do ar" },
      once: true,
    });
    await queryClient.refetchQueries({ queryKey: ["restaurant", RESTAURANT_ID] });

    expect(await screen.findByRole("switch", { name: "Pix" })).toBeTruthy();
    expect(screen.queryByText("Fora do ar")).toBeNull();
  });

  it("a nota do topo é literal do handoff", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/modalidades");
    expect(
      await screen.findByText(
        "O que a loja aceita. Desligar uma modalidade tira a opção do cardápio público na hora — pedidos já abertos não são afetados.",
      ),
    ).toBeTruthy();
  });

  it("sem nenhuma modalidade ligada, avisa", async () => {
    signIn();
    mockApi(
      panelHandlers({ restaurant: { isDelivery: false, isTakeaway: false, isQrcode: false } }),
    );
    renderInPanel(routes, "/modalidades");
    expect(
      await screen.findByText(
        "Sem nenhuma modalidade ligada a loja não recebe pedido nenhum, mesmo dentro do horário. Ao menos uma precisa ficar ativa.",
      ),
    ).toBeTruthy();
  });

  it("entrega ligada com modo bairro e nenhum bairro avisa que o pedido será recusado", async () => {
    signIn();
    mockApi([
      {
        method: "GET",
        path: `/restaurants/${RESTAURANT_ID}/delivery-neighborhoods`,
        body: { neighborhoods: [] },
      },
      ...panelHandlers({ restaurant: { isDelivery: true, deliveryFeeMode: "neighborhood" } }),
    ]);
    renderInPanel(routes, "/modalidades");
    expect(await screen.findByText("Entrega por bairro sem nenhum bairro cadastrado")).toBeTruthy();
  });

  it("entrega ligada, modo bairro sem bairro, mas frete a combinar ligado — não avisa", async () => {
    signIn();
    mockApi([
      {
        method: "GET",
        path: `/restaurants/${RESTAURANT_ID}/delivery-neighborhoods`,
        body: { neighborhoods: [] },
      },
      ...panelHandlers({
        restaurant: { isDelivery: true, deliveryFeeMode: "neighborhood", deliveryFeeToArrange: true },
      }),
    ]);
    renderInPanel(routes, "/modalidades");
    await screen.findByRole("switch", { name: "Entrega" });
    expect(screen.queryByText("Entrega por bairro sem nenhum bairro cadastrado")).toBeNull();
  });

  it("entrega ligada com taxa fixa em R$ 0 avisa que o frete sai grátis", async () => {
    signIn();
    mockApi(
      panelHandlers({
        restaurant: { isDelivery: true, deliveryFeeMode: "fixed", deliveryFixedFeeInCents: 0 },
      }),
    );
    renderInPanel(routes, "/modalidades");
    expect(await screen.findByText("Entrega ligada com frete grátis")).toBeTruthy();
  });

  it("entrega ligada com taxa fixa positiva não avisa de frete grátis", async () => {
    signIn();
    mockApi(
      panelHandlers({
        restaurant: { isDelivery: true, deliveryFeeMode: "fixed", deliveryFixedFeeInCents: 500 },
      }),
    );
    renderInPanel(routes, "/modalidades");
    await screen.findByRole("switch", { name: "Entrega" });
    expect(screen.queryByText("Entrega ligada com frete grátis")).toBeNull();
  });

  it("o erro fica embaixo do interruptor que falhou, mesmo com dois cliques seguidos", async () => {
    signIn();
    const deferredA = defer<Response>();
    const deferredB = defer<Response>();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api/, "");
      const method = init.method ?? "GET";
      if (method === "GET" && path === "/auth/me") return jsonResponse(makeMe());
      if (method === "GET" && path === `/restaurants/${RESTAURANT_ID}`) return jsonResponse(makeRestaurant());
      if (method === "PATCH" && path === `/restaurants/${RESTAURANT_ID}`) {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        if ("isDelivery" in body) return deferredA.promise;
        if ("isTakeaway" in body) return deferredB.promise;
      }
      throw new Error(`Chamada sem mock: ${method} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderInPanel(routes, "/modalidades");

    const delivery = await screen.findByRole("switch", { name: "Entrega" });
    const takeaway = await screen.findByRole("switch", { name: "Retirada no balcão" });

    fireEvent.click(delivery);
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1),
    );
    fireEvent.click(takeaway);
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2),
    );

    // A (entrega) só resolve DEPOIS de B (retirada) já ter sido disparado, e falha.
    deferredA.resolve(jsonResponse({ message: "Falha no A" }, 500));
    await screen.findByRole("alert");

    const deliveryRow = delivery.closest(`.${classes.row}`);
    const takeawayRow = takeaway.closest(`.${classes.row}`);

    // A mensagem do A fica na linha da entrega, não na da retirada.
    expect(deliveryRow?.querySelector('[role="alert"]')?.textContent).toBe("Falha no A");
    expect(takeawayRow?.querySelector('[role="alert"]')).toBeNull();

    // B (retirada) dá certo, sem erro nenhum na sua linha.
    deferredB.resolve(jsonResponse(makeRestaurant({ isTakeaway: false })));
    await waitFor(() => expect((toggle("Retirada no balcão") as HTMLInputElement).checked).toBe(false));
    expect(takeawayRow?.querySelector('[role="alert"]')).toBeNull();

    // A mensagem do A continua lá, intocada pelo sucesso do B.
    expect(deliveryRow?.querySelector('[role="alert"]')?.textContent).toBe("Falha no A");
  });
});
