import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { makeMenu } from "./fixtures.ts";

describe("cardápio", () => {
  it("topo, chips, seções e cards", () => {
    render(<MenuApp menu={makeMenu()} tableHash={null} tableLabel={null} tableUnknown={false} />);
    expect(screen.getByRole("heading", { name: "Cantina do Porto" })).toBeTruthy();
    expect(screen.getByText("Aberto até 23h")).toBeTruthy();
    expect(screen.getByText("Pedido mínimo R$ 30,00")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Pizzas" })).toBeTruthy();
    expect(screen.getByText("a partir de")).toBeTruthy();
    expect(screen.getByText("Indisponível hoje")).toBeTruthy();
  });

  it("na mesa: faixa com o rótulo, sem mínimo nem frete grátis", () => {
    render(<MenuApp menu={makeMenu()} tableHash="a7f3" tableLabel="Mesa 7" tableUnknown={false} />);
    expect(screen.getByText("Mesa 7")).toBeTruthy();
    expect(screen.getByText("Pedido no salão")).toBeTruthy();
    expect(screen.queryByText(/Pedido mínimo/)).toBeNull();
  });

  it("mesa não resolveu: aviso discreto, cardápio segue", () => {
    render(<MenuApp menu={makeMenu()} tableHash="velho" tableLabel={null} tableUnknown />);
    expect(
      screen.getByText("Não reconhecemos esta mesa. Você pode pedir normalmente — a loja vai confirmar sua mesa."),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cantina do Porto" })).toBeTruthy();
  });

  it("busca filtra no aparelho", () => {
    render(<MenuApp menu={makeMenu()} tableHash={null} tableLabel={null} tableUnknown={false} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar no cardápio" }), { target: { value: "calab" } });
    expect(screen.getByText("Calabresa")).toBeTruthy();
    expect(screen.queryByText("Margherita")).toBeNull();
  });

  it("fechada: manchete, grade da semana, sem adicionar", () => {
    const menu = makeMenu({ isOpen: false, closesAt: undefined, opensAt: "2026-09-22T21:00:00.000Z" });
    render(<MenuApp menu={menu} tableHash="a7f3" tableLabel="Mesa 7" tableUnknown={false} now={Date.parse("2026-09-21T15:00:00-03:00")} />);
    expect(screen.getByText("Fechado. Abre amanhã às 18h")).toBeTruthy();
    expect(screen.getByText("O cardápio continua visível abaixo — só não dá para pedir.")).toBeTruthy();
  });

  it("pausada: texto sem prometer hora", () => {
    render(<MenuApp menu={makeMenu({ isOpen: false, acceptingOrders: false })} tableHash="a7f3" tableLabel="Mesa 7" tableUnknown={false} />);
    expect(screen.getByText("A loja não está aceitando pedidos no momento")).toBeTruthy();
    expect(screen.getByText("Pode ser uma pausa curta. Vale tentar de novo em alguns minutos.")).toBeTruthy();
  });

  it("cardápio vazio", () => {
    render(<MenuApp menu={makeMenu({}, [])} tableHash={null} tableLabel={null} tableUnknown={false} />);
    expect(screen.getByText("Cardápio ainda não publicado")).toBeTruthy();
  });

  it("a página usa ISR e NÃO lê searchParams no servidor (Review Focus 1)", () => {
    // cwd é apps/menu (o vitest roda do pacote); no jsdom `import.meta.url` não é file:
    const source = readFileSync(resolve(process.cwd(), "src/app/[slug]/page.tsx"), "utf8");
    expect(source).toMatch(/export const revalidate = 60/);
    // sem generateStaticParams a rota dinâmica renderiza a cada requisição e ignora o revalidate
    expect(source).toMatch(/export async function generateStaticParams/);
    expect(source).not.toMatch(/searchParams/);
  });

  it("a cor da marca vira a cor de ação", () => {
    const { container } = render(
      <MenuApp menu={makeMenu({ brandColor: "#0B7A48" })} tableHash={null} tableLabel={null} tableUnknown={false} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--brand-action")).toBe("#0B7A48");
  });
});
