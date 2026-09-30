/**
 * Grupos de opções do cardápio — as escolhas que um produto pede ("Tamanho",
 * "Sabores", "Adicionais"). Tipos, mais as funções de preço, que são o único
 * runtime deste arquivo.
 *
 * O grupo pertence ao RESTAURANTE e se liga aos produtos por junção: "Sabores"
 * vale para todas as pizzas, e recriá-lo por produto obrigaria a cadastrar
 * vinte opções de novo a cada pizza nova.
 */

// As regras de preço e a aritmética de dinheiro moram em `@menuclick/pricing`,
// o pacote que a API e o app do cliente compartilham: o preço que a tela
// mostra e o que a criação do pedido cobra saem do MESMO código.
export {
  divideRounded,
  groupContribution,
  PRICE_RULES,
  unitPrice,
  type PricedChoice,
  type PricedGroup,
  type PriceRule,
} from "@menuclick/pricing";
import type { PriceRule } from "@menuclick/pricing";


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

/**
 * O grupo na listagem de gestão: com quantos produtos vivos o usam. Só a
 * listagem calcula — criar, editar e ler um grupo sozinho devolvem o
 * `OptionGroup` puro, e ninguém lá precisa da contagem.
 */
export type OptionGroupWithUsage = OptionGroup & { productCount: number };

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
