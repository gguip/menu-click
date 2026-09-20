/**
 * Intervalos de atualização de pedido. Orçamento de rate limit (100 req/min
 * por IP), com a aritmética real (FIX 3 da revisão — a conta antiga contava
 * só a lista, o resumo e os pendentes, e esquecia o restaurante do shell e o
 * detalhe do drawer):
 *
 * - lista (`useOrders`) + resumo (`useSummary`) + pendentes
 *   (`useNewOrderAlert`), os três a cada 10 s → 6/min cada → **18 req/min**;
 * - o restaurante, a cada 30 s → **2 req/min**, e só uma vez: só o
 *   `PanelLayout` chama `usePolledRestaurant` (o dono do polling); `OrdersPage`
 *   e o cabeçalho do drawer chamam `useRestaurant`, que lê a MESMA query sem
 *   intervalo próprio — antes, as três chamadas tinham cada uma seu timer de
 *   30 s desalinhado, e a soma passava perto do dobro do que o comentário
 *   antigo prometia;
 * - o detalhe do pedido (`useOrder`), só enquanto o drawer está aberto, a
 *   cada 20 s → **3 req/min** — a lista já atualiza a cada 10 s e qualquer
 *   ação invalida `["orders"]`, então o detalhe não precisa do mesmo ritmo
 *   da lista.
 *
 * Total por aparelho: 18 + 2 = **20 req/min** parado em Pedidos, **23
 * req/min** com o drawer aberto. Dois aparelhos da loja atrás do mesmo IP
 * (CGNAT, mesma praça de alimentação) somam os dois orçamentos — perto de
 * **46 req/min** com os dois drawers abertos — e ainda ficam abaixo do teto
 * de 100/min por IP, mas a margem não é folgada: um terceiro aparelho, ou um
 * quarto, come o que sobrou rápido.
 */
export const ORDERS_POLL_MS = 10_000;

/** Só o detalhe do pedido, e só enquanto o drawer está aberto — ver acima. */
export const ORDER_DETAIL_POLL_MS = 20_000;
