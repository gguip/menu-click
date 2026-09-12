/**
 * Taxa de entrega — tipos e o cálculo, sem runtime de infraestrutura.
 *
 * O cálculo mora aqui, e não no serviço, porque é função pura de
 * (configuração, endereço, subtotal) para (cotação). Isso o torna testável sem
 * banco e sem HTTP, que é o que uma regra de dinheiro precisa.
 */

/**
 * Como o restaurante cobra. União `as const`: o runtime proíbe `enum`.
 * Todos os modos que a COLUNA aceita (o `check` da migration) — nem todos
 * são selecionáveis pela API hoje, ver `SELECTABLE_DELIVERY_FEE_MODES`.
 */
export const DELIVERY_FEE_MODES = ["neighborhood", "distance", "fixed"] as const;
export type DeliveryFeeMode = (typeof DELIVERY_FEE_MODES)[number];

/**
 * Os modos que a API deixa a loja escolher HOJE. `distance` só entra quando as
 * faixas de km e o Nominatim existirem (Parte 2): até lá ele não calcula nada,
 * e deixar a loja selecioná-lo seria oferecer um estado quebrado.
 */
export const SELECTABLE_DELIVERY_FEE_MODES = ["neighborhood", "fixed"] as const;

/**
 * A chave de comparação de um bairro: sem acento, sem caixa, sem espaço
 * sobrando.
 *
 * Usa a mesma técnica do `slugify` (`normalize("NFD")` separa a letra do
 * acento, e o filtro de `\p{M}` tira só o acento), mas **não** é o `slugify`:
 * aquele produz URL — corta no tamanho, troca espaço por hífen. Este produz
 * chave de igualdade, e precisa que "Jardim América" e "jardim  america"
 * colidam sem virar "jardim-america".
 */
export function normalizeNeighborhood(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Um bairro atendido, como o restaurante o define. */
export type DeliveryNeighborhoodInput = {
  name: string;
  feeInCents: number;
};

/**
 * Um bairro atendido, como a API o devolve. Sem `id`: a lista é substituída
 * inteira a cada `PUT` (ver `services/delivery-neighborhoods.ts`), então não
 * há identidade estável para o cliente guardar entre uma chamada e outra.
 */
export type DeliveryNeighborhood = DeliveryNeighborhoodInput;

export type DeliveryQuoteInput = {
  mode: DeliveryFeeMode;
  fixedFeeInCents: number;
  freeAboveInCents?: number;
  toArrange: boolean;
  neighborhoods: DeliveryNeighborhood[];
  addressNeighborhood: string;
  /** Só os itens. Nunca o total — ver o comentário de `quoteDelivery`. */
  subtotalInCents: number;
};

export type DeliveryQuote = {
  deliversTo: boolean;
  /** `null` quando não entrega ou quando é "a combinar". `0` é grátis. */
  feeInCents: number | null;
  isFree: boolean;
  toArrange: boolean;
};

/**
 * Quanto custa entregar neste endereço — ou se dá para entregar.
 *
 * A ordem das decisões importa e não é arbitrária:
 *
 * 1. **Descobrir a taxa base pelo modo.** Só aqui se decide se a loja atende o
 *    endereço. Modo sem configuração (bairro sem lista, distância sem faixas)
 *    **não** é taxa zero: é ausência de serviço. Tratar vazio como zero faria a
 *    loja entregar de graça para a cidade inteira por esquecimento.
 * 2. **Se não deu para determinar**, o `toArrange` da loja decide entre aceitar
 *    para acertar por fora e recusar.
 * 3. **Só então aplicar o "grátis acima de X".** É desconto sobre um frete que
 *    já se sabe calcular — não uma licença para entregar onde a loja não
 *    atende. Por isso ele não roda antes do passo 1.
 *
 * ⚠️ O "grátis acima de X" compara com o **subtotal dos itens**, nunca com o
 * total. Comparar com o total seria circular: o total inclui o frete, que é
 * justamente o que está sendo decidido.
 */
export function quoteDelivery(input: DeliveryQuoteInput): DeliveryQuote {
  const base = taxaBase(input);

  if (base === undefined) {
    return input.toArrange
      ? { deliversTo: true, feeInCents: null, isFree: false, toArrange: true }
      : { deliversTo: false, feeInCents: null, isFree: false, toArrange: false };
  }

  // o limite é inclusivo: "grátis acima de R$ 50" com pedido de R$ 50 é grátis.
  // Exclusivo faria o cliente de R$ 50,00 pagar frete e o de R$ 50,01 não, o
  // que ninguém consegue explicar no balcão.
  const gratisPorValor =
    input.freeAboveInCents !== undefined &&
    input.subtotalInCents >= input.freeAboveInCents;

  const fee = gratisPorValor ? 0 : base;
  return { deliversTo: true, feeInCents: fee, isFree: fee === 0, toArrange: false };
}

/** A taxa antes de qualquer promoção. `undefined` = não deu para determinar. */
function taxaBase(input: DeliveryQuoteInput): number | undefined {
  if (input.mode === "fixed") return input.fixedFeeInCents;

  if (input.mode === "neighborhood") {
    const alvo = normalizeNeighborhood(input.addressNeighborhood);
    const achado = input.neighborhoods.find(
      (bairro) => normalizeNeighborhood(bairro.name) === alvo,
    );
    return achado?.feeInCents;
  }

  // `distance` chega na Parte 2, com as faixas de km e o Nominatim. Até lá cai
  // no caminho de "não consegue determinar" — que é o comportamento honesto, e
  // o motivo de o schema da rota ainda não oferecer este modo.
  return undefined;
}
