import type { PoolClient } from "pg";
import type { DeliveryQuote } from "../domain/delivery.ts";
import { normalizeNeighborhood, quoteDelivery } from "../domain/delivery.ts";
import type { OrderType } from "../domain/order.ts";
import type { Address, Restaurant } from "../domain/restaurant.ts";
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
    acceptsDelivery: restaurant.isDelivery,
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
    // filtra nome que normaliza para vazio pelo mesmo motivo do cálculo: o
    // serviço recusa cadastrá-lo, mas uma linha escrita por fora da API não
    // pode sujar o seletor que a tela monta com esta lista
    servedNeighborhoods: neighborhoods
      .filter((neighborhood) => normalizeNeighborhood(neighborhood.name) !== "")
      .map((neighborhood) => neighborhood.name),
  };
}

/**
 * Cota o frete para a CRIAÇÃO do pedido — a irmã de `quote()`.
 *
 * A diferença não é estilo, é o contexto em que cada uma roda: `quote()` serve
 * o endpoint público, que só tem o `slug` e nenhuma transação aberta.
 * `quoteForOrder` roda dentro da transação de `services/orders.ts`, que já
 * resolveu o `restaurant` — buscá-lo de novo pelo slug seria uma query a mais
 * e uma leitura fora da transação (poderia enxergar uma config diferente da
 * que o resto da criação está usando).
 *
 * ⚠️ Pedido que não é `delivery` devolve `{ deliversTo: true, feeInCents: null }`
 * SEM consultar nada: salão e retirada não têm frete, e o `check` do banco
 * (`orders_delivery_fee_check`) recusaria um valor ali de qualquer jeito.
 *
 * `address` só é lido quando `type === "delivery"` — nas outras duas
 * modalidades ele vem `undefined` (o serviço de pedidos já confirmou isso em
 * `assertEnderecoCoerente`, antes de abrir a transação).
 */
export async function quoteForOrder(
  restaurant: Restaurant,
  type: OrderType,
  address: Address | undefined,
  subtotalInCents: number,
  client: PoolClient,
): Promise<DeliveryQuote> {
  if (type !== "delivery") {
    return { deliversTo: true, feeInCents: null, isFree: false, toArrange: false };
  }

  const neighborhoods =
    restaurant.deliveryFeeMode === "neighborhood"
      ? await deliveryNeighborhoodsRepository.findByRestaurant(
          restaurant.id,
          client,
        )
      : [];

  return quoteDelivery({
    acceptsDelivery: restaurant.isDelivery,
    mode: restaurant.deliveryFeeMode,
    fixedFeeInCents: restaurant.deliveryFixedFeeInCents,
    freeAboveInCents: restaurant.freeDeliveryAboveInCents,
    toArrange: restaurant.deliveryFeeToArrange,
    neighborhoods,
    // `assertEnderecoCoerente` já garantiu `address` presente em `delivery`
    addressNeighborhood: (address as Address).neighborhood,
    subtotalInCents,
  });
}
