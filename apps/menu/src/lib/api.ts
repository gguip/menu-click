import type { Menu, MenuOptionGroup, MenuRestaurant, MenuSection } from "./types.ts";

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
  const res = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as MenuRestaurant) : null;
}

/** O rótulo da mesa do QR, ou `null` (adesivo velho, mesa removida, hash girado). */
export async function resolveTable(slug: string, hash: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}/table/${encodeURIComponent(hash)}`, {
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as { label: string }).label : null;
  } catch {
    return null;
  }
}

export type OrderItemBody = {
  productId: string;
  quantity: number;
  options?: { optionId: string; quantity: number }[];
  note?: string;
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

export async function createDineInOrder(restaurantId: string, body: DineInOrderBody): Promise<{ id: string; number: number }> {
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
  const payload = (await res.json().catch(() => null)) as { message?: string; id?: string; number?: number } | null;
  if (!res.ok) throw new OrderError(res.status, payload?.message ?? "Não deu para enviar. Tente de novo.");
  return { id: payload?.id as string, number: payload?.number as number };
}
