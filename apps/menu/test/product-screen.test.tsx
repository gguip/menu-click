import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductScreen } from "../src/components/ProductScreen.tsx";
import { makeMenu } from "./fixtures.ts";

const menu = makeMenu();
const meio = menu.sections[0].products.find((p) => p.name === "Meio a meio")!;

describe("produto", () => {
  it("trava dizendo o que falta, libera ao completar, total ao vivo", () => {
    const onAdd = vi.fn();
    render(<ProductScreen product={meio} groups={menu.optionGroups} canOrder onBack={() => {}} onAdd={onAdd} />);
    const locked = screen.getByRole("button", { name: "Escolha 2 em Sabores" });
    expect(locked.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /Margherita/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Quatro queijos/ }));
    expect(screen.getByText("R$ 80,00")).toBeTruthy(); // 30 + mais caro (50)

    fireEvent.click(screen.getByRole("button", { name: "Aumentar quantidade" }));
    expect(screen.getByText("R$ 160,00")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Observação"), { target: { value: "sem cebola" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ao carrinho" }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ productId: meio.id, quantity: 2, unitPriceInCents: 8000, note: "sem cebola" }),
    );
  });

  it("sem poder pedir (fechada ou sem mesa), não há botão de adicionar", () => {
    render(<ProductScreen product={meio} groups={menu.optionGroups} canOrder={false} onBack={() => {}} onAdd={() => {}} />);
    expect(screen.queryByRole("button", { name: /carrinho|Escolha/ })).toBeNull();
  });
});
