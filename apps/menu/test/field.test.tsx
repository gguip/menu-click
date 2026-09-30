import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckoutScreen } from "../src/components/CheckoutScreen.tsx";
import { FIELD_BOX, FIELD_FOCUS, FIELD_FOCUS_WITHIN } from "../src/components/field.ts";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { ProductScreen } from "../src/components/ProductScreen.tsx";
import { makeMenu, makeRestaurant } from "./fixtures.ts";

const menu = makeMenu();

/** A caixa desenhada: o próprio campo, ou o rótulo que embrulha a busca. */
function box(el: HTMLElement): HTMLElement {
  return el.closest("[data-field]") ?? el;
}

// um padrão só de campo: a busca era pílula cinza com anel grosso, e os
// campos do finalizar eram brancos com borda fina — duas linguagens na mesma tela
describe("campo de texto", () => {
  it("busca, observação, nome e telefone usam a mesma caixa, em 16px (sem zoom do iOS)", () => {
    const fields: HTMLElement[] = [];
    const { unmount: u1 } = render(<MenuApp menu={menu} />);
    fields.push(box(screen.getByRole("searchbox", { name: "Buscar no cardápio" })));
    const searchInput = screen.getByRole("searchbox", { name: "Buscar no cardápio" });
    expect(searchInput.className).toContain("text-base");
    const boxes = fields.map((f) => f.className);
    u1();

    const { unmount: u2 } = render(
      <ProductScreen product={menu.sections[0].products[0]} groups={menu.optionGroups} canOrder onBack={() => {}} onAdd={() => {}} />,
    );
    const note = screen.getByLabelText("Observação");
    boxes.push(note.className);
    expect(note.className).toContain("text-base");
    u2();

    render(<CheckoutScreen restaurant={makeRestaurant()} lines={[]} tableHash={null} onBack={() => {}} onSent={() => {}} />);
    for (const label of ["Nome", "Telefone"]) {
      const input = screen.getByLabelText(label);
      boxes.push(input.className);
      expect(input.className).toContain("text-base");
    }

    const has = (className: string, set: string) => set.split(" ").every((t) => className.split(" ").includes(t));
    for (const className of boxes) {
      expect(has(className, FIELD_BOX), className).toBe(true);
      expect(has(className, FIELD_FOCUS) || has(className, FIELD_FOCUS_WITHIN), className).toBe(true);
    }
  });
});
