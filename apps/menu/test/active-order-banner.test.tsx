// apps/menu/test/active-order-banner.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActiveOrderBanner } from "../src/components/ActiveOrderBanner.tsx";
import { saveActiveOrder } from "../src/lib/active-order.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Review Focus 4: a faixa só aparece para pedido em andamento desta loja
describe("faixa do pedido em andamento", () => {
  it("pedido em andamento: a faixa leva ao acompanhamento", async () => {
    saveActiveOrder("cantina", { orderId: "o1", token: "tk" });
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "o1", status: "preparing" })));
    render(<ActiveOrderBanner slug="cantina" />);
    expect((await screen.findByRole("link", { name: /Acompanhar/ })).getAttribute("href")).toBe("/cantina/pedido/o1?t=tk");
    expect(screen.getByText("Você tem um pedido em andamento")).toBeTruthy();
  });

  it("terminado ou 404: sem faixa, e sai do aparelho", async () => {
    saveActiveOrder("cantina", { orderId: "o1", token: "tk" });
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "o1", status: "completed" })));
    const { unmount } = render(<ActiveOrderBanner slug="cantina" />);
    await waitFor(() => expect(localStorage.getItem("order:cantina")).toBeNull());
    expect(screen.queryByText("Você tem um pedido em andamento")).toBeNull();
    unmount();

    saveActiveOrder("cantina", { orderId: "o1", token: "tk" });
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    render(<ActiveOrderBanner slug="cantina" />);
    await waitFor(() => expect(localStorage.getItem("order:cantina")).toBeNull());
  });

  it("nada guardado: nem consulta a API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ActiveOrderBanner slug="cantina" />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
