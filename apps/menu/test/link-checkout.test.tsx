// apps/menu/test/link-checkout.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { type LinkSent, LinkCheckout } from "../src/components/LinkCheckout.tsx";
import type { CartLine } from "../src/lib/cart.ts";
import type { MenuRestaurant } from "../src/lib/types.ts";
import { makeRestaurant } from "./fixtures.ts";

const LINES: CartLine[] = [
  { key: "p-marg|note:", productId: "p-marg", name: "Margherita", unitPriceInCents: 5200, quantity: 1, options: [], note: null },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const RECEIPT = {
  id: "o1",
  number: 42,
  type: "delivery",
  totalInCents: 6100,
  deliveryFeeInCents: 900,
  table: null,
  items: [{ name: "Margherita", quantity: 1, unitPriceInCents: 5200, note: null }],
  trackingToken: "tk-1",
};

/** Rotas falsas da API: cotação e criação, cada uma com a resposta dada. */
function api({ quote = { deliversTo: true, feeInCents: 900, isFree: false, toArrange: false }, order = json(RECEIPT, 201) }: {
  quote?: unknown;
  order?: Response;
} = {}) {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith("/delivery-quote") ? json({ ...(quote as object), servedNeighborhoods: [] }) : order.clone(),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function Harness({ restaurant = makeRestaurant(), onSent = () => {} }: { restaurant?: MenuRestaurant; onSent?: (s: LinkSent) => void }) {
  const [step, setStep] = useState(0);
  return (
    <LinkCheckout
      restaurant={restaurant}
      lines={LINES}
      step={step}
      onStep={setStep}
      onBack={() => setStep((s) => Math.max(0, s - 1))}
      onSent={onSent}
    />
  );
}

const cta = () => screen.getAllByRole("button").at(-1) as HTMLButtonElement;

function fillDetails() {
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11988887777" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

function fillAddress() {
  fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "Centro" } });
  fireEvent.change(screen.getByLabelText("Rua"), { target: { value: "Rua A" } });
  fireEvent.change(screen.getByLabelText("Número"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Complemento"), { target: { value: "apto 2" } });
  fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "01304001" } });
}

