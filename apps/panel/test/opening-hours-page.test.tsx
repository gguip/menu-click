import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpeningHoursPage } from "../src/features/settings/OpeningHoursPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeMe, makeRestaurant, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Promessa resolvida à mão, para segurar o PUT enquanto a tela é editada. */
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const HOURS = `/restaurants/${RESTAURANT_ID}/opening-hours`;
const routes = [{ path: "/horario", element: <OpeningHoursPage /> }];

function gradeHandler(
  hours: { id: string; weekday: number; opensAt: string; closesAt: string }[],
): MockHandler {
  return { method: "GET", path: HOURS, body: { openingHours: hours } };
}

const SEGUNDA_E_SABADO = [
  { id: "1", weekday: 1, opensAt: "11:30", closesAt: "15:00" },
  { id: "2", weekday: 1, opensAt: "18:00", closesAt: "23:30" },
  { id: "3", weekday: 6, opensAt: "18:00", closesAt: "02:00" },
];

function setup(extra: MockHandler[] = [], hours = SEGUNDA_E_SABADO) {
  signIn();
  const api = mockApi([...extra, gradeHandler(hours), ...panelHandlers()]);
  renderInPanel(routes, "/horario");
  return api;
}

describe("OpeningHoursPage", () => {
  it("resume cada dia, e dia sem faixa é dia fechado", async () => {
    setup();
    const segunda = await screen.findByRole("listitem", { name: "Segunda" });
    expect(segunda.textContent).toContain("2 faixas");
    expect(screen.getByRole("listitem", { name: "Domingo" }).textContent).toContain("Fechado");
  });

  it("dia sem faixa mostra a nota literal do handoff", async () => {
    setup();
    const domingo = await screen.findByRole("listitem", { name: "Domingo" });
    expect(domingo.textContent).toContain("Sem faixa cadastrada — a loja não abre neste dia.");
  });

  it("a faixa que vira a madrugada é marcada, não recusada", async () => {
    setup();
    const sabado = await screen.findByRole("listitem", { name: "Sábado" });
    expect(sabado.textContent).toContain("vira a madrugada");
  });

  it("acrescentar faixa manda a grade inteira", async () => {
    const api = setup([{ method: "PUT", path: HOURS, body: { openingHours: SEGUNDA_E_SABADO } }]);
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar faixa em quarta" }));
    fireEvent.change(screen.getByLabelText("Quarta: abre (faixa 1)"), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText("Quarta: fecha (faixa 1)"), { target: { value: "23:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "PUT")).toBe(true));
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({
      openingHours: [
        { weekday: 1, opensAt: "11:30", closesAt: "15:00" },
        { weekday: 1, opensAt: "18:00", closesAt: "23:30" },
        { weekday: 3, opensAt: "18:00", closesAt: "23:00" },
        { weekday: 6, opensAt: "18:00", closesAt: "02:00" },
      ],
    });
  });

  it("dia esvaziado sai do corpo", async () => {
    const api = setup([{ method: "PUT", path: HOURS, body: { openingHours: [] } }]);
    fireEvent.click(await screen.findByRole("button", { name: "Remover faixa 1 de sábado" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "PUT")).toBe(true));
    const body = api.calls.find((call) => call.method === "PUT")?.body as {
      openingHours: { weekday: number }[];
    };
    expect(body.openingHours.some((hour) => hour.weekday === 6)).toBe(false);
  });

  it("faixa que começa e termina no mesmo horário nem chega à API", async () => {
    const api = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar faixa em terça" }));
    fireEvent.change(screen.getByLabelText("Terça: abre (faixa 1)"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Terça: fecha (faixa 1)"), { target: { value: "19:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    expect(screen.getByText("A faixa de terça começa e termina no mesmo horário.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("um refetch que falha não troca a grade pela mensagem, e o que foi editado continua lá", async () => {
    signIn();
    const api = mockApi([gradeHandler(SEGUNDA_E_SABADO), ...panelHandlers()]);
    const { queryClient } = renderInPanel(routes, "/horario");
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar faixa em quarta" }));
    fireEvent.change(screen.getByLabelText("Quarta: abre (faixa 1)"), { target: { value: "18:00" } });

    api.add({
      method: "GET",
      path: HOURS,
      status: 503,
      body: { statusCode: 503, error: "Service Unavailable", message: "Fora do ar" },
      once: true,
    });
    await queryClient.refetchQueries({ queryKey: ["opening-hours", RESTAURANT_ID] });

    expect(await screen.findByLabelText("Quarta: abre (faixa 1)")).toBeTruthy();
    expect((screen.getByLabelText("Quarta: abre (faixa 1)") as HTMLInputElement).value).toBe("18:00");
    expect(screen.queryByText("Fora do ar")).toBeNull();
  });

  it("o que se edita durante o PUT em voo não se perde", async () => {
    signIn();
    const put = defer<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api/, "");
      const method = init.method ?? "GET";
      if (method === "GET" && path === "/auth/me") return jsonResponse(makeMe());
      if (method === "GET" && path === `/restaurants/${RESTAURANT_ID}`) return jsonResponse(makeRestaurant());
      if (method === "GET" && path === `/restaurants/${RESTAURANT_ID}/orders`) {
        return jsonResponse({ data: [], limit: 100, offset: 0, total: 0 });
      }
      if (method === "GET" && path === `/restaurants/${RESTAURANT_ID}/orders/summary`) {
        return jsonResponse({
          period: { from: "2026-09-19T03:00:00.000Z", to: "2026-09-20T03:00:00.000Z" },
          counts: {
            pending: 0,
            confirmed: 0,
            preparing: 0,
            ready_for_pickup: 0,
            out_for_delivery: 0,
            completed: 0,
            cancelled: 0,
          },
          revenueInCents: 0,
          revenueOrderCount: 0,
          averageTicketInCents: 0,
        });
      }
      if (method === "GET" && path === HOURS) return jsonResponse({ openingHours: SEGUNDA_E_SABADO });
      if (method === "PUT" && path === HOURS) return put.promise;
      throw new Error(`Chamada sem mock: ${method} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderInPanel(routes, "/horario");
    await screen.findByRole("listitem", { name: "Segunda" });

    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1),
    );

    // Enquanto o PUT está em voo, acrescenta uma faixa nova.
    fireEvent.click(screen.getByRole("button", { name: "Adicionar faixa em quarta" }));
    fireEvent.change(screen.getByLabelText("Quarta: abre (faixa 1)"), { target: { value: "18:00" } });

    // O PUT resolve com a grade que foi enviada (sem a faixa nova).
    put.resolve(jsonResponse({ openingHours: SEGUNDA_E_SABADO }));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Salvar horário" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );

    // A faixa acrescentada depois de clicar salvar continua na tela...
    expect((screen.getByLabelText("Quarta: abre (faixa 1)") as HTMLInputElement).value).toBe("18:00");
    // ...e a barra continua suja, porque ela nunca foi enviada.
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
  });

  it("a pausa no rodapé é o mesmo interruptor do topo", async () => {
    setup();
    expect(await screen.findByRole("switch", { name: "Aceitando pedidos" })).toBeTruthy();
    expect(
      screen.getByText(
        "É o botão de cozinha afogada, e não mexe no horário cadastrado. Ele está sempre na barra do topo — daqui é só o mesmo interruptor.",
      ),
    ).toBeTruthy();
  });
});
