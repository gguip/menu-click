/**
 * Modelo de pedido — tipos compartilhados pelas três camadas.
 *
 * A única exceção ao "domínio não tem runtime" é `ORDER_STATUSES`: a lista dos
 * status é vocabulário do domínio e precisa existir como **valor** em dois
 * lugares (o `enum` do JSON Schema na rota e o tipo aqui). Duplicá-la seria
 * pior — o `check` do banco já é a terceira cópia inevitável.
 */
import type { Customer, CreateCustomerInput } from "./customer.ts";
import type { Address } from "./restaurant.ts";

/**
 * Modalidade do pedido.
 *
 * Era inferida do endereço — com endereço, entrega; sem endereço, mesa. Retirada
 * quebrou essa inferência (também não tem endereço, e não é mesa), então virou
 * campo explícito.
 *
 * É ela que decide **três** coisas: por quais estados o pedido passa, se ele
 * exige endereço, e se o cliente recebe token de acompanhamento.
 */
export const ORDER_TYPES = ["dine_in", "takeaway", "delivery"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/**
 * Ciclo de vida do pedido.
 *
 * `as const` + índice, nunca `enum`: o projeto roda TypeScript nativo no Node
 * (`erasableSyntaxOnly`), onde `enum` não é sintaxe apagável.
 *
 * `completed` — e não `delivered` — porque é o estado final das três trilhas:
 * "entregue" é vocabulário de delivery, e obrigaria o painel a dizer isso de um
 * prato servido na mesa. Quem escolhe a palavra é o front, pela modalidade.
 */
export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "out_for_delivery",
  "completed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * As transições legais, por modalidade — a máquina inteira num lugar só.
 *
 * Estar aqui, e não espalhada pelas rotas, é o que permite responder "esse
 * pedido pode ir para lá?" sem procurar em cinco arquivos. Estado ausente do
 * mapa é terminal: `completed` e `cancelled` não aparecem como chave porque
 * deles não se sai.
 *
 * As três trilhas divergem só no penúltimo passo, e é exatamente aí que mora a
 * regra de negócio: retirada fica "disponível para retirada", entrega "sai para
 * entrega", e o pedido de salão vai direto de preparo a servido.
 */
const TRANSITIONS: Record<
  OrderType,
  Partial<Record<OrderStatus, readonly OrderStatus[]>>
> = {
  dine_in: {
    pending: ["confirmed", "cancelled"],
    confirmed: ["preparing", "cancelled"],
    preparing: ["completed", "cancelled"],
  },
  takeaway: {
    pending: ["confirmed", "cancelled"],
    confirmed: ["preparing", "cancelled"],
    preparing: ["ready_for_pickup", "cancelled"],
    ready_for_pickup: ["completed", "cancelled"],
  },
  delivery: {
    pending: ["confirmed", "cancelled"],
    confirmed: ["preparing", "cancelled"],
    preparing: ["out_for_delivery", "cancelled"],
    out_for_delivery: ["completed", "cancelled"],
  },
};

/** O pedido pode sair de `from` para `to`? */
export function canTransition(
  type: OrderType,
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return TRANSITIONS[type][from]?.includes(to) ?? false;
}

/** Esse estado existe na trilha desta modalidade? */
export function isReachable(type: OrderType, status: OrderStatus): boolean {
  if (status === "pending") return true;
  return Object.values(TRANSITIONS[type]).some((destinos) =>
    destinos.includes(status),
  );
}

/**
 * Cancelar a partir daqui devolve o estoque?
 *
 * O corte é "a comida já existe". Em `confirmed` e `preparing` as unidades
 * foram debitadas mas ainda dá para aproveitar o insumo. Depois que o pedido
 * saiu para entrega ou ficou pronto no balcão, o prato existe — devolvê-lo ao
 * estoque seria mentir sobre o que há na cozinha. Em `pending` nada foi
 * debitado, então não há o que devolver.
 */
export function cancellingReturnsStock(from: OrderStatus): boolean {
  return from === "confirmed" || from === "preparing";
}

/** Uma linha do pedido, como o cliente pede: qual produto e quanto dele. */
export type CreateOrderItemInput = {
  productId: string;
  quantity: number;
};

/**
 * Corpo de criação de pedido. `restaurantId` vem da rota.
 *
 * O cliente vem embutido em vez de por `customerId`: sem login, o app não teria
 * como saber o id antes. O serviço resolve pelo telefone (acha ou cria).
 */
export type CreateOrderInput = {
  /** Decide a trilha de status, se exige endereço e se há acompanhamento. */
  type: OrderType;
  customer: CreateCustomerInput;
  items: CreateOrderItemInput[];
  /** Obrigatório em `delivery`, proibido nas outras duas modalidades. */
  deliveryAddress?: Address;
};

/**
 * Item já gravado: `name` e `priceInCents` são **cópias** do produto no momento
 * do pedido, não uma leitura de `products`. Reajuste de cardápio não mexe em
 * pedido antigo.
 */
export type OrderItem = {
  id: string;
  productId: string;
  name: string;
  priceInCents: number;
  quantity: number;
};

/**
 * Pedido sem os itens — o que a listagem devolve.
 *
 * A lista não carrega itens de propósito: seriam N consultas (ou um join que
 * multiplica linhas) para uma tela que só mostra cliente, status e total. Quem
 * quer o detalhe busca o pedido pelo id.
 */
export type OrderSummary = {
  id: string;
  restaurantId: string;
  customer: Customer;
  type: OrderType;
  status: OrderStatus;
  totalInCents: number;
  /** Preenchido só em `delivery`; `null` nas outras duas modalidades. */
  deliveryAddress: Address | null;
  createdAt: string;
  updatedAt: string;
};

/** Pedido completo, com os itens. É o que `GET /orders/:id` devolve. */
export type Order = OrderSummary & {
  items: OrderItem[];
};
