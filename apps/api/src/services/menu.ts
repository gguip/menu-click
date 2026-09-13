import type { Pagination } from "../domain/pagination.ts";
import type {
  MenuOptionGroup,
  MenuProduct,
  MenuProductsPage,
  MenuRestaurant,
  MenuSection,
} from "../domain/menu.ts";
import type { OptionGroup } from "../domain/option.ts";
import { acceptedPaymentMethods } from "../domain/payment.ts";
import type { Product } from "../domain/product.ts";
import type { Restaurant } from "../domain/restaurant.ts";
import type { OpeningHour } from "../domain/opening-hours.ts";
import * as openingHoursRepository from "../repositories/opening-hours.ts";
import * as optionGroupsRepository from "../repositories/option-groups.ts";
import * as categoriesService from "./categories.ts";
import * as productsService from "./products.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço do cardápio público.
 *
 * Ganha um arquivo próprio (ao contrário do cliente, que não ganhou) porque
 * aqui há composição de verdade: slug → restaurante → seções → produtos, mais a
 * tradução do modelo interno para o que o público pode ver.
 *
 * Nada aqui exige sessão. É a superfície aberta da API — o que ela devolve é
 * decidido campo a campo, nunca por "tudo menos".
 */

/**
 * O nome do grupo que recebe os produtos sem categoria.
 *
 * Ele existe porque a seção de um produto pode ser removida sem que o produto
 * saia do cardápio. Omitir esses produtos seria esconder comida que está à
 * venda; o rótulo é a saída honesta.
 */
const UNCATEGORIZED_SECTION_NAME = "Sem categoria";

/**
 * O restaurante como o público o vê, campo a campo.
 *
 * Copiar os campos é mais verboso que descartar dois, e é o ponto: o
 * `timezone` e a data de cadastro ficam de fora porque ninguém os listou aqui,
 * não porque alguém lembrou de subtraí-los (S10).
 */
function toMenuRestaurant(
  restaurant: Restaurant,
  isOpen: boolean,
  openingHours: OpeningHour[],
): MenuRestaurant {
  return {
    id: restaurant.id,
    slug: restaurant.slug,
    name: restaurant.name,
    cuisineType: restaurant.cuisineType,
    // logoUrl é opcional: quando não existe, a chave nem entra na resposta
    ...(restaurant.logoUrl === undefined ? {} : { logoUrl: restaurant.logoUrl }),
    address: restaurant.address,
    isDelivery: restaurant.isDelivery,
    isTakeaway: restaurant.isTakeaway,
    isQrcode: restaurant.isQrcode,
    deliveryFeeMode: restaurant.deliveryFeeMode,
    // freeDeliveryAboveInCents é opcional: quando a promoção não existe (NULL
    // no banco), a chave nem entra na resposta — mesmo tratamento do logoUrl
    ...(restaurant.freeDeliveryAboveInCents === undefined
      ? {}
      : { freeDeliveryAboveInCents: restaurant.freeDeliveryAboveInCents }),
    // para a tela avisar do mínimo antes de a pessoa montar o carrinho
    minimumOrderInCents: restaurant.minimumOrderInCents,
    isOpen,
    acceptingOrders: restaurant.acceptingOrders,
    openingHours: openingHours.map(({ weekday, opensAt, closesAt }) => ({
      weekday,
      opensAt,
      closesAt,
    })),
    paymentMethods: acceptedPaymentMethods(restaurant),
  };
}

/**
 * Um grupo como o público o vê: sem opção indisponível.
 *
 * A opção some daqui, não só do carrinho — sem isso o cliente montaria um
 * pedido que a criação recusaria com 400.
 */
function toMenuOptionGroup(group: OptionGroup): MenuOptionGroup {
  return {
    id: group.id,
    name: group.name,
    minOptions: group.minOptions,
    maxOptions: group.maxOptions,
    priceRule: group.priceRule,
    options: group.options
      .filter((option) => option.available)
      .map((option) => ({
        id: option.id,
        name: option.name,
        priceInCents: option.priceInCents,
        maxQuantity: option.maxQuantity,
      })),
  };
}

/**
 * O produto está à venda?
 *
 * Deixou de ser só `stock > 0`: um grupo obrigatório sem opção disponível
 * suficiente torna o produto impossível de pedir, e o cardápio precisa dizer
 * isso ANTES de a pessoa montar o carrinho — senão ela monta e a criação
 * recusa. É a regra do iFood.
 */
function estaDisponivel(product: Product, grupos: MenuOptionGroup[]): boolean {
  if (product.stock <= 0) return false;
  return grupos.every(
    (grupo) => grupo.minOptions === 0 || grupo.options.length >= grupo.minOptions,
  );
}

