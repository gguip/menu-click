import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { activeSectionIndex, overflowEdges } from "../src/lib/tabs.ts";
import { makeMenu } from "./fixtures.ts";

describe("abas de seção", () => {
  it("a ativa é a última seção cujo topo já passou da barra fixa", () => {
    // topos relativos à janela; a barra fixa termina em 90px
    expect(activeSectionIndex([100, 600, 1200], 90)).toBe(0);
    expect(activeSectionIndex([-300, 80, 700], 90)).toBe(1);
    expect(activeSectionIndex([-900, -400, 20], 90)).toBe(2);
    expect(activeSectionIndex([], 90)).toBe(0);
  });

  // a última seção é curta e a página acaba antes de o topo dela chegar à
  // barra: no fim da página, é ela que está na tela
  it("no fim da página, a ativa é a última", () => {
    expect(activeSectionIndex([-900, -400, 300], 90, true)).toBe(2);
    expect(activeSectionIndex([-900, -400, 300], 90, false)).toBe(1);
  });

  it("diz se ainda há abas escondidas de cada lado", () => {
    expect(overflowEdges(0, 390, 390)).toEqual({ left: false, right: false });
    expect(overflowEdges(0, 390, 800)).toEqual({ left: false, right: true });
    expect(overflowEdges(200, 390, 800)).toEqual({ left: true, right: true });
    // o arredondamento do navegador deixa meio pixel sobrando no fim
    expect(overflowEdges(409.5, 390, 800)).toEqual({ left: true, right: false });
  });

  // ponto menor da revisão final: as abas usavam a lista inteira e as âncoras
  // a filtrada, e durante a busca a aba rolava para a seção errada
  it("durante a busca, as abas são as das seções que sobraram", () => {
    render(<MenuApp menu={makeMenu()} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Pizzas", "Bebidas"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar no cardápio" }), { target: { value: "água" } });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Bebidas"]);
    expect(screen.getByRole("tab", { name: "Bebidas" }).getAttribute("aria-selected")).toBe("true");
  });
});
