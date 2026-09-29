/** "R$ 52,00" — com espaço comum (o Intl usa NBSP, que quebra busca e teste). */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100).replace(/\u00a0/g, " ");
}
