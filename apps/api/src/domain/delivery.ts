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

/**
 * A chave de comparação de um bairro: sem acento, sem caixa, sem espaço
 * sobrando.
 *
 * Usa a mesma técnica do `slugify` (`normalize("NFD")` separa a letra do
 * acento, e o filtro de `\p{M}` tira só o acento), mas **não** é o `slugify`:
 * aquele produz URL — corta no tamanho, troca espaço por hífen. Este produz
 * chave de igualdade, e precisa que "Jardim América" e "jardim  america"
 * colidam sem virar "jardim-america".
 */
export function normalizeNeighborhood(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Um bairro atendido, como o restaurante o define. */
export type DeliveryNeighborhoodInput = {
  name: string;
  feeInCents: number;
};

/**
 * Um bairro atendido, como a API o devolve. Sem `id`: a lista é substituída
 * inteira a cada `PUT` (ver `services/delivery-neighborhoods.ts`), então não
 * há identidade estável para o cliente guardar entre uma chamada e outra.
 */
export type DeliveryNeighborhood = DeliveryNeighborhoodInput;
