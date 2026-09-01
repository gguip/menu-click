import type { Page, Pagination } from "../domain/pagination.ts";
import type { MenuProduct, MenuRestaurant, MenuSection } from "../domain/menu.ts";
import type { Product } from "../domain/product.ts";
import type { Restaurant } from "../domain/restaurant.ts";
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

function toMenuRestaurant(restaurant: Restaurant): MenuRestaurant {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = restaurant;
  return rest;
}

function toMenuProduct(product: Product): MenuProduct {
  return {
    id: product.id,
    name: product.name,
    priceInCents: product.priceInCents,
    ...(product.description === undefined
      ? {}
      : { description: product.description }),
    ...(product.photoUrl === undefined ? {} : { photoUrl: product.photoUrl }),
    // o número exato não sai; o cliente só precisa saber se dá para pedir
    available: product.stock > 0,
  };
}

export async function getRestaurant(slug: string): Promise<MenuRestaurant> {
  return toMenuRestaurant(await restaurantsService.getBySlug(slug));
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
): Promise<Page<MenuSection>> {
  const restaurant = await restaurantsService.getBySlug(slug);

  const categorias = await categoriesService.listByRestaurant(
    restaurant.id,
    pagination,
  );

  const produtos = await productsService.listByCategoryIds(
    restaurant.id,
    categorias.data.map((categoria) => categoria.id),
  );

  const sections: MenuSection[] = categorias.data.map((categoria) => ({
    id: categoria.id,
    name: categoria.name,
    products: produtos
      .filter((produto) => produto.categoryId === categoria.id)
      .map(toMenuProduct),
  }));

  const ultimaPagina =
    pagination.offset + categorias.data.length >= categorias.total;

  if (ultimaPagina) {
    const semCategoria = await productsService.listUncategorized(restaurant.id);
    if (semCategoria.length > 0) {
      sections.push({
        name: UNCATEGORIZED_SECTION_NAME,
        products: semCategoria.map(toMenuProduct),
      });
    }
  }

  return { data: sections, ...pagination, total: categorias.total };
}
