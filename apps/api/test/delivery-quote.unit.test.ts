import { describe, expect, it } from "vitest";
import { quoteDelivery } from "../src/domain/delivery.ts";

describe("cotação de frete", () => {
  const base = {
    acceptsDelivery: true,
    mode: "fixed" as const,
    fixedFeeInCents: 700,
    freeAboveInCents: undefined,
    toArrange: false,
    neighborhoods: [],
    addressNeighborhood: "Centro",
    subtotalInCents: 3000,
  };

  it("loja que não faz entrega não entrega em endereço nenhum", () => {
    // sabido antes de qualquer cálculo, e sem depender do endereço: não é o
    // caso de "informa × decide", é modalidade
    expect(quoteDelivery({ ...base, acceptsDelivery: false })).toEqual({
      deliversTo: false, feeInCents: null, isFree: false, toArrange: false,
    });
  });

  it("nem com 'a combinar' ligado, se a loja não faz entrega", () => {
    const quote = quoteDelivery({ ...base, acceptsDelivery: false, toArrange: true });
    expect(quote.deliversTo).toBe(false);
    expect(quote.toArrange).toBe(false);
  });

  it("taxa fixa devolve a taxa", () => {
    expect(quoteDelivery(base)).toEqual({
      deliversTo: true, feeInCents: 700, isFree: false, toArrange: false,
    });
  });

  it("taxa fixa zero é entrega grátis", () => {
    expect(quoteDelivery({ ...base, fixedFeeInCents: 0 })).toEqual({
      deliversTo: true, feeInCents: 0, isFree: true, toArrange: false,
    });
  });

  it("bairro cadastrado devolve o preço dele", () => {
    const quote = quoteDelivery({
      ...base,
      mode: "neighborhood",
      neighborhoods: [
        { name: "Centro", feeInCents: 500 },
        { name: "Jardim América", feeInCents: 900 },
      ],
      addressNeighborhood: "Jardim América",
    });
    expect(quote).toEqual({
      deliversTo: true, feeInCents: 900, isFree: false, toArrange: false,
    });
  });

  it("casa o bairro ignorando acento, caixa e espaço", () => {
    const quote = quoteDelivery({
      ...base,
      mode: "neighborhood",
      neighborhoods: [{ name: "Jardim América", feeInCents: 900 }],
      addressNeighborhood: "  jardim   AMERICA ",
    });
    expect(quote.feeInCents).toBe(900);
  });

  it("bairro fora da lista não entrega, quando não há 'a combinar'", () => {
    const quote = quoteDelivery({
      ...base,
      mode: "neighborhood",
      neighborhoods: [{ name: "Centro", feeInCents: 500 }],
      addressNeighborhood: "Outro Lugar",
    });
    expect(quote).toEqual({
      deliversTo: false, feeInCents: null, isFree: false, toArrange: false,
    });
  });

  it("bairro fora da lista vira 'a combinar' quando a loja liga a opção", () => {
    const quote = quoteDelivery({
      ...base,
      mode: "neighborhood",
      toArrange: true,
      neighborhoods: [{ name: "Centro", feeInCents: 500 }],
      addressNeighborhood: "Outro Lugar",
    });
    expect(quote).toEqual({
      deliversTo: true, feeInCents: null, isFree: false, toArrange: true,
    });
  });

  it("modo bairro SEM bairro cadastrado não é frete zero", () => {
    // ausência de configuração é ausência de serviço, nunca serviço de graça
    const quote = quoteDelivery({ ...base, mode: "neighborhood", neighborhoods: [] });
    expect(quote.deliversTo).toBe(false);
    expect(quote.feeInCents).toBeNull();
  });

  it("grátis acima de X zera a taxa", () => {
    const quote = quoteDelivery({ ...base, freeAboveInCents: 3000 });
    expect(quote).toEqual({
      deliversTo: true, feeInCents: 0, isFree: true, toArrange: false,
    });
  });

  it("grátis acima de X compara com o SUBTOTAL, e o limite é inclusivo", () => {
    // exatamente no limite: grátis
    expect(quoteDelivery({ ...base, freeAboveInCents: 3000, subtotalInCents: 3000 }).isFree).toBe(true);
    // um centavo abaixo: cobra
    expect(quoteDelivery({ ...base, freeAboveInCents: 3000, subtotalInCents: 2999 }).feeInCents).toBe(700);
  });

  it("grátis acima de X não resgata endereço que a loja não atende", () => {
    // a promoção é desconto sobre um frete que dá para calcular; ela não
    // significa "entrega em qualquer lugar"
    const quote = quoteDelivery({
      ...base,
      mode: "neighborhood",
      freeAboveInCents: 1000,
      neighborhoods: [{ name: "Centro", feeInCents: 500 }],
      addressNeighborhood: "Outro Lugar",
    });
    expect(quote.deliversTo).toBe(false);
  });

  it("bairro em branco no endereço não casa com nada", () => {
    // defesa em profundidade: o serviço já recusa cadastrar nome só-espaço,
    // mas se uma linha dessas existir (dado antigo, escrita por fora), a chave
    // vazia não pode casar com um endereço de bairro em branco e sair cobrando
    const quote = quoteDelivery({
      ...base,
      mode: "neighborhood",
      neighborhoods: [{ name: "   ", feeInCents: 500 }],
      addressNeighborhood: "   ",
    });
    expect(quote.deliversTo).toBe(false);
    expect(quote.feeInCents).toBeNull();
  });

  it("modo distância ainda não decide nada na Parte 1", () => {
    // as faixas de km chegam com o Nominatim; até lá o modo cai no caminho de
    // "não consegue determinar", que é honesto
    const quote = quoteDelivery({ ...base, mode: "distance", toArrange: true });
    expect(quote.toArrange).toBe(true);
  });
});
