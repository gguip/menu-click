import { describe, expect, it } from "vitest";
import type { OrderStatus, OrderType } from "../src/api/types.ts";
import {
  acceptCopy,
  cancelCopy,
  cancelKind,
  cancelLabel,
  closedMessage,
  columnOf,
  groupByColumn,
  primaryAction,
  progressSteps,
} from "../src/features/orders/orderRules.ts";
import { makeOrder, makeOrderDetail } from "./fixtures.ts";

const ID = "a3f9c2d1-0000-4000-8000-000000000001";
const TZ = "America/Sao_Paulo";

describe("colunas do kanban", () => {
  it("cada status mora numa coluna", () => {
    const expected: Record<OrderStatus, string> = {
      pending: "new",
      confirmed: "preparing",
      preparing: "preparing",
      out_for_delivery: "ready",
      ready_for_pickup: "ready",
      completed: "done",
      cancelled: "done",
    };
    for (const [status, column] of Object.entries(expected)) {
      expect(columnOf(status as OrderStatus)).toBe(column);
    }
  });

  it("status desconhecido cai em Finalizados, em vez de estourar (FIX 6)", () => {
    expect(columnOf("shipped" as OrderStatus)).toBe("done");
  });

  it("agrupa preservando a ordem recebida", () => {
    const a = makeOrder({ status: "pending" });
    const b = makeOrder({ status: "completed" });
    const c = makeOrder({ status: "pending" });
    const groups = groupByColumn([a, b, c]);
    expect(groups.new.map((o) => o.id)).toEqual([a.id, c.id]);
    expect(groups.done.map((o) => o.id)).toEqual([b.id]);
    expect(groups.preparing).toEqual([]);
  });
});

describe("ação principal", () => {
  const cases: [OrderType, OrderStatus, string | null][] = [
    ["delivery", "pending", "accept"],
    ["delivery", "confirmed", "start-preparing"],
    ["delivery", "preparing", "dispatch"],
    ["takeaway", "preparing", "ready"],
    ["dine_in", "preparing", "complete"],
    ["delivery", "out_for_delivery", "complete"],
    ["takeaway", "ready_for_pickup", "complete"],
    ["delivery", "completed", null],
    ["takeaway", "cancelled", null],
  ];
  it.each(cases)("%s em %s → %s", (type, status, transition) => {
    expect(primaryAction({ type, status })?.transition ?? null).toBe(transition);
  });

  it("os rótulos mudam com a modalidade", () => {
    expect(primaryAction({ type: "delivery", status: "preparing" })).toMatchObject({
      label: "Saiu para entrega",
      cardLabel: "Despachar",
    });
    expect(primaryAction({ type: "takeaway", status: "preparing" })).toMatchObject({
      label: "Pronto para retirada",
      cardLabel: "Pronto",
    });
    expect(primaryAction({ type: "dine_in", status: "preparing" })).toMatchObject({
      label: "Concluir pedido",
      cardLabel: "Concluir",
    });
    expect(primaryAction({ type: "delivery", status: "pending" })).toMatchObject({
      label: "Aceitar pedido",
      cardLabel: "Aceitar",
      note: "Aceitar baixa o estoque e não pode ser desfeito.",
    });
  });
});

describe("cancelamento — três textos, porque errar sobre o estoque é o erro mais caro", () => {
  it("pedido novo é recusa: o estoque nunca foi baixado", () => {
    const order = makeOrder({ id: ID, number: 1042, status: "pending" });
    expect(cancelKind("pending")).toBe("refuse");
    expect(cancelCopy(order)).toEqual({
      title: "Recusar o pedido #1042?",
      body: "O pedido sai da lista. O estoque não tinha sido baixado, então nada muda nele.",
      cta: "Recusar pedido",
      tone: "danger",
    });
  });

  it("antes de pronto devolve o estoque", () => {
    const order = makeOrder({ id: ID, number: 1042, status: "preparing" });
    expect(cancelCopy(order)).toEqual({
      title: "Cancelar o pedido #1042?",
      body: "O pedido #1042 sai da lista e as unidades voltam para o estoque.",
      cta: "Cancelar e devolver estoque",
      tone: "danger",
    });
  });

  it("depois de pronto NÃO devolve", () => {
    for (const status of ["out_for_delivery", "ready_for_pickup"] as const) {
      expect(cancelCopy(makeOrder({ id: ID, number: 1042, status }))).toEqual({
        title: "Cancelar sem devolver o estoque?",
        body: "A comida do pedido #1042 já ficou pronta. As unidades usadas não voltam para o estoque — só o pedido sai da lista.",
        warn: "O estoque NÃO será devolvido.",
        cta: "Cancelar sem devolver",
        tone: "danger",
      });
    }
  });

  it("pedido encerrado não cancela", () => {
    expect(cancelCopy(makeOrder({ status: "completed" }))).toBeNull();
    expect(cancelKind("cancelled")).toBeNull();
  });

  it("os botões dizem o que vai acontecer", () => {
    expect(cancelLabel("refuse")).toBe("Recusar pedido");
    expect(cancelLabel("return-stock")).toBe("Cancelar pedido");
    expect(cancelLabel("keep-stock")).toBe("Cancelar (sem devolver estoque)");
  });
});

