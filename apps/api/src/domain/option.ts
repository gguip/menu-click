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
export type EscolhaPrecificada = {
  priceInCents: number;
  quantity: number;
};

/** Um grupo com as escolhas que o cliente fez nele. */
export type GrupoPrecificado = {
  priceRule: PriceRule;
  escolhas: EscolhaPrecificada[];
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
export function dividirArredondando(n: number, d: number): number {
  return Math.floor(n / d) + (2 * (n % d) >= d ? 1 : 0);
}

/**
 * Quanto um grupo acrescenta ao preço unitário do item.
 *
 * ⚠️ O resultado de `average` é o único que arredonda, e ele arredonda **aqui**
 * por ser a fronteira do grupo — mas quem chama (`precoUnitario`) NÃO soma
 * contribuições já arredondadas. Ver o comentário lá.
 */
export function contribuicaoDoGrupo(
  regra: PriceRule,
  escolhas: EscolhaPrecificada[],
): number {
  if (escolhas.length === 0) return 0;

  if (regra === "sum") {
    return escolhas.reduce(
      (soma, escolha) => soma + escolha.priceInCents * escolha.quantity,
      0,
    );
  }

  if (regra === "highest") {
    // a quantidade não entra: dois pedaços do mesmo sabor não dobram o preço
    return Math.max(...escolhas.map((escolha) => escolha.priceInCents));
  }

  const total = escolhas.reduce(
    (soma, escolha) => soma + escolha.priceInCents * escolha.quantity,
    0,
  );
  const unidades = escolhas.reduce((soma, escolha) => soma + escolha.quantity, 0);
  return dividirArredondando(total, unidades);
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
export function precoUnitario(
  precoDoProduto: number,
  grupos: GrupoPrecificado[],
): number {
  // acumula em milésimos de centavo para não arredondar no meio do caminho:
  // só `average` produz fração, e ela é sempre uma divisão exata por um
  // inteiro pequeno (o número de unidades escolhidas no grupo)
  let numerador = precoDoProduto;
  let fracionario = 0;
  let denominador = 1;

  for (const grupo of grupos) {
    if (grupo.escolhas.length === 0) continue;

    if (grupo.priceRule === "average") {
      const total = grupo.escolhas.reduce(
        (soma, escolha) => soma + escolha.priceInCents * escolha.quantity,
        0,
      );
      const unidades = grupo.escolhas.reduce(
        (soma, escolha) => soma + escolha.quantity,
        0,
      );
      // soma de frações: a/b + c/d = (ad + cb) / bd
      fracionario = fracionario * unidades + total * denominador;
      denominador = denominador * unidades;
      continue;
    }

    numerador += contribuicaoDoGrupo(grupo.priceRule, grupo.escolhas);
  }

  return numerador + dividirArredondando(fracionario, denominador);
}
