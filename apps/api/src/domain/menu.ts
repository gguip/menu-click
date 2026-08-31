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
import type { Product } from "./product.ts";
import type { Restaurant } from "./restaurant.ts";

/** Restaurante como o público vê: sem os timestamps de gestão. */
export type MenuRestaurant = Omit<Restaurant, "createdAt" | "updatedAt">;

/**
 * Produto como o público vê.
 *
 * `stock` não sai: quantas unidades o restaurante tem é informação de negócio
 * dele, não do cliente. O que o cliente precisa saber é se dá para pedir, e
 * isso é o `available`.
 */
export type MenuProduct = Omit<
  Product,
  "stock" | "restaurantId" | "createdAt" | "updatedAt"
> & {
  available: boolean;
};
