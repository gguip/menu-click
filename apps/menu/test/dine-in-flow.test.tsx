import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { saveCart } from "../src/lib/cart.ts";
import { makeMenu } from "./fixtures.ts";

const menu = makeMenu();
const marg = menu.sections[0].products.find((p) => p.name === "Margherita")!;

function withCart() {
  saveCart("cart:cantina-do-porto:a7f3", [
    { key: `${marg.id}|note:sem cebola`, productId: marg.id, name: "Margherita", unitPriceInCents: 5200, quantity: 2, options: [], note: "sem cebola" },
  ]);
  render(<MenuApp menu={menu} table={{ kind: "found", hash: "a7f3", label: "Mesa 7" }} />);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("pedido no salão", () => {
  it("do carrinho ao enviado, com mesa, observação e pagamento", async () => {
    const fetchMock = vi.fn(async () =>
      json({ id: "o1", number: 42, totalInCents: 10400, table: { id: "t7", label: "Mesa 7" }, items: [{ name: "Margherita", quantity: 2, unitPriceInCents: 5200, options: [], note: "sem cebola" }] }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);
    withCart();

    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    expect(screen.getByText("Mesa 7")).toBeTruthy();
    expect(screen.getByText("sem cebola")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));

    const send = () => screen.getByRole("button", { name: /Enviar para a cozinha|Informe|Escolha/ });
    expect(send().textContent).toBe("Informe seu nome");
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "(11) 99999-0000" } });
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar para a cozinha" }));

    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeTruthy();
    expect(screen.getByText("É só aguardar na Mesa 7. A comida chega até você.")).toBeTruthy();
    // a primeira chamada é o GET do status ao vivo; o pedido é o POST
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
    const post = calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(post?.[1]?.body as string);
    expect(body).toMatchObject({
      type: "dine_in",
      tableHash: "a7f3",
      paymentMethod: "pix",
      customer: { name: "Ana", phone: "(11) 99999-0000" },
      items: [{ productId: marg.id, quantity: 2, note: "sem cebola" }],
    });
    expect(localStorage.getItem("cart:cantina-do-porto:a7f3")).toBeNull();
  });

  it("409 da API (loja pausou no meio): mostra a mensagem e mantém o carrinho", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "A loja não está aceitando pedidos no momento" }, 409)));
    withCart();
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11999990000" } });
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar para a cozinha" }));
    expect(await screen.findByText("A loja não está aceitando pedidos no momento")).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem("cart:cantina-do-porto:a7f3")).not.toBeNull());
  });

  // I2 da revisão final: o comprovante somava o carrinho do aparelho, com
  // preço de uma página em cache — e o caixa cobra o que o servidor gravou
  it("o comprovante mostra o que a loja gravou, e avisa quando o total mudou", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ id: "o1", number: 42, totalInCents: 11600, table: { id: "t7", label: "Mesa 7" }, items: [{ name: "Margherita", quantity: 2, unitPriceInCents: 5800, options: [], note: "sem cebola" }] }, 201),
      ),
    );
    withCart();
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11999990000" } });
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar para a cozinha" }));
    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeTruthy();
    expect(screen.getAllByText("R$ 116,00").length).toBeGreaterThan(0);
    expect(screen.queryByText("R$ 104,00")).toBeNull();
    expect(screen.getByText("O total mudou: a loja atualizou o preço de algum item. Vale o valor acima.")).toBeTruthy();
  });

  it("pedido que saiu sem mesa pede para avisar o garçom", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ id: "o1", number: 42, totalInCents: 10400, table: null, items: [{ name: "Margherita", quantity: 2, unitPriceInCents: 5200, options: [], note: "sem cebola" }] }, 201),
      ),
    );
    withCart();
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11999990000" } });
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar para a cozinha" }));
    expect(await screen.findByText("É só aguardar. Avise o garçom em qual mesa você está.")).toBeTruthy();
  });

  async function checkout() {
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11999990000" } });
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar para a cozinha" }));
  }

  it("carrinho guardado com preço velho abre com o preço de agora e avisa", async () => {
    saveCart("cart:cantina-do-porto:a7f3", [
      { key: `${marg.id}|note:`, productId: marg.id, name: "Margherita", unitPriceInCents: 4000, quantity: 1, options: [], note: null },
    ]);
    render(<MenuApp menu={menu} table={{ kind: "found", hash: "a7f3", label: "Mesa 7" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    expect(screen.getByText("Atualizamos seu carrinho com o cardápio de agora.")).toBeTruthy();
    expect(screen.getAllByText("R$ 52,00").length).toBeGreaterThan(0);
  });

  it("produto removido depois do cache (404): mensagem para gente, sem id, e saída", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: 'Produto com id "8f3c0a52" não encontrado' }, 404)));
    withCart();
    await checkout();
    expect(await screen.findByText("Algum item do seu carrinho saiu do cardápio.")).toBeTruthy();
    expect(screen.queryByText(/8f3c0a52/)).toBeNull();
    expect(screen.getByRole("button", { name: "Atualizar o cardápio" })).toBeTruthy();
  });

  it("código da mesa girou entre abrir e enviar: reenvia sem a mesa", async () => {
    const receipt = { id: "o1", number: 42, totalInCents: 10400, table: null, items: [{ name: "Margherita", quantity: 2, unitPriceInCents: 5200, options: [], note: "sem cebola" }] };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return json({}, 404);
      const body = JSON.parse(init.body as string) as { tableHash?: string };
      return body.tableHash ? json({ message: "Mesa não encontrada neste restaurante" }, 400) : json(receipt, 201);
    });
    vi.stubGlobal("fetch", fetchMock);
    withCart();
    await checkout();
    expect(await screen.findByText("É só aguardar. Avise o garçom em qual mesa você está.")).toBeTruthy();
    const posts = (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[1][1]?.body as string)).not.toHaveProperty("tableHash");
  });

  it("carrinho vazio orienta de volta ao cardápio", async () => {
    render(<MenuApp menu={menu} table={{ kind: "found", hash: "a7f3", label: "Mesa 7" }} initialScreen="cart" />);
    expect(screen.getByText("Carrinho vazio")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver cardápio" })).toBeTruthy();
  });
});
