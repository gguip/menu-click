import { describe, expect, it } from "vitest";
import {
  byArrival,
  KITCHEN_COLUMNS,
  kitchenAcceptCopy,
  kitchenAction,
  kitchenColumn,
} from "../src/features/kitchen/kitchen.ts";

describe("colunas", () => {
  it("texto literal do protótipo", () => {
    expect(KITCHEN_COLUMNS).toEqual([
      { id: "new", title: "Entraram agora", empty: "Nada novo." },
      { id: "doing", title: "Fazendo", empty: "Bancada limpa." },
    ]);
  });

  it("pendente entra agora; aceito e em preparo são o que se faz; o resto sai da cozinha", () => {
    expect(kitchenColumn("pending")).toBe("new");
    expect(kitchenColumn("confirmed")).toBe("doing");
    expect(kitchenColumn("preparing")).toBe("doing");
    expect(kitchenColumn("out_for_delivery")).toBeNull();
    expect(kitchenColumn("ready_for_pickup")).toBeNull();
    expect(kitchenColumn("completed")).toBeNull();
    expect(kitchenColumn("cancelled")).toBeNull();
  });
});

describe("o botão", () => {
  it("as cinco combinações da spec", () => {
    expect(kitchenAction({ status: "pending", type: "delivery" })).toEqual({
      transition: "accept",
      label: "Aceitar e começar",
    });
    expect(kitchenAction({ status: "confirmed", type: "takeaway" })).toEqual({
      transition: "start-preparing",
      label: "Começar preparo",
    });
    expect(kitchenAction({ status: "preparing", type: "delivery" })).toEqual({
      transition: "dispatch",
      label: "Pronto — despachar",
    });
    expect(kitchenAction({ status: "preparing", type: "takeaway" })).toEqual({
      transition: "ready",
      label: "Pronto para retirada",
    });
    expect(kitchenAction({ status: "preparing", type: "dine_in" })).toEqual({
      transition: "complete",
      label: "Pronto — servir",
    });
    expect(kitchenAction({ status: "completed", type: "dine_in" })).toBeNull();
  });
});

describe("a confirmação de aceite", () => {
  it("não fala de dinheiro nem de cliente", () => {
    const copy = kitchenAcceptCopy({ id: "a3f9c2d1-0000-4000-8000-000000000001" });
    expect(copy.title).toBe("Aceitar o pedido #A3F9?");
    expect(copy.body).toBe("Aceitar manda o pedido para a cozinha e baixa o estoque dos itens.");
    expect(copy.warn).toBe("Não existe desconfirmar. Depois de aceito, só cabe cancelar.");
    expect(copy.cta).toBe("Aceitar pedido");
    expect(JSON.stringify(copy)).not.toMatch(/R\$/);
  });
});

describe("byArrival", () => {
  it("o mais antigo primeiro, sem mexer no original", () => {
    const orders = [
      { id: "b", createdAt: "2026-09-21T12:10:00.000Z" },
      { id: "a", createdAt: "2026-09-21T12:00:00.000Z" },
    ];
    expect(byArrival(orders).map((order) => order.id)).toEqual(["a", "b"]);
    expect(orders[0].id).toBe("b");
  });
});
