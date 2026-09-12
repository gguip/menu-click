/**
 * Taxa de entrega — tipos e o cálculo, sem runtime de infraestrutura.
 *
 * O cálculo mora aqui, e não no serviço, porque é função pura de
 * (configuração, endereço, subtotal) para (cotação). Isso o torna testável sem
 * banco e sem HTTP, que é o que uma regra de dinheiro precisa.
 */

/**
 * Como o restaurante cobra. União `as const`: o runtime proíbe `enum`.
 * Todos os modos que a COLUNA aceita (o `check` da migration) — nem todos
 * são selecionáveis pela API hoje, ver `SELECTABLE_DELIVERY_FEE_MODES`.
 */
export const DELIVERY_FEE_MODES = ["neighborhood", "distance", "fixed"] as const;
export type DeliveryFeeMode = (typeof DELIVERY_FEE_MODES)[number];

/**
 * Os modos que a API deixa a loja escolher HOJE. `distance` só entra quando as
 * faixas de km e o Nominatim existirem (Parte 2): até lá ele não calcula nada,
 * e deixar a loja selecioná-lo seria oferecer um estado quebrado.
 */
export const SELECTABLE_DELIVERY_FEE_MODES = ["neighborhood", "fixed"] as const;
