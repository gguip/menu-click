import { describe, expect, it, vi } from "vitest";
import { fetchLiveRestaurant, getMenu, resolveTable } from "../src/lib/api.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("API do cardápio", () => {
  it("getMenu junta as páginas de seções e devolve null em 404", async () => {
    // total 101 com teto 100: a segunda página existe de verdade
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/menu/nao-existe")) return json({ message: "x" }, 404);
      if (url.endsWith("/menu/cantina")) return json({ id: "r1", name: "Cantina" });
      if (url.includes("offset=0")) {
        return json({ data: [{ id: "s1", name: "Pizzas", products: [] }], optionGroups: [{ id: "g1" }], limit: 100, offset: 0, total: 101 });
      }
      return json({ data: [{ id: "s2", name: "Bebidas", products: [] }], optionGroups: [{ id: "g2" }], limit: 100, offset: 100, total: 101 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const menu = await getMenu("cantina");
    expect(menu?.sections.map((s) => s.name)).toEqual(["Pizzas", "Bebidas"]);
    expect(menu?.optionGroups.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(await getMenu("nao-existe")).toBeNull();
  });

  // "não existe" (404) e "não deu para saber" (rede, 5xx, 429 com a API
  // acordando) são coisas diferentes: só o primeiro tira a mesa do pedido
  it("resolveTable distingue mesa achada, inexistente e falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/ok")) return json({ label: "Mesa 7" });
        if (url.endsWith("/velho")) return json({}, 404);
        if (url.endsWith("/acordando")) return json({}, 503);
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await resolveTable("cantina", "ok")).toEqual({ kind: "found", label: "Mesa 7" });
    expect(await resolveTable("cantina", "velho")).toEqual({ kind: "not-found" });
    expect(await resolveTable("cantina", "acordando")).toEqual({ kind: "unreachable" });
    expect(await resolveTable("cantina", "sem-rede")).toEqual({ kind: "unreachable" });
  });

  // resposta 200 sem o status (proxy, página de erro) não pode trocar o
  // cardápio da página por um objeto qualquer — foi o que escondeu o carrinho
  it("fetchLiveRestaurant descarta resposta sem isOpen/acceptingOrders", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "o1", number: 42 })));
    expect(await fetchLiveRestaurant("cantina")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => json({ isOpen: false, acceptingOrders: true })));
    expect(await fetchLiveRestaurant("cantina")).toMatchObject({ isOpen: false });
  });
});
