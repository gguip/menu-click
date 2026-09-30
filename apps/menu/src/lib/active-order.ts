// apps/menu/src/lib/active-order.ts
/**
 * O pedido em andamento, guardado no aparelho para o link de acompanhamento
 * não se perder se a aba fechar. UM por loja (o mais recente), e só enquanto
 * está em andamento: quem o tira é quem descobre que terminou (a faixa do
 * cardápio e a página de acompanhamento), ou o prazo de 24 h. Nunca vira
 * histórico de pedidos.
 */
export const ACTIVE_ORDER_TTL_MS = 24 * 60 * 60 * 1000;

export type ActiveOrder = { orderId: string; token: string };

const key = (slug: string) => `order:${slug}`;

export function saveActiveOrder(slug: string, order: ActiveOrder, now = Date.now()): void {
  try {
    localStorage.setItem(key(slug), JSON.stringify({ ...order, savedAt: now }));
  } catch {
    // sem storage: o link da tela de enviado continua sendo o caminho
  }
}

export function loadActiveOrder(slug: string, now = Date.now()): ActiveOrder | null {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const valid =
      typeof saved.orderId === "string" && typeof saved.token === "string" && typeof saved.savedAt === "number";
    if (!valid || now - (saved.savedAt as number) > ACTIVE_ORDER_TTL_MS) {
      clearActiveOrder(slug);
      return null;
    }
    return { orderId: saved.orderId as string, token: saved.token as string };
  } catch {
    return null;
  }
}

export function clearActiveOrder(slug: string): void {
  try {
    localStorage.removeItem(key(slug));
  } catch {
    // sem storage: não havia o que apagar
  }
}
