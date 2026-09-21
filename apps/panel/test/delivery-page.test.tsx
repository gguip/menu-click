import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeliveryPage } from "../src/features/settings/DeliveryPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeRestaurant, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";
import type { DeliveryNeighborhood, Restaurant } from "../src/api/types.ts";

const RESTAURANT = `/restaurants/${RESTAURANT_ID}`;
const NEIGHBORHOODS = `${RESTAURANT}/delivery-neighborhoods`;
const routes = [{ path: "/entrega", element: <DeliveryPage /> }];

function setup(
  extra: MockHandler[],
  { restaurant = {}, neighborhoods = [] }: { restaurant?: Partial<Restaurant>; neighborhoods?: DeliveryNeighborhood[] } = {},
) {
  signIn();
  const api = mockApi([
    ...extra,
    { method: "GET", path: NEIGHBORHOODS, body: { neighborhoods } },
    ...panelHandlers({ restaurant }),
  ]);
  renderInPanel(routes, "/entrega");
  return api;
}

function addBairro(name: string, fee: string) {
  fireEvent.change(screen.getByLabelText("Novo bairro"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Frete do novo bairro"), { target: { value: fee } });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar bairro" }));
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Salvar entrega" }));
}

describe("DeliveryPage", () => {
  it("salva os bairros antes do restaurante", async () => {
    const saved = [
      { name: "Centro", feeInCents: 500 },
      { name: "Vila Madalena", feeInCents: 800 },
    ];
    const api = setup([
      { method: "PUT", path: NEIGHBORHOODS, body: { neighborhoods: saved } },
      { method: "PATCH", path: RESTAURANT, body: makeRestaurant({ deliveryFeeMode: "neighborhood" }) },
    ]);
    fireEvent.click(await screen.findByRole("radio", { name: "Por bairro" }));
    addBairro("Centro", "5,00");
    addBairro("Vila Madalena", "8,00");
    save();
    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    const put = api.calls.findIndex((call) => call.method === "PUT");
    const patch = api.calls.findIndex((call) => call.method === "PATCH");
    expect(put).toBeGreaterThanOrEqual(0);
    expect(put).toBeLessThan(patch);
    expect(api.calls[put].body).toEqual({ neighborhoods: saved });
    expect(api.calls[patch].body).toEqual({ deliveryFeeMode: "neighborhood" });
  });

  it("PATCH que falha deixa os bairros salvos e a barra suja só no que faltou", async () => {
    const api = setup([
      { method: "PUT", path: NEIGHBORHOODS, body: { neighborhoods: [{ name: "Centro", feeInCents: 500 }] } },
      { method: "PATCH", path: RESTAURANT, status: 500, body: { message: "Algo deu errado no servidor" } },
    ]);
    fireEvent.click(await screen.findByRole("radio", { name: "Por bairro" }));
    addBairro("Centro", "5,00");
    save();
    expect(await screen.findByText("Algo deu errado no servidor")).toBeTruthy();
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();

    save();
    await waitFor(() => expect(api.calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    expect(api.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("bairro repetido é barrado antes de qualquer chamada", async () => {
    const api = setup([], {
      restaurant: { deliveryFeeMode: "neighborhood" },
      neighborhoods: [{ name: "Vila Madalena", feeInCents: 800 }],
    });
    await screen.findByText("Vila Madalena");
    addBairro("vila madalena ", "5,00");
    expect(await screen.findByText('O bairro "vila madalena" já está na lista.')).toBeTruthy();
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(api.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("por distância aparece desabilitado", async () => {
    setup([]);
    const distance = (await screen.findByRole("radio", { name: "Por distância" })) as HTMLInputElement;
    expect(distance.disabled).toBe(true);
  });

  it("o aviso do topo segue o que está salvo, não o que está sendo digitado", async () => {
    setup([], { restaurant: { deliveryFeeMode: "neighborhood" }, neighborhoods: [] });
    expect(await screen.findByText("Entrega por bairro sem nenhum bairro cadastrado")).toBeTruthy();
    addBairro("Centro", "5,00");
    expect(screen.getByText("Entrega por bairro sem nenhum bairro cadastrado")).toBeTruthy();
  });

  it("escolher 'por bairro' sem salvar não liga o aviso do topo", async () => {
    setup([], { restaurant: { deliveryFeeMode: "fixed" }, neighborhoods: [] });
    fireEvent.click(await screen.findByRole("radio", { name: "Por bairro" }));
    expect(screen.getByText("Nenhum bairro cadastrado")).toBeTruthy();
    expect(screen.queryByText("Entrega por bairro sem nenhum bairro cadastrado")).toBeNull();
  });

  it("a ajuda do 'a combinar' troca com o interruptor", async () => {
    setup([], { restaurant: { deliveryFeeToArrange: false } });
    expect(await screen.findByText(/é recusado na hora/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Aceitar pedido com frete a combinar" }));
    expect(screen.getByText(/o valor é acertado por telefone/)).toBeTruthy();
  });

  it("esvaziar 'grátis acima de' manda null", async () => {
    const api = setup(
      [{ method: "PATCH", path: RESTAURANT, body: makeRestaurant() }],
      { restaurant: { freeDeliveryAboveInCents: 5000 } },
    );
    fireEvent.change(await screen.findByLabelText("Entrega grátis acima de"), { target: { value: "" } });
    save();
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ freeDeliveryAboveInCents: null }),
    );
  });
});
