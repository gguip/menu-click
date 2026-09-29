import { describe, expect, it, vi } from "vitest";
import { getMenu, resolveTable } from "../src/lib/api.ts";

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

  it("resolveTable devolve o rótulo, ou null quando a mesa não existe", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/ok") ? json({ label: "Mesa 7" }) : json({}, 404))));
    expect(await resolveTable("cantina", "ok")).toBe("Mesa 7");
    expect(await resolveTable("cantina", "velho")).toBeNull();
  });
});