function toMenuProduct(
  product: Product,
  grupos: OptionGroup[],
  menuGroupsById: Map<string, MenuOptionGroup>,
): MenuProduct {
  // os grupos já filtrados (sem opção indisponível), na mesma ordem do produto
  const gruposFiltrados = grupos.map((grupo) => menuGroupsById.get(grupo.id)!);
  return {
    id: product.id,
    name: product.name,
    priceInCents: product.priceInCents,
    ...(product.description === undefined
      ? {}
      : { description: product.description }),
    ...(product.photoUrl === undefined ? {} : { photoUrl: product.photoUrl }),
    optionGroupIds: grupos.map((grupo) => grupo.id),
    // o número exato de estoque não sai; o cliente só precisa saber se dá
    // para pedir — e agora isso também depende dos grupos obrigatórios
    available: estaDisponivel(product, gruposFiltrados),
  };
}

/**
 * O restaurante do QR code, e se dá para pedir dele agora.
 *
 * A conta de "está aberto" roda no Postgres, no fuso do restaurante, pelo
 * mesmo motivo do filtro de período do painel: refazê-la em JavaScript seria
 * uma segunda implementação da mesma regra, discordando da primeira
 * exatamente nos dias de virada de horário de verão.
 */
export async function getRestaurant(slug: string): Promise<MenuRestaurant> {
  const restaurant = await restaurantsService.getBySlug(slug);

  const [dentroDaGrade, grade] = await Promise.all([
    openingHoursRepository.isOpenNow(restaurant.id, restaurant.timezone),
    openingHoursRepository.findByRestaurant(restaurant.id),
  ]);

  // a loja só está aberta se a grade permite E ninguém pausou
  return toMenuRestaurant(
    restaurant,
    dentroDaGrade && restaurant.acceptingOrders,
    grade,
  );
}

/**
 * O cardápio, agrupado por seção e na ordem que o restaurante definiu.
 *
 * **Quem pagina são as categorias, não os produtos.** Uma página de produtos
 * partiria um grupo ao meio — metade de "Pratos" no fim de uma página e metade
 * no começo da outra —, e aí o envelope deixaria de descrever o que devolveu.
 * Com a categoria como unidade, nenhuma seção se parte e cada uma vem inteira.
 * Na prática todo restaurante cabe numa página só.
 *
 * Os produtos saem em **duas** consultas, não uma por seção: a página de
 * categorias primeiro, os produtos de todas elas depois (`= any($2)`).
 *
 * O grupo "Sem categoria" vem **na última página**, e não conta no `total` —
 * ele não é uma categoria, é o resto. Colocá-lo em qualquer página seria
 * repeti-lo em todas.
 */
export async function listProducts(
  slug: string,
  pagination: Pagination,
): Promise<MenuProductsPage> {
  const restaurant = await restaurantsService.getBySlug(slug);

  const categorias = await categoriesService.listByRestaurant(
    restaurant.id,
    pagination,
  );

  const produtos = await productsService.listByCategoryIds(
    restaurant.id,
    categorias.data.map((categoria) => categoria.id),
  );

  const ultimaPagina =
    pagination.offset + categorias.data.length >= categorias.total;

  const semCategoria = ultimaPagina
    ? await productsService.listUncategorized(restaurant.id)
    : [];

  // uma chamada só para todos os produtos DESTA página (categorizados +
  // "Sem categoria"), nunca uma por seção nem uma por produto
  const gruposPorProduto = await optionGroupsRepository.findGroupsByProductIds(
    restaurant.id,
    [...produtos, ...semCategoria].map((produto) => produto.id),
  );

  // os grupos referenciados pela página, deduplicados e já sem opção
  // indisponível — cada um convertido uma vez só, na primeira aparição
  const menuGroupsById = new Map<string, MenuOptionGroup>();
  for (const grupos of gruposPorProduto.values()) {
    for (const grupo of grupos) {
      if (!menuGroupsById.has(grupo.id)) {
        menuGroupsById.set(grupo.id, toMenuOptionGroup(grupo));
      }
    }
  }

  const converteProduto = (produto: Product) =>
    toMenuProduct(produto, gruposPorProduto.get(produto.id) ?? [], menuGroupsById);

  const sections: MenuSection[] = categorias.data.map((categoria) => ({
    id: categoria.id,
    name: categoria.name,
    products: produtos
      .filter((produto) => produto.categoryId === categoria.id)
      .map(converteProduto),
  }));

  if (semCategoria.length > 0) {
    sections.push({
      name: UNCATEGORIZED_SECTION_NAME,
      products: semCategoria.map(converteProduto),
    });
  }

  return {
    data: sections,
    ...pagination,
    total: categorias.total,
    optionGroups: [...menuGroupsById.values()],
  };
}
