import { describe, expect, it } from "vitest";
import { ACTIVE_ORDER_TTL_MS, clearActiveOrder, loadActiveOrder, saveActiveOrder } from "../src/lib/active-order.ts";

const NOW = Date.parse("2026-09-30T19:00:00Z");
const ORDER = { orderId: "o1", token: "t1" };

// Review Focus 4: o guardado é por loja, vence em 24 h e some ao limpar
describe("pedido em andamento no aparelho", () => {
  it("guarda por loja e devolve só para a mesma loja", () => {
    saveActiveOrder("cantina", ORDER, NOW);
    expect(loadActiveOrder("cantina", NOW + 1000)).toEqual(ORDER);
    expect(loadActiveOrder("outra-loja", NOW + 1000)).toBeNull();
  });

  it("vence em 24 h, e aí sai do aparelho", () => {
    saveActiveOrder("cantina", ORDER, NOW);
    expect(loadActiveOrder("cantina", NOW + ACTIVE_ORDER_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem("order:cantina")).toBeNull();
  });

  it("limpar apaga, e valor adulterado é nada", () => {
    saveActiveOrder("cantina", ORDER, NOW);
    clearActiveOrder("cantina");
    expect(loadActiveOrder("cantina", NOW)).toBeNull();
    localStorage.setItem("order:cantina", '{"orderId":1}');
    expect(loadActiveOrder("cantina", NOW)).toBeNull();
  });
});