describe("finalizar pelo link", () => {
  it("entrega de ponta a ponta: cotação, troco contra o total com frete, envio e o que fica no aparelho", async () => {
    const fetchMock = api();
    const onSent = vi.fn();
    render(<Harness onSent={onSent} />);

    expect(screen.getByText("Passo 1 de 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Entrega/ }));
    fillDetails();
    fillAddress();
    expect(await screen.findByText("Entrega: R$ 9,00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    fireEvent.click(screen.getByRole("radio", { name: "Dinheiro" }));
    fireEvent.change(screen.getByLabelText("Troco para quanto?"), { target: { value: "5000" } });
    // no alerta do campo e no botão travado
    expect(screen.getAllByText("O troco precisa ser no mínimo R$ 61,00")).toHaveLength(2);
    expect(cta().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Troco para quanto?"), { target: { value: "10000" } });
    expect(screen.getByText("R$ 61,00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));

    await waitFor(() => expect(onSent).toHaveBeenCalledOnce());
    const post = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url.endsWith("/orders"));
    expect(JSON.parse(post?.[1].body as string)).toMatchObject({
      type: "delivery",
      paymentMethod: "cash",
      changeForInCents: 10000,
      deliveryAddress: { neighborhood: "Centro", complement: "apto 2", zipCode: "01304-001", city: "São Paulo" },
    });
    expect(JSON.parse(localStorage.getItem("customer") as string).address).toMatchObject({ street: "Rua A", zip: "01304-001" });
    expect(JSON.parse(localStorage.getItem("order:cantina-do-porto") as string)).toMatchObject({ orderId: "o1", token: "tk-1" });
  });

  it("retirada pula o endereço, e o cartão diz 'na retirada'", () => {
    api();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Retirada/ }));
    expect(screen.getByText("Passo 2 de 3")).toBeTruthy();
    fillDetails();
    expect(screen.getByRole("radio", { name: "Cartão na retirada" })).toBeTruthy();
  });

  it("uma modalidade só: o passo da modalidade some", () => {
    api();
    render(<Harness restaurant={makeRestaurant({ isDelivery: false })} />);
    expect(screen.getByText("Passo 1 de 2")).toBeTruthy();
    expect(screen.getByLabelText("Nome")).toBeTruthy();
  });

  it("abaixo do mínimo, a entrega fica desabilitada com o motivo, e a retirada segue", () => {
    api();
    render(<Harness restaurant={makeRestaurant({ minimumOrderInCents: 6000 })} />);
    expect((screen.getByRole("button", { name: /Entrega/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Pedido mínimo para entrega: R$ 60,00")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Retirada/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("não entrega no bairro: 'Trocar para retirada' leva ao pagamento da retirada", async () => {
    api({ quote: { deliversTo: false, feeInCents: null, isFree: false, toArrange: false } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Entrega/ }));
    fillDetails();
    fillAddress();
    fireEvent.click(await screen.findByRole("button", { name: "Trocar para retirada" }));
    expect(screen.getByRole("radio", { name: "Cartão na retirada" })).toBeTruthy();
  });

  it("no modo por bairro, o bairro é uma lista", () => {
    api();
    render(<Harness restaurant={makeRestaurant({ deliveryFeeMode: "neighborhood", deliveryNeighborhoods: ["Centro", "Jardins"] })} />);
    fireEvent.click(screen.getByRole("button", { name: /Entrega/ }));
    fillDetails();
    const bairro = screen.getByLabelText("Bairro");
    expect(bairro.tagName).toBe("SELECT");
    expect([...(bairro as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["Selecione o bairro", "Centro", "Jardins"]);
  });

  // Review Focus 5: a loja mudou entre o carrinho e o envio
  it("409 no envio: mostra a mensagem, não chama onSent, e o botão volta", async () => {
    api({ order: json({ message: "A loja está pausada no momento. Tente de novo mais tarde" }, 409) });
    const onSent = vi.fn();
    render(<Harness onSent={onSent} />);
    fireEvent.click(screen.getByRole("button", { name: /Retirada/ }));
    fillDetails();
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));
    expect(await screen.findByText("A loja está pausada no momento. Tente de novo mais tarde")).toBeTruthy();
    expect(onSent).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Enviar pedido" })).toBeTruthy();
    expect(localStorage.getItem("order:cantina-do-porto")).toBeNull();
  });

  it("'não entrega neste endereço' na criação volta ao passo do endereço", async () => {
    api({ order: json({ message: "A loja não entrega neste endereço" }, 409) });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Entrega/ }));
    fillDetails();
    fillAddress();
    await screen.findByText("Entrega: R$ 9,00");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));
    expect(await screen.findByText("A loja não entrega neste endereço")).toBeTruthy();
    expect(screen.getByLabelText("Rua")).toBeTruthy();
    // revisão final I2: sem sair do laço, a pessoa reenviava para o mesmo 409
    expect(screen.getByRole("button", { name: "Trocar para retirada" })).toBeTruthy();
    expect(cta().disabled).toBe(true);
    expect(screen.queryByText("Entrega: R$ 9,00")).toBeNull();
  });

  // revisão final I1: loja só de entrega pulava o passo que mostra o mínimo, e a
  // pessoa preenchia tudo para levar 409 no "Enviar"
  it("loja só de entrega abaixo do mínimo: trava logo no primeiro passo, com o motivo", () => {
    api();
    render(<Harness restaurant={makeRestaurant({ isTakeaway: false, minimumOrderInCents: 6000 })} />);
    expect(cta().disabled).toBe(true);
    expect(cta().textContent).toBe("Pedido mínimo para entrega: R$ 60,00");
  });

  // revisão final I3: a cotação ainda no ar não pode escrever frete num
  // endereço que ficou incompleto; e digitar não dispara uma cotação por tecla
  it("cotação que chega depois de o endereço ficar incompleto é descartada", async () => {
    let release!: (r: Response) => void;
    const fetchMock = vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          if (url.endsWith("/delivery-quote")) release = resolve;
          else resolve(json(RECEIPT, 201));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Entrega/ }));
    fillDetails();
    fillAddress();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "0130" } });
    release(json({ deliversTo: true, feeInCents: 900, isFree: false, toArrange: false, servedNeighborhoods: [] }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Entrega: R$ 9,00")).toBeNull();
  });

  it("digitar o endereço completo não dispara uma cotação por tecla", async () => {
    const fetchMock = api();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Entrega/ }));
    fillDetails();
    fillAddress();
    for (const street of ["Rua Ab", "Rua Abc", "Rua Abcd"]) {
      fireEvent.change(screen.getByLabelText("Rua"), { target: { value: street } });
    }
    await screen.findByText("Entrega: R$ 9,00");
    const quotes = (fetchMock.mock.calls as unknown as [string][]).filter(([url]) => url.endsWith("/delivery-quote"));
    expect(quotes).toHaveLength(1);
  });
});
