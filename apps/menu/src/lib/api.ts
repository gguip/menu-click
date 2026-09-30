import type { TableLookup } from "./table.ts";
import type { Address, Menu, MenuOptionGroup, MenuRestaurant, MenuSection, PaymentMethod } from "./types.ts";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

/** Revalidação do cardápio no servidor (ISR). Preço visto com até 60 s de atraso é aceito. */
export const MENU_REVALIDATE_SECONDS = 60;

/**
 * O cardápio inteiro, no SERVIDOR (ISR). `null` = a loja não existe (ou não
 * verificou o e-mail, que por fora é a mesma coisa). O cardápio público é
 * paginado por seção, com teto de 100 por página: percorre até o fim.
 */
export async function getMenu(slug: string): Promise<Menu | null> {
  const cache = { next: { revalidate: MENU_REVALIDATE_SECONDS } };
  const restaurantRes = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}`, cache);
  if (restaurantRes.status === 404) return null;
  if (!restaurantRes.ok) throw new Error(`cardápio de ${slug}: ${restaurantRes.status}`);
  const restaurant = (await restaurantRes.json()) as MenuRestaurant;

  const sections: MenuSection[] = [];
  const groups = new Map<string, MenuOptionGroup>();
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}/products?limit=100&offset=${offset}`, cache);
    if (!res.ok) throw new Error(`produtos de ${slug}: ${res.status}`);
    const page = (await res.json()) as { data: MenuSection[]; optionGroups: MenuOptionGroup[]; total: number };
    sections.push(...page.data);
    for (const group of page.optionGroups) groups.set(group.id, group);
    if (offset + 100 >= page.total) break;
  }
  return { restaurant, sections, optionGroups: [...groups.values()] };
}

/** Horário e pausa AGORA, no navegador e sem cache: o da página tem até 60 s. */
export async function fetchLiveRestaurant(slug: string): Promise<MenuRestaurant | null> {
  try {
    const res = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const live = (await res.json()) as Partial<MenuRestaurant>;
    // resposta sem o status (proxy, página de erro com 200) não derruba a tela
    return typeof live.isOpen === "boolean" && typeof live.acceptingOrders === "boolean"
      ? (live as MenuRestaurant)
      : null;
  } catch {
    // sem rede: fica o que veio da página (até 60 s de idade)
    return null;
  }
}

/**
 * O rótulo da mesa do QR. Só o 404 é "não existe": falha de rede, 5xx e 429
 * (a API acordando num plano gratuito) são "não deu para saber", e não podem
 * tirar a mesa de quem está sentado nela.
 */
export async function resolveTable(slug: string, hash: string): Promise<TableLookup> {
  try {
    const res = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}/table/${encodeURIComponent(hash)}`, {
      cache: "no-store",
    });
    if (res.status === 404) return { kind: "not-found" };
    if (!res.ok) return { kind: "unreachable" };
    return { kind: "found", label: ((await res.json()) as { label: string }).label };
  } catch {
    return { kind: "unreachable" };
  }
}

export type OrderItemBody = {
  productId: string;
  quantity: number;
  options?: { optionId: string; quantity: number }[];
  note?: string;
};

export type LinkOrderBody = {
  type: "delivery" | "takeaway";
  customer: { name: string; phone: string };
  items: OrderItemBody[];
  paymentMethod: PaymentMethod;
  changeForInCents?: number;
  deliveryAddress?: Address & { complement?: string };
};

export type DineInOrderBody = {
  type: "dine_in";
  customer: { name: string; phone: string };
  items: OrderItemBody[];
  paymentMethod: "cash" | "card_on_delivery" | "pix";
  tableHash?: string;
};

/** Erro com a mensagem da API (pt-BR, escrita para o cliente ler). */
export class OrderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * O que a loja GRAVOU — itens com o preço congelado e o total calculado no
 * servidor. É isto que o comprovante mostra: o cardápio do aparelho vem de uma
 * página em cache e de um carrinho guardado, e o caixa cobra o que está aqui.
 */
export type OrderReceipt = {
  id: string;
  number: number;
  type: "dine_in" | "takeaway" | "delivery";
  totalInCents: number;
  /** `null` fora da entrega e no "a combinar"; `0` = grátis. */
  deliveryFeeInCents: number | null;
  /** Só em entrega e retirada: a credencial do acompanhamento (S27). */
  trackingToken?: string;
  table: { id: string; label: string } | null;
  items: { name: string; quantity: number; unitPriceInCents: number; note: string | null }[];
};

export async function createOrder(restaurantId: string, body: DineInOrderBody | LinkOrderBody): Promise<OrderReceipt> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/restaurants/${restaurantId}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OrderError(0, "Sem conexão. Seu carrinho continua aqui — tente de novo.");
  }
  const payload = (await res.json().catch(() => null)) as (Partial<OrderReceipt> & { message?: string }) | null;
  if (!res.ok) throw new OrderError(res.status, payload?.message ?? "Não deu para enviar. Tente de novo.");
  return {
    id: payload?.id as string,
    number: payload?.number as number,
    type: payload?.type ?? body.type,
    totalInCents: payload?.totalInCents ?? 0,
    deliveryFeeInCents: payload?.deliveryFeeInCents ?? null,
    ...(payload?.trackingToken ? { trackingToken: payload.trackingToken } : {}),
    table: payload?.table ?? null,
    items: payload?.items ?? [],
  };
}

export const createDineInOrder = (restaurantId: string, body: DineInOrderBody) => createOrder(restaurantId, body);
