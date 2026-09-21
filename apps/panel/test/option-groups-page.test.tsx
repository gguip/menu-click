import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OptionGroupsPage } from "../src/features/optionGroups/OptionGroupsPage.tsx";
import type { OptionGroup, Product } from "../src/api/types.ts";
import { mockApi } from "./api-mock.ts";
import { makeOptionGroup, makeProduct, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;
const routes = [{ path: "/grupos-de-opcoes", element: <OptionGroupsPage /> }];

const opt = (id: string, name: string, priceInCents: number, available = true) => ({
  id,
  name,
  priceInCents,
  maxQuantity: 1,
  available,
  position: 0,
});

function groupsSetup(groups: OptionGroup[], products: Product[]) {
  signIn();
  const api = mockApi([
    { method: "GET", path: `${BASE}/option-groups`, body: { data: groups, limit: 100, offset: 0, total: groups.length } },
    { method: "GET", path: `${BASE}/products`, body: { data: products, limit: 100, offset: 0, total: products.length } },
    ...panelHandlers(),
  ]);
  renderInPanel(routes, "/grupos-de-opcoes");
  return api;
}

describe("OptionGroupsPage (leitura)", () => {
  it("o cartão de regras traz os três exemplos literais", async () => {
    groupsSetup([], []);
    expect(await screen.findByText("Regra de preço — a escolha que muda o valor final")).toBeTruthy();
    expect(screen.getByText("Bacon R$ 6,00 + Ovo R$ 3,00 = R$ 9,00")).toBeTruthy();
    expect(screen.getByText("Margherita R$ 62 + Calabresa R$ 72 = R$ 72,00")).toBeTruthy();
    expect(screen.getByText("Margherita R$ 62 + Calabresa R$ 72 = R$ 67,00")).toBeTruthy();
  });

  it("cada grupo mostra intervalo, regra, uso e as opções", async () => {
    groupsSetup(
      [
        makeOptionGroup({
          id: "grp-1",
          name: "Sabores",
          minOptions: 1,
          maxOptions: 2,
          priceRule: "highest",
          options: [opt("o1", "Margherita", 6200), opt("o2", "Calabresa", 7200)],
        }),
        makeOptionGroup({ id: "grp-2", name: "Tamanho", minOptions: 1, maxOptions: 1, priceRule: "sum" }),
        makeOptionGroup({ id: "grp-3", name: "Borda", minOptions: 0, maxOptions: 1, priceRule: "sum" }),
      ],
      [
        makeProduct({ id: "p1", optionGroupIds: ["grp-1", "grp-2"] }),
        makeProduct({ id: "p2", optionGroupIds: ["grp-1"] }),
      ],
    );
    const sabores = within(await screen.findByRole("region", { name: "Sabores" }));
    expect(sabores.getByText("escolhe 1 a 2")).toBeTruthy();
    expect(sabores.getByText("Mais caro")).toBeTruthy();
    expect(await sabores.findByText("usado em 2 produtos")).toBeTruthy();
    expect(sabores.getByText("Calabresa")).toBeTruthy();
    expect(sabores.getByText(/72,00/)).toBeTruthy();

    const tamanho = within(screen.getByRole("region", { name: "Tamanho" }));
    expect(tamanho.getByText("escolhe 1")).toBeTruthy();
    expect(await tamanho.findByText("usado em 1 produto")).toBeTruthy();

    expect(await within(screen.getByRole("region", { name: "Borda" })).findByText("sem produtos")).toBeTruthy();
  });

  it("avisa quando o mínimo passa das opções disponíveis", async () => {
    groupsSetup(
      [
        makeOptionGroup({
          name: "Sabores",
          minOptions: 2,
          options: [opt("o1", "Margherita", 6200), opt("o2", "Calabresa", 7200, false)],
        }),
      ],
      [],
    );
    expect(
      await screen.findByText(
        "O cliente não consegue completar este grupo: ele exige 2 escolhas e só 1 opção está disponível.",
      ),
    ).toBeTruthy();
  });
});
