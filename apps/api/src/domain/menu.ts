/**
 * O cardápio público — o que alguém enxerga ao escanear o QR code, **sem
 * login**. Só tipos, sem runtime.
 *
 * Existe separado de `Restaurant`/`Product` de propósito. É a superfície aberta
 * da API, então ela não pode crescer sozinha: quando `restaurants` ganhar
 * `owner_email` ou `products` ganhar `cost_in_cents`, o campo novo aparece nas
 * rotas de gestão e **não** aqui, porque este tipo (e o `schema.response` que o
 * espelha) lista o que sai, não o que existe (S10).
 */
import type { Page } from "./pagination.ts";
import type { PriceRule } from "./option.ts";
import type { Product } from "./product.ts";
import type { Restaurant } from "./restaurant.ts";
import type { Weekday } from "./opening-hours.ts";

/**
 * Restaurante como o público vê.
 *
 * Declara o que SAI, campo a campo — deixou de ser um `Omit` do `Restaurant`
 * de propósito. Subtrair faz a superfície aberta crescer sozinha: bastava uma
 * coluna nova em `restaurants` para ela aparecer aqui sem ninguém decidir. Foi
 * o que aconteceu com o `timezone`, que só não vazou porque o
 * `schema.response` da rota o barrava — o tipo já dizia que ele era público.
 */
export type MenuRestaurant = Pick<
  Restaurant,
  | "id"
  | "slug"
  | "name"
  | "cuisineType"
  | "logoUrl"
  | "address"
  | "isDelivery"
  | "isTakeaway"
  | "isQrcode"
> & {
  /**
   * A loja está aceitando pedido AGORA: a grade **e** a pausa, juntas. É o que
   * a tela precisa para decidir se mostra o botão de pedir.
   */
  isOpen: boolean;
  /**
   * A pausa, separada, para a tela distinguir "fechado agora, abre às 18h" de
   * "a loja pausou os pedidos". São mensagens diferentes para o cliente.
   */
  acceptingOrders: boolean;
  /**
   * A grade da semana, para a tela conseguir dizer QUANDO abre. Sem ela,
   * "fechado" é um beco sem saída para quem escaneou o QR code.
   */
  openingHours: { weekday: Weekday; opensAt: string; closesAt: string }[];
};

/**
 * Produto como o público vê.
 *
 * `stock` não sai: quantas unidades o restaurante tem é informação de negócio
 * dele, não do cliente. O que o cliente precisa saber é se dá para pedir, e
 * isso é o `available`.
 */
export type MenuProduct = Omit<
  Product,
  "stock" | "restaurantId" | "createdAt" | "updatedAt" | "categoryId"
> & {
  available: boolean;
  /**
   * Os grupos deste produto, na ordem que ele os usa. Só os ids: o conteúdo
   * (nome, opções) vem uma vez só em `optionGroups`, no topo da página — ver
   * `MenuOptionGroup`.
   */
  optionGroupIds: string[];
};

/**
 * Um grupo de opções como o público o vê.
 *
 * Vem **fora** dos produtos, uma vez cada. Embutir repetiria "Sabores" com
 * vinte opções dentro de cada pizza; como os grupos são reutilizáveis, eles são
 * poucos, e incluir cada um uma vez é barato.
 */
export type MenuOptionGroup = {
  id: string;
  name: string;
  minOptions: number;
  maxOptions: number;
  priceRule: PriceRule;
  options: {
    id: string;
    name: string;
    priceInCents: number;
    maxQuantity: number;
  }[];
};

/**
 * Uma seção do cardápio: a categoria e os produtos dela.
 *
 * `id` é opcional por um caso só, e ele é real: o grupo dos produtos que não
 * estão em seção nenhuma. Ele não é uma categoria — não tem id, não tem
 * posição, e não sai da tabela `categories` —, então dar a ele um id
 * inventado faria a tela tratar como editável algo que não existe no banco.
 */
export type MenuSection = {
  /** Ausente no grupo "Sem categoria", que não é uma categoria de verdade. */
  id?: string;
  name: string;
  products: MenuProduct[];
};

/**
 * A página do cardápio: o envelope de seções de sempre, mais os grupos de
 * opções referenciados pelos produtos **desta página**, cada um uma vez.
 */
export type MenuProductsPage = Page<MenuSection> & {
  optionGroups: MenuOptionGroup[];
};
