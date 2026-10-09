import { describe, expect, it } from "vitest";
import { detectNewPending, newOrderTitle } from "../src/features/orders/newOrders.ts";
import { makeOrder } from "./fixtures.ts";

describe("detectNewPending", () => {
  it("a primeira carga não é 'novo' — só estabelece o que já se viu", () => {
    const a = makeOrder();
    const result = detectNewPending(null, [a]);
    expect(result.fresh).toEqual([]);
    expect([...result.seen]).toEqual([a.id]);
  });

  it("anuncia só o que não tinha sido visto", () => {
    const a = makeOrder();
    const b = makeOrder();
    const first = detectNewPending(null, [a]);
    const second = detectNewPending(first.seen, [a, b]);
    expect(second.fresh).toEqual([b.id]);
  });

  it("pedido que saiu e voltou à lista não toca de novo", () => {
    const a = makeOrder();
    const first = detectNewPending(null, [a]);
    const gone = detectNewPending(first.seen, []);
    expect(detectNewPending(gone.seen, [a]).fresh).toEqual([]);
  });
});

describe("newOrderTitle", () => {
  it("um pedido: diz o número", () => {
    expect(newOrderTitle([makeOrder({ number: 1042 })])).toBe("Novo pedido #1042");
  });

  it("vários de uma vez: diz quantos", () => {
    expect(newOrderTitle([makeOrder(), makeOrder(), makeOrder()])).toBe("3 pedidos novos");
  });
});
