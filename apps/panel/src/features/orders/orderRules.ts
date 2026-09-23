import type { Order, OrderStatus, OrderTransition, OrderType } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import { orderCode } from "../../lib/orderCode.ts";
import { formatClock } from "../../lib/time.ts";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";

export type ColumnId = "new" | "preparing" | "ready" | "done";

export type Column = {
  id: ColumnId;
  title: string;
  statuses: readonly OrderStatus[];
  empty: string;
};

/** As quatro colunas do kanban: cada uma corresponde a uma ação física. */
export const COLUMNS: readonly Column[] = [
  { id: "new", title: "Novos", statuses: ["pending"], empty: "Nada esperando aceite." },
  {
    id: "preparing",
    title: "Em preparo",
    statuses: ["confirmed", "preparing"],
    empty: "A cozinha está livre.",
  },
  {
    id: "ready",
    title: "Prontos",
    statuses: ["out_for_delivery", "ready_for_pickup"],
    empty: "Nada aguardando saída.",
  },
  {
    id: "done",
    title: "Finalizados",
    statuses: ["completed", "cancelled"],
    empty: "Nenhum pedido encerrado hoje.",
  },
];

/**
 * Um status desconhecido cai em "Finalizados", em vez de estourar. A API já
 * declara que o conjunto de status pode mudar (pendência de backend na
 * spec), e um `throw` aqui não tem `errorElement` que o pegue antes do
 * `RouteError` do layout — a tela inteira ficava em branco por causa de UM
 * pedido com status que o painel ainda não conhece. "Finalizados" é o lugar
 * onde um status estranho incomoda menos: já é a coluna sem ação disponível,
 * então nada tenta transicionar um pedido que ninguém entende (FIX 6).
 */
export function columnOf(status: OrderStatus): ColumnId {
  const column = COLUMNS.find((candidate) => candidate.statuses.includes(status));
  return column?.id ?? "done";
}

export function groupByColumn(orders: readonly Order[]): Record<ColumnId, Order[]> {
  const groups: Record<ColumnId, Order[]> = { new: [], preparing: [], ready: [], done: [] };
  for (const order of orders) groups[columnOf(order.status)].push(order);
  return groups;
}

export function isClosed(status: OrderStatus): boolean {
  return status === "completed" || status === "cancelled";
}

export type PrimaryAction = {
  transition: Exclude<OrderTransition, "cancel">;
  /** Rótulo no drawer (botão de 46 px). */
  label: string;
  /** Rótulo curto no cartão do kanban. */
  cardLabel: string;
  /** Nota de consequência ao lado do cancelamento, no drawer. */
  note: string;
};

const NOTE_ACCEPT = "Aceitar baixa o estoque e não pode ser desfeito.";
const NOTE_RETURNS = "O cancelamento ainda devolve o estoque.";
const NOTE_KEEPS = "A partir daqui o cancelamento não devolve estoque.";

/**
 * O próximo passo, conforme a trilha da modalidade (TRANSITIONS da API).
 * `confirmed` só aparece quando o `start-preparing` do aceite encadeado
 * falhou — "Começar preparo" é a rede (spec, seção Ações).
 */
export function primaryAction(order: Pick<Order, "type" | "status">): PrimaryAction | null {
  switch (order.status) {
    case "pending":
      return { transition: "accept", label: "Aceitar pedido", cardLabel: "Aceitar", note: NOTE_ACCEPT };
    case "confirmed":
      return {
        transition: "start-preparing",
        label: "Começar preparo",
        cardLabel: "Começar preparo",
        note: NOTE_RETURNS,
      };
    case "preparing":
      if (order.type === "delivery") {
        return { transition: "dispatch", label: "Saiu para entrega", cardLabel: "Despachar", note: NOTE_RETURNS };
      }
      if (order.type === "takeaway") {
        return { transition: "ready", label: "Pronto para retirada", cardLabel: "Pronto", note: NOTE_RETURNS };
      }
      return { transition: "complete", label: "Concluir pedido", cardLabel: "Concluir", note: NOTE_RETURNS };
    case "out_for_delivery":
    case "ready_for_pickup":
      return { transition: "complete", label: "Concluir pedido", cardLabel: "Concluir", note: NOTE_KEEPS };
    default:
      return null;
  }
}

export type CancelKind = "refuse" | "return-stock" | "keep-stock";

/** O corte da API: o estoque volta até a comida ficar pronta. */
export function cancelKind(status: OrderStatus): CancelKind | null {
  switch (status) {
    case "pending":
      return "refuse";
    case "confirmed":
    case "preparing":
      return "return-stock";
    case "out_for_delivery":
    case "ready_for_pickup":
      return "keep-stock";
    default:
      return null;
  }
}

export function cancelLabel(kind: CancelKind): string {
  if (kind === "refuse") return "Recusar pedido";
  if (kind === "return-stock") return "Cancelar pedido";
  return "Cancelar (sem devolver estoque)";
}

