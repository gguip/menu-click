import { describe, expect, it } from "vitest";
import { keepOpeningStatus, storeStatusLabel } from "../src/features/restaurant/storeStatus.ts";
import { makeRestaurant } from "./fixtures.ts";

const TZ = "America/Sao_Paulo";
const segunda15h = Date.parse("2026-09-21T15:00:00-03:00");

function label(openingStatus: { isOpen: boolean; closesAt?: string; opensAt?: string }, acceptingOrders = true) {
  return storeStatusLabel({ acceptingOrders, openingStatus, timezone: TZ }, segunda15h).text;
}

describe("status da loja no rail", () => {
  it("pausa ganha de tudo", () => {
    expect(label({ isOpen: true, closesAt: "2026-09-22T02:30:00.000Z" }, false)).toBe("Pausada agora");
  });

  it("aberta, com a hora de fechar; aberta direto, sem hora", () => {
    expect(label({ isOpen: true, closesAt: "2026-09-22T02:30:00.000Z" })).toBe("Aberta · fecha 23:30");
    expect(label({ isOpen: true })).toBe("Aberta");
  });

  it("fechada: abre hoje sem dia, outro dia com o dia", () => {
    expect(label({ isOpen: false, opensAt: "2026-09-21T21:00:00.000Z" })).toBe("Fechada · abre 18:00");
    expect(label({ isOpen: false, opensAt: "2026-09-25T21:00:00.000Z" })).toBe("Fechada · abre sex 18:00");
  });

  it("sem grade: diz que falta cadastrar", () => {
    expect(storeStatusLabel({ acceptingOrders: true, openingStatus: { isOpen: false }, timezone: TZ }, segunda15h))
      .toEqual({ text: "Fechada · sem horário cadastrado", noSchedule: true });
  });

  it("sem openingStatus (ainda carregando): cai no texto antigo", () => {
    expect(storeStatusLabel({ acceptingOrders: true, openingStatus: undefined, timezone: TZ }, segunda15h).text)
      .toBe("Aceitando pedidos");
  });

  it("a resposta do PATCH não apaga o openingStatus do cache", () => {
    const previous = makeRestaurant({ openingStatus: { isOpen: true, closesAt: "2026-09-22T02:30:00.000Z" } });
    const patched = makeRestaurant({ acceptingOrders: false, openingStatus: undefined });
    expect(keepOpeningStatus(previous, patched).openingStatus).toEqual(previous.openingStatus);
    expect(keepOpeningStatus(previous, patched).acceptingOrders).toBe(false);
  });

  it("o PATCH também não traz o link do cardápio, e ele não some do cache", () => {
    const previous = { ...makeRestaurant(), menuUrl: "https://menu.example/trattoria-bella" };
    const patched = makeRestaurant({ acceptingOrders: false });
    expect(keepOpeningStatus(previous, patched).menuUrl).toBe("https://menu.example/trattoria-bella");
  });
});
