import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModalitiesPage } from "../src/features/settings/ModalitiesPage.tsx";
import { mockApi } from "./api-mock.ts";
import { makeRestaurant, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const routes = [{ path: "/modalidades", element: <ModalitiesPage /> }];

function toggle(name: string) {
  return screen.getByRole("switch", { name });
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
    expect(await screen.findByText("Entrega ligada, mas o frete não está configurado")).toBeTruthy();
  });
});