/** Pedido de mesa se identifica pela mesa; os outros, pelo cliente. */
export function displayName(order: Pick<Order, "type" | "table" | "customer">): string {
  return order.type === "dine_in" && order.table ? order.table.label : order.customer.name;
}

export function acceptCopy(order: Order): ConfirmCopy {
  return {
    title: `Aceitar o pedido ${orderCode(order.id)}?`,
    body: `${displayName(order)} · ${formatCents(order.totalInCents)}. Aceitar manda o pedido para a cozinha e baixa o estoque dos itens.`,
    warn: "Não existe desconfirmar. Depois de aceito, só cabe cancelar.",
    cta: "Aceitar pedido",
    tone: "accent",
  };
}

/**
 * A confirmação de aceite do painel diz o nome e o total; a da cozinha, não —
 * a cozinha não decide dinheiro (handoff). O resto do texto é o mesmo. Mora
 * aqui, ao lado de `acceptCopy`, e não em `features/kitchen/kitchen.ts` —
 * `kitchen.ts` reexporta para os testes e imports existentes continuarem
 * valendo.
 */
export function kitchenAcceptCopy(order: Pick<Order, "id">): ConfirmCopy {
  return {
    title: `Aceitar o pedido ${orderCode(order.id)}?`,
    body: "Aceitar manda o pedido para a cozinha e baixa o estoque dos itens.",
    warn: "Não existe desconfirmar. Depois de aceito, só cabe cancelar, na tela de Pedidos.",
    cta: "Aceitar pedido",
    tone: "accent",
  };
}

/**
 * Três textos de cancelamento. O terceiro ("recusar") não está no handoff,
 * que reaproveitava "as unidades voltam" num pedido que nunca baixou nada —
 * afirmar algo falso sobre o estoque é o erro mais caro do fluxo.
 */
export function cancelCopy(order: Order): ConfirmCopy | null {
  const code = orderCode(order.id);
  switch (cancelKind(order.status)) {
    case "refuse":
      return {
        title: `Recusar o pedido ${code}?`,
        body: "O pedido sai da lista. O estoque não tinha sido baixado, então nada muda nele.",
        cta: "Recusar pedido",
        tone: "danger",
      };
    case "return-stock":
      return {
        title: `Cancelar o pedido ${code}?`,
        body: `O pedido ${code} sai da lista e as unidades voltam para o estoque.`,
        cta: "Cancelar e devolver estoque",
        tone: "danger",
      };
    case "keep-stock":
      return {
        title: "Cancelar sem devolver o estoque?",
        body: `A comida do pedido ${code} já ficou pronta. As unidades usadas não voltam para o estoque — só o pedido sai da lista.`,
        warn: "O estoque NÃO será devolvido.",
        cta: "Cancelar sem devolver",
        tone: "danger",
      };
    default:
      return null;
  }
}

export type Step = { label: string; state: "done" | "current" | "future"; time: string | null };

const STEP_LABELS: Record<OrderType, readonly string[]> = {
  delivery: ["Novo", "Em preparo", "Saiu para entrega", "Concluído"],
  takeaway: ["Novo", "Em preparo", "Pronto para retirada", "Concluído"],
  dine_in: ["Novo", "Em preparo", "Concluído"],
};

function stepIndex(order: Pick<Order, "type" | "status">): number {
  switch (order.status) {
    case "pending":
      return 0;
    case "confirmed":
    case "preparing":
      return 1;
    case "out_for_delivery":
    case "ready_for_pickup":
      return 2;
    default:
      return STEP_LABELS[order.type].length - 1;
  }
}

/**
 * A API só guarda `createdAt` e `updatedAt`: "Novo" leva a hora da chegada,
 * a etapa atual leva a da última mudança, e as cumpridas no meio ficam sem
 * hora (horário por etapa é pendência de backend da spec).
 */
export function progressSteps(order: Order, timeZone?: string): Step[] {
  if (order.status === "cancelled") {
    return [
      { label: "Novo", state: "done", time: formatClock(order.createdAt, timeZone) },
      { label: "Cancelado", state: "current", time: formatClock(order.updatedAt, timeZone) },
    ];
  }
  const current = stepIndex(order);
  return STEP_LABELS[order.type].map((label, index) => ({
    label,
    state: index < current ? "done" : index === current ? "current" : "future",
    time:
      index === 0
        ? formatClock(order.createdAt, timeZone)
        : index === current
          ? formatClock(order.updatedAt, timeZone)
          : null,
  }));
}

export function closedMessage(order: Order, timeZone?: string): string | null {
  if (order.status === "completed") {
    return `Pedido concluído às ${formatClock(order.updatedAt, timeZone)}. Não há mais ação possível.`;
  }
  if (order.status === "cancelled") return "Pedido cancelado. Não há mais ação possível.";
  return null;
}