describe("aceite", () => {
  it("avisa que não existe desconfirmar", () => {
    const order = makeOrder({ id: ID, number: 1042, totalInCents: 10100 });
    expect(acceptCopy(order)).toEqual({
      title: "Aceitar o pedido #1042?",
      body: "Marcela Andrade · R$ 101,00. Aceitar manda o pedido para a cozinha e baixa o estoque dos itens.",
      warn: "Não existe desconfirmar. Depois de aceito, só cabe cancelar.",
      cta: "Aceitar pedido",
      tone: "accent",
    });
  });

  it("pedido de mesa se identifica pela mesa", () => {
    const order = makeOrder({ id: ID, number: 1042, type: "dine_in", table: { id: "t7", label: "Mesa 7" } });
    expect(acceptCopy(order).body.startsWith("Mesa 7 · ")).toBe(true);
  });
});

describe("andamento", () => {
  const at = (status: OrderStatus, iso: string) => ({ status, at: iso });

  it("cada etapa leva a hora do primeiro status dela; as futuras, sem hora", () => {
    const order = makeOrderDetail({
      type: "delivery",
      status: "preparing",
      statusHistory: [
        at("pending", "2026-09-19T22:58:00.000Z"),
        at("confirmed", "2026-09-19T23:01:00.000Z"),
        at("preparing", "2026-09-19T23:02:00.000Z"),
      ],
    });
    expect(progressSteps(order, TZ)).toEqual([
      { label: "Novo", state: "done", time: "19:58" },
      { label: "Em preparo", state: "current", time: "20:01" },
      { label: "Saiu para entrega", state: "future", time: null },
      { label: "Concluído", state: "future", time: null },
    ]);
  });

  it("pedido antigo sem as etapas do meio: sem hora, nunca inventada", () => {
    const order = makeOrderDetail({
      type: "dine_in",
      status: "completed",
      statusHistory: [at("pending", "2026-09-19T22:58:00.000Z"), at("completed", "2026-09-19T23:40:00.000Z")],
    });
    expect(progressSteps(order, TZ)).toEqual([
      { label: "Novo", state: "done", time: "19:58" },
      { label: "Em preparo", state: "done", time: null },
      { label: "Concluído", state: "current", time: "20:40" },
    ]);
  });

  it("retirada tem 'Pronto para retirada'", () => {
    const order = makeOrderDetail({ type: "takeaway", status: "ready_for_pickup" });
    expect(progressSteps(order, TZ)[2]).toMatchObject({ label: "Pronto para retirada", state: "current" });
  });

  it("cancelado mostra quando entrou e quando foi cancelado", () => {
    const order = makeOrderDetail({
      status: "cancelled",
      statusHistory: [at("pending", "2026-09-19T22:58:00.000Z"), at("cancelled", "2026-09-19T23:10:00.000Z")],
    });
    expect(progressSteps(order, TZ)).toEqual([
      { label: "Novo", state: "done", time: "19:58" },
      { label: "Cancelado", state: "current", time: "20:10" },
    ]);
  });

  it("concluído e cancelado dizem a hora do evento; em andamento, nada", () => {
    const done = makeOrderDetail({
      status: "completed",
      statusHistory: [at("pending", "2026-09-19T22:58:00.000Z"), at("completed", "2026-09-19T23:10:00.000Z")],
    });
    const cancelled = makeOrderDetail({
      status: "cancelled",
      statusHistory: [at("pending", "2026-09-19T22:58:00.000Z"), at("cancelled", "2026-09-19T23:05:00.000Z")],
    });
    expect(closedMessage(done, TZ)).toBe("Pedido concluído às 20:10. Não há mais ação possível.");
    expect(closedMessage(cancelled, TZ)).toBe("Pedido cancelado às 20:05. Não há mais ação possível.");
    expect(closedMessage(makeOrderDetail({ status: "preparing" }), TZ)).toBeNull();
  });
});
