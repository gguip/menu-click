import type { DeliveryQuote } from "../domain/delivery.ts";
import { quoteDelivery } from "../domain/delivery.ts";
import type { Address } from "../domain/restaurant.ts";
import * as deliveryNeighborhoodsRepository from "../repositories/delivery-neighborhoods.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de cotação de frete — a superfície **pública**.
 *
 * Resolve o restaurante pelo slug (a única coisa que o cliente do QR code
 * tem) e delega o cálculo para `quoteDelivery` (`domain/delivery.ts`, Task 4):
 * este arquivo nunca reimplementa a fórmula, só monta a entrada dela.
 *
 * ⚠️ A Task 6 **não** reusa esta função. Ela ganha uma irmã,
 * `quoteForOrder(restaurant, type, address, subtotalInCents, client)`, porque
 * a criação do pedido já resolveu o restaurante e já está dentro de uma
 * transação — buscá-lo de novo pelo slug seria uma query a mais e uma leitura
 * fora da transação.
 */

export type DeliveryQuoteResult = DeliveryQuote & {
  /**
   * Só faz sentido no modo `neighborhood` — é o que alimenta um seletor na
   * tela. Nos outros modos vem vazia, porque não fomos buscar (ver abaixo).
   */
  servedNeighborhoods: string[];
};

/**
 * Cota o frete para um endereço, antes de o cliente montar o pedido.
 *
 * ⚠️ Só busca a lista de bairros no modo que a usa. Buscar sempre custaria uma
 * query inútil em toda cotação de taxa fixa — a maioria das chamadas, se a
 * loja não usar cotação por bairro.
 */
export async function quote(
  slug: string,
  address: Address,
  subtotalInCents: number,
): Promise<DeliveryQuoteResult> {
  const restaurant = await restaurantsService.getBySlug(slug);

  const neighborhoods =
    restaurant.deliveryFeeMode === "neighborhood"
      ? await deliveryNeighborhoodsRepository.findByRestaurant(restaurant.id)
      : [];

  const result = quoteDelivery({
    mode: restaurant.deliveryFeeMode,
    fixedFeeInCents: restaurant.deliveryFixedFeeInCents,
    freeAboveInCents: restaurant.freeDeliveryAboveInCents,
    toArrange: restaurant.deliveryFeeToArrange,
    neighborhoods,
    addressNeighborhood: address.neighborhood,
    subtotalInCents,
  });

  return {
    ...result,
    servedNeighborhoods: neighborhoods.map((neighborhood) => neighborhood.name),
  };
}
