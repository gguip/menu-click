import { describe, expect, it } from "vitest";
import { findDuplicate, positionUpdates } from "../src/features/categories/reorder.ts";
import { moveItem } from "../src/lib/moveItem.ts";
import { makeCategory } from "./fixtures.ts";

describe("reordenação de seções", () => {
  it("moveItem move sem mutar", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(items, 2, 3)).toEqual(["a", "b", "c"]);
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("manda PATCH só para quem mudou de posição", () => {
    const a = makeCategory({ id: "a", position: 0 });
    const b = makeCategory({ id: "b", position: 1 });
    const c = makeCategory({ id: "c", position: 2 });
    expect(positionUpdates([b, a, c])).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
    ]);
  });

  it("empate e buraco na posição: renumera tudo o que não bate com o índice", () => {
    // trocar só as duas posições empatadas em 3 não moveria nada
    const a = makeCategory({ id: "a", position: 3 });
    const b = makeCategory({ id: "b", position: 3 });
    expect(positionUpdates([b, a])).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
    ]);
  });

  it("nome repetido não diferencia maiúsculas", () => {
    const list = [makeCategory({ id: "x", name: "Bebidas" })];
    expect(findDuplicate(" bebidas ", list)?.name).toBe("Bebidas");
    expect(findDuplicate("Bebidas", list, "x")).toBeUndefined();
    expect(findDuplicate("Sobremesas", list)).toBeUndefined();
  });
});
