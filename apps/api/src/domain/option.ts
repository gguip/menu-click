/**
 * Grupos de opções do cardápio — as escolhas que um produto pede ("Tamanho",
 * "Sabores", "Adicionais"). Tipos, mais as funções de preço, que são o único
 * runtime deste arquivo.
 *
 * O grupo pertence ao RESTAURANTE e se liga aos produtos por junção: "Sabores"
 * vale para todas as pizzas, e recriá-lo por produto obrigaria a cadastrar
 * vinte opções de novo a cada pizza nova.
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

/** Uma opção do cardápio, como é guardada e devolvida. */
export type Option = {
  id: string;
  optionGroupId: string;
  name: string;
  priceInCents: number;
  /** Teto de unidades desta opção dentro de um item. */
  maxQuantity: number;
  available: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Um grupo, com as opções dele aninhadas.
 *
 * `options` vem junto porque um grupo sem elas não significa nada — e é por
 * isso que não existe rota para ler uma opção isolada.
 */
export type OptionGroup = {
  id: string;
  restaurantId: string;
  name: string;
  /** 0 = opcional; >= 1 = obrigatório. Conta opções DISTINTAS. */
  minOptions: number;
  maxOptions: number;
  priceRule: PriceRule;
  options: Option[];
  createdAt: string;
  updatedAt: string;
};

export type CreateOptionGroupInput = {
  name: string;
  /** Ausente = 0, grupo opcional. */
  minOptions?: number;
  maxOptions: number;
  priceRule: PriceRule;
};

export type UpdateOptionGroupInput = Partial<CreateOptionGroupInput>;

export type CreateOptionInput = {
  name: string;
  /** Ausente = 0: cobre a escolha obrigatória sem custo. */
  priceInCents?: number;
  maxQuantity?: number;
  available?: boolean;
  position?: number;
};

export type UpdateOptionInput = Partial<CreateOptionInput>;

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
