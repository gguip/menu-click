import type { Page, Pagination } from "../domain/pagination.ts";
import type { MenuProduct, MenuRestaurant } from "../domain/menu.ts";
import type { Product } from "../domain/product.ts";
import type { Restaurant } from "../domain/restaurant.ts";
import * as productsService from "./products.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço do cardápio público.
 *
 * Ganha um arquivo próprio (ao contrário do cliente, que não ganhou) porque
 * aqui há composição de verdade: slug → restaurante → produtos, mais a
 * tradução do modelo interno para o que o público pode ver.
 *
 * Nada aqui exige sessão. É a superfície aberta da API — o que ela devolve é
 * decidido campo a campo, nunca por "tudo menos".
 */

function toMenuRestaurant(restaurant: Restaurant): MenuRestaurant {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = restaurant;
  return rest;
}

function toMenuProduct(product: Product): MenuProduct {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
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

export async function listProducts(
  slug: string,
  pagination: Pagination,
): Promise<Page<MenuProduct>> {
  const restaurant = await restaurantsService.getBySlug(slug);
  const page = await productsService.listByRestaurant(
    restaurant.id,
    pagination,
  );
  return { ...page, data: page.data.map(toMenuProduct) };
}
