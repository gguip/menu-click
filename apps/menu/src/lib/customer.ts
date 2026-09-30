/**
 * Nome e telefone de quem pede, lembrados NO APARELHO para o próximo pedido
 * não começar do zero. Uma chave só, e não por loja: é dado da pessoa, não da
 * loja. Nunca sai daqui — o servidor só recebe o que vai em cada pedido.
 *
 * Grava só depois de um pedido que deu certo (o que foi digitado e não virou
 * pedido não fica) e vence 30 dias depois do último pedido: "temporário" num
 * celular que pode trocar de mão. Storage bloqueado é "não lembrar", nunca erro.
 */
export const CUSTOMER_KEY = "customer";
export const CUSTOMER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type RememberedAddress = {
  neighborhood: string;
  street: string;
  number: string;
  complement: string;
  zip: string;
};

export type RememberedCustomer = { name: string; phone: string; address?: RememberedAddress };

function isAddress(value: unknown): value is RememberedAddress {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return ["neighborhood", "street", "number", "complement", "zip"].every((k) => typeof a[k] === "string");
}

/**
 * Pedido de retirada não traz endereço, e isso não é motivo para esquecer o
 * de quem pediu entrega na semana passada: sem endereço novo, fica o antigo.
 */
export function saveCustomer(customer: RememberedCustomer, now = Date.now()): void {
  try {
    const address = customer.address ?? loadCustomer(now)?.address;
    localStorage.setItem(
      CUSTOMER_KEY,
      JSON.stringify({ name: customer.name, phone: customer.phone, ...(address ? { address } : {}), savedAt: now }),
    );
  } catch {
    // sem storage: a pessoa digita de novo no próximo pedido
  }
}

export function loadCustomer(now = Date.now()): RememberedCustomer | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const valid =
      typeof saved.name === "string" && typeof saved.phone === "string" && typeof saved.savedAt === "number";
    if (!valid || now - (saved.savedAt as number) > CUSTOMER_TTL_MS) {
      clearCustomer();
      return null;
    }
    return {
      name: saved.name as string,
      phone: saved.phone as string,
      // endereço adulterado sai sozinho; nome e telefone continuam valendo
      ...(isAddress(saved.address) ? { address: saved.address } : {}),
    };
  } catch {
    return null;
  }
}

export function clearCustomer(): void {
  try {
    localStorage.removeItem(CUSTOMER_KEY);
  } catch {
    // sem storage: não havia o que apagar
  }
}
