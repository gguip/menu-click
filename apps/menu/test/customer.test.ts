import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCustomer, CUSTOMER_KEY, CUSTOMER_TTL_MS, loadCustomer, saveCustomer } from "../src/lib/customer.ts";

const NOW = Date.parse("2026-09-29T12:00:00Z");

describe("quem pede, lembrado no aparelho", () => {
  afterEach(() => vi.restoreAllMocks());

  it("guarda e devolve nome e telefone", () => {
    saveCustomer({ name: "Ana", phone: "(11) 98888-7777" }, NOW);
    expect(loadCustomer(NOW + 1000)).toEqual({ name: "Ana", phone: "(11) 98888-7777" });
  });

  it("vence 30 dias depois do último pedido, e aí some", () => {
    saveCustomer({ name: "Ana", phone: "(11) 98888-7777" }, NOW);
    expect(loadCustomer(NOW + CUSTOMER_TTL_MS - 1)).not.toBeNull();
    expect(loadCustomer(NOW + CUSTOMER_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem(CUSTOMER_KEY)).toBeNull();
  });

  it("limpar apaga", () => {
    saveCustomer({ name: "Ana", phone: "(11) 98888-7777" }, NOW);
    clearCustomer();
    expect(loadCustomer(NOW)).toBeNull();
  });

  it("valor adulterado ou storage bloqueado: nada, e sem erro", () => {
    localStorage.setItem(CUSTOMER_KEY, '{"name":42}');
    expect(loadCustomer(NOW)).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(loadCustomer(NOW)).toBeNull();
    expect(() => saveCustomer({ name: "Ana", phone: "1" }, NOW)).not.toThrow();
  });

  const ADDRESS = { neighborhood: "Centro", street: "Rua A", number: "10", complement: "apto 2", zip: "01304-001" };

  it("guarda o endereço junto, e um pedido sem endereço não apaga o que havia", () => {
    saveCustomer({ name: "Ana", phone: "(11) 98888-7777", address: ADDRESS }, NOW);
    saveCustomer({ name: "Ana", phone: "(11) 98888-7777" }, NOW + 1000);
    expect(loadCustomer(NOW + 2000)).toEqual({ name: "Ana", phone: "(11) 98888-7777", address: ADDRESS });
  });

  it("endereço adulterado é descartado, sem perder nome e telefone", () => {
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ name: "Ana", phone: "1", savedAt: NOW, address: { street: 42 } }));
    expect(loadCustomer(NOW)).toEqual({ name: "Ana", phone: "1" });
  });
});
