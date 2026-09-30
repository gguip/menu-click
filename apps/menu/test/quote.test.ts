// apps/menu/test/quote.test.ts
import { describe, expect, it, vi } from "vitest";
import { fetchQuote, latestOnly, quoteBlocksAdvance, quoteFee, quoteText } from "../src/lib/quote.ts";

const ADDRESS = { street: "Rua A", number: "10", neighborhood: "Centro", city: "São Paulo", state: "SP", zipCode: "01304-001" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("cotação de frete", () => {
  it("traduz a resposta da API nos quatro estados do handoff", async () => {
    const answers = [
      { deliversTo: true, feeInCents: 900, isFree: false, toArrange: false },
      { deliversTo: true, feeInCents: 0, isFree: true, toArrange: false },
      { deliversTo: true, feeInCents: null, isFree: false, toArrange: true },
      { deliversTo: false, feeInCents: null, isFree: false, toArrange: false },
    ];
    const kinds = [];
    for (const answer of answers) {
      vi.stubGlobal("fetch", vi.fn(async () => json({ ...answer, servedNeighborhoods: [] })));
      kinds.push(await fetchQuote("cantina", ADDRESS, 3000));
    }
    expect(kinds).toEqual([{ kind: "fee", cents: 900 }, { kind: "free" }, { kind: "arrange" }, { kind: "none" }]);
  });

  it("rede, 5xx e 429 viram erro, nunca exceção", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 503)));
    expect(await fetchQuote("cantina", ADDRESS, 3000)).toEqual({ kind: "error" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await fetchQuote("cantina", ADDRESS, 3000)).toEqual({ kind: "error" });
  });

  it("textos e bloqueios de cada estado", () => {
    expect(quoteText({ kind: "fee", cents: 900 })).toBe("Entrega: R$ 9,00");
    expect(quoteText({ kind: "free" })).toBe("Entrega grátis neste pedido");
    expect(quoteText({ kind: "arrange" })).toBe("A loja combina a entrega com você");
    expect(quoteText({ kind: "none" })).toBe("Esta loja não entrega no seu bairro");
    expect(quoteFee({ kind: "fee", cents: 900 })).toBe(900);
    expect(quoteFee({ kind: "free" })).toBe(0);
    expect(quoteFee({ kind: "arrange" })).toBeNull();
    expect(quoteBlocksAdvance({ kind: "loading" })).toBe("Calculando a entrega…");
    expect(quoteBlocksAdvance({ kind: "error" })).toBe("Tente calcular a entrega de novo");
    expect(quoteBlocksAdvance({ kind: "none" })).toBe("Esta loja não entrega no seu bairro");
    expect(quoteBlocksAdvance({ kind: "idle" })).toBe("Preencha o endereço");
    expect(quoteBlocksAdvance({ kind: "arrange" })).toBeNull();
  });

  // Review Focus 1: a cotação velha que chega depois não sobrescreve a nova
  it("só a última cotação pedida vale", async () => {
    const latest = latestOnly();
    let releaseOld!: (q: string) => void;
    const old = latest(new Promise<string>((resolve) => (releaseOld = resolve)));
    const fresh = latest(Promise.resolve("nova"));
    releaseOld("velha");
    expect(await fresh).toEqual({ current: true, value: "nova" });
    expect(await old).toEqual({ current: false });
  });
});
