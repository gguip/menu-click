import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { saveCart } from "../src/lib/cart.ts";
import { makeMenu } from "./fixtures.ts";

const menu = makeMenu();
const marg = menu.sections[0].products.find((p) => p.name === "Margherita")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function cartAt(hash: string) {
  saveCart(`cart:cantina-do-porto:${hash}`, [
    { key: `${marg.id}|note:`, productId: marg.id, name: "Margherita", unitPriceInCents: 5200, quantity: 1, options: [], note: null },
  ]);
}

async function sendOrder() {
  fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
  fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11999990000" } });
  fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
  fireEvent.click(screen.getByRole("button", { name: "Enviar para a cozinha" }));
  await screen.findByText("Pedido enviado para a cozinha");
}

function postBody(fetchMock: ReturnType<typeof vi.fn>) {
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
  const post = calls.find(([, init]) => init?.method === "POST");
  return JSON.parse(post?.[1]?.body as string) as Record<string, unknown>;
}

const created = { id: "o1", number: 42, totalInCents: 5200, table: null, items: [{ name: "Margherita", quantity: 1, unitPriceInCents: 5200, options: [], note: null }] };

describe("a mesa do QR", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  // C1 da revisão final: o aviso prometia "pode pedir normalmente" e o
  // carrinho sumia — a mesa que não resolveu tirava a pessoa do salão
  it("mesa inexistente: o aviso é verdade — dá para pedir, sem a mesa no pedido", async () => {
    const fetchMock = vi.fn(async () => json(created, 201));
    vi.stubGlobal("fetch", fetchMock);
    cartAt("velho");
    render(<MenuApp menu={menu} table={{ kind: "not-found", hash: "velho" }} />);
    expect(
      screen.getByText("Não reconhecemos esta mesa. Você pode pedir normalmente — a loja vai confirmar sua mesa."),
    ).toBeTruthy();
    await sendOrder();
    expect(postBody(fetchMock)).not.toHaveProperty("tableHash");
  });

  it("API fora do ar ao resolver: segue no salão e manda o hash — o servidor decide", async () => {
    const fetchMock = vi.fn(async () => json(created, 201));
    vi.stubGlobal("fetch", fetchMock);
    cartAt("a7f3");
    render(<MenuApp menu={menu} table={{ kind: "unreachable", hash: "a7f3" }} />);
    expect(screen.queryByText(/Não reconhecemos esta mesa/)).toBeNull();
    await sendOrder();
    expect(postBody(fetchMock)).toMatchObject({ tableHash: "a7f3" });
  });

  it("lê ?mesa= da URL no navegador e resolve o rótulo", async () => {
    window.history.replaceState(null, "", "/cantina-do-porto?mesa=a7f3");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.includes("/table/a7f3") ? json({ label: "Mesa 7" }) : json({}, 404))),
    );
    cartAt("a7f3");
    render(<MenuApp menu={menu} />);
    expect(await screen.findByText("Mesa 7")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Ver carrinho/ })).toBeTruthy();
  });

  // desde a parte 2, sem mesa é o pedido pelo link: entrega ou retirada
  it("sem ?mesa=: não é salão — sem faixa da mesa, e o carrinho é de entrega ou retirada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    cartAt("link");
    render(<MenuApp menu={menu} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    expect(screen.queryByText("Pedido no salão")).toBeNull();
    expect(screen.getByText("Entrega ou retirada")).toBeTruthy();
  });
});
