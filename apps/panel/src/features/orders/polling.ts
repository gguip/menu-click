/**
 * Intervalo de atualização de tudo que é pedido. Orçamento de rate limit
 * (100 req/min por IP): lista + resumo + pendentes = 18 req/min por aparelho;
 * dois aparelhos da loja atrás do mesmo IP ficam longe do teto.
 */
export const ORDERS_POLL_MS = 10_000;
