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
 * Ciclo de vida do pedido.
 *
 * `as const` + índice, nunca `enum`: o projeto roda TypeScript nativo no Node
 * (`erasableSyntaxOnly`), onde `enum` não é sintaxe apagável.
 *
 * Transições permitidas hoje:
 *   pending -> confirmed   (é aqui que o estoque é debitado)
 *   pending -> cancelled
 * `confirmed` é terminal: desfazer uma confirmação exigiria devolver estoque,
 * e isso é escopo próprio (ainda não implementado).
 */
export const ORDER_STATUSES = ["pending", "confirmed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

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
  customer: CreateCustomerInput;
  items: CreateOrderItemInput[];
  /** Ausente = pedido de mesa (QR code). Presente = entrega. */
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
  status: OrderStatus;
  totalInCents: number;
  /** `null` quando o pedido é de mesa. */
  deliveryAddress: Address | null;
  createdAt: string;
  updatedAt: string;
};

/** Pedido completo, com os itens. É o que `GET /orders/:id` devolve. */
export type Order = OrderSummary & {
  items: OrderItem[];
};
