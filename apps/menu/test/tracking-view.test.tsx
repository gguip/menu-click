// apps/menu/test/tracking-view.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrackingView } from "../src/components/TrackingView.tsx";
import { saveActiveOrder } from "../src/lib/active-order.ts";
import { makeRestaurant } from "./fixtures.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** WebSocket falso: abre logo depois de criado. */
class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }
  close() {}
}

const DELIVERY = {
  id: "o1",
  number: 42,
  type: "delivery",
  status: "preparing",
  totalInCents: 6100,
  deliveryFeeInCents: 900,
  paymentMethod: "pix",
  items: [{ name: "Margherita", quantity: 1, unitPriceInCents: 5200, options: [{ name: "Borda catupiry" }], note: "sem cebola" }],
  statusHistory: [
    { status: "pending", at: "2026-09-30T21:00:00.000Z" },
    { status: "confirmed", at: "2026-09-30T21:02:00.000Z" },
    { status: "preparing", at: "2026-09-30T21:05:00.000Z" },
  ],
  estimate: { from: "2026-09-30T21:42:00.000Z", to: "2026-09-30T21:57:00.000Z" },
  cancellationReason: null,
};

describe("página de acompanhamento", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("mostra etapa, previsão, trilha com horários, itens e o tempo real", async () => {
    window.history.replaceState(null, "", "/cantina-do-porto/pedido/o1?t=tk-1");
    vi.stubGlobal("fetch", vi.fn(async () => json(DELIVERY)));
    vi.stubGlobal("WebSocket", FakeSocket);
    render(<TrackingView restaurant={makeRestaurant()} orderId="o1" />);
    expect(await screen.findByRole("heading", { name: "Preparando" })).toBeTruthy();
    expect(screen.getByText("Previsão de entrega: 18:42 – 18:57")).toBeTruthy();
    expect(screen.getByText("18:05")).toBeTruthy();
    expect(screen.getByText("Borda catupiry")).toBeTruthy();
    expect(screen.getByText("Obs.: sem cebola")).toBeTruthy();
    expect(screen.getByText("R$ 61,00")).toBeTruthy();
    expect(await screen.findByText("Atualizando em tempo real")).toBeTruthy();
  });

  it("cancelado mostra o motivo e tira o pedido guardado do aparelho", async () => {
    window.history.replaceState(null, "", "/cantina-do-porto/pedido/o1?t=tk-1");
    saveActiveOrder("cantina-do-porto", { orderId: "o1", token: "tk-1" });
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...DELIVERY, status: "cancelled", cancellationReason: "Acabou o salmão" })));
    vi.stubGlobal("WebSocket", FakeSocket);
    render(<TrackingView restaurant={makeRestaurant()} orderId="o1" />);
    expect(await screen.findByRole("heading", { name: "Pedido cancelado" })).toBeTruthy();
    expect(screen.getByText("Acabou o salmão")).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem("order:cantina-do-porto")).toBeNull());
  });

  it("sem token ou com token que não vale: 'Não encontramos este pedido'", async () => {
    window.history.replaceState(null, "", "/cantina-do-porto/pedido/o1");
    vi.stubGlobal("WebSocket", FakeSocket);
    render(<TrackingView restaurant={makeRestaurant()} orderId="o1" />);
    expect(await screen.findByText("Não encontramos este pedido")).toBeTruthy();
  });

  it("retirada mostra o número do pedido e onde retirar", async () => {
    window.history.replaceState(null, "", "/cantina-do-porto/pedido/o1?t=tk-1");
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...DELIVERY, type: "takeaway", deliveryFeeInCents: null, estimate: null })));
    vi.stubGlobal("WebSocket", FakeSocket);
    render(<TrackingView restaurant={makeRestaurant()} orderId="o1" />);
    expect(await screen.findByText("Pedido #42")).toBeTruthy();
    expect(screen.getByText("Retire em Rua do Porto, 120 — Centro")).toBeTruthy();
  });
});
