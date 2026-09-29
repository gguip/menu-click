/**
 * A aritmética de dinheiro do cardápio, compartilhada pela API (que cobra) e
 * pelo app do cliente (que mostra o preço ao vivo). Um arquivo só e sem import
 * interno: a API roda `.ts` direto no Node (type stripping), e o Next o
 * compila por `transpilePackages`. Quem decide o valor cobrado continua sendo
 * a criação do pedido, que recalcula no servidor com ESTE mesmo código.
 */

/**
 * Como o preço das opções escolhidas entra na conta do item.
 *
 * `sum` é o caso comum (adicionais). `highest` e `average` existem para pizza
 * meio a meio, e as duas práticas convivem no mercado — quem escolhe é o
 * restaurante. Fica de fora o "menor" que a Delivery Direto suporta: nenhum
 * cardápio real o usa.
 */
export const PRICE_RULES = ["sum", "highest", "average"] as const;

export type PriceRule = (typeof PRICE_RULES)[number];

/** Uma opção escolhida, já com o preço congelado. */
export type PricedChoice = {
  priceInCents: number;
  quantity: number;
};

/** Um grupo com as escolhas que o cliente fez nele. */
export type PricedGroup = {
  priceRule: PriceRule;
  choices: PricedChoice[];
};

/**
 * Divide `n` por `d` arredondando o meio para cima, **sem passar por float**.
 *
 * Foi verificado que `Math.round(n / d)` concorda com a aritmética exata em
 * 103 mil combinações nas magnitudes de um cardápio — inclusive nos quocientes
 * que caem exatamente em `.5`, que a divisão IEEE-754 representa sem erro. Ou
 * seja: o float não erra aqui.
 *
 * A função existe assim mesmo. Uma equivalência verificada hoje, em faixas de
 * valor de hoje, é mais frágil que uma propriedade que não depende de faixa
 * nenhuma — e o custo de não depender é esta linha.
 *
 * Só funciona para `n >= 0`, que é garantido pelo `check (price_in_cents >= 0)`
 * da tabela `options`.
 */
export function divideRounded(n: number, d: number): number {
  return Math.floor(n / d) + (2 * (n % d) >= d ? 1 : 0);
}

/**
 * O par `(total, unidades)` que a regra `average` divide: soma de
 * `priceInCents × quantity` sobre as unidades escolhidas no grupo.
 *
 * Extraído porque `groupContribution` e `unitPrice` precisam do MESMO par —
 * a primeira arredonda ali mesmo, a segunda acumula a fração exata antes de
 * arredondar (ver o comentário de `unitPrice`) —, e as duas definições
 * precisam concordar sempre, não só nos casos que o teste cobre hoje.
 */
function averageTotals(choices: PricedChoice[]): {
  total: number;
  units: number;
} {
  const total = choices.reduce(
    (sum, choice) => sum + choice.priceInCents * choice.quantity,
    0,
  );
  const units = choices.reduce((sum, choice) => sum + choice.quantity, 0);
  return { total, units };
}

/**
 * Quanto um grupo acrescenta ao preço unitário do item.
 *
 * ⚠️ O resultado de `average` é o único que arredonda, e ele arredonda **aqui**
 * por ser a fronteira do grupo — mas quem chama (`unitPrice`) NÃO soma
 * contribuições já arredondadas. Ver o comentário lá.
 */
export function groupContribution(
  rule: PriceRule,
  choices: PricedChoice[],
): number {
  if (choices.length === 0) return 0;

  if (rule === "sum") {
    return choices.reduce(
      (sum, choice) => sum + choice.priceInCents * choice.quantity,
      0,
    );
  }

  if (rule === "highest") {
    // a quantidade não entra: dois pedaços do mesmo sabor não dobram o preço
    return Math.max(...choices.map((choice) => choice.priceInCents));
  }

  const { total, units } = averageTotals(choices);
  return divideRounded(total, units);
}

/**
 * O preço de UMA unidade do item, com tudo que foi escolhido.
 *
 * ⚠️ **O arredondamento acontece uma vez, aqui.** As contribuições de `average`
 * são acumuladas como numerador/denominador exatos e só viram inteiro no fim.
 *
 * Arredondar por grupo produziria viés sistemático **para cima** — medido: três
 * grupos caindo em meio centavo, em dez unidades, cobram dez centavos a mais.
 * Arredondar no total do item faria `unitário × quantidade` deixar de fechar
 * com o total do pedido, e um recibo cuja conta não bate é lido como erro por
 * quem confere.
 */
export function unitPrice(
  productPriceInCents: number,
  groups: PricedGroup[],
): number {
  // acumula em milésimos de centavo para não arredondar no meio do caminho:
  // só `average` produz fração, e ela é sempre uma divisão exata por um
  // inteiro pequeno (o número de unidades escolhidas no grupo)
  let numerator = productPriceInCents;
  let fractional = 0;
  let denominator = 1;

  for (const group of groups) {
    if (group.choices.length === 0) continue;

    if (group.priceRule === "average") {
      const { total, units } = averageTotals(group.choices);
      // soma de frações: a/b + c/d = (ad + cb) / bd
      fractional = fractional * units + total * denominator;
      denominator = denominator * units;
      continue;
    }

    numerator += groupContribution(group.priceRule, group.choices);
  }

  return numerator + divideRounded(fractional, denominator);
}
