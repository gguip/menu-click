import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { listPendingOrders } from "../../api/orders.ts";
import { hasUserGesture, playBeep, unlockAudio } from "../../lib/audio.ts";
import { detectNewPending } from "./newOrders.ts";
import { ORDERS_POLL_MS } from "./polling.ts";

/**
 * "Um pedido novo tem que se anunciar sozinho — ninguém vai apertar F5."
 * Mora na casca do painel, então toca em qualquer tela, com qualquer filtro.
 *
 * A detecção roda DENTRO do `queryFn`, não num `useEffect` reagindo a
 * `pending.data`: o React agrupa (automatic batching) atualizações de estado
 * que chegam próximas uma da outra num commit só, e um efeito baseado em
 * `data` só enxerga o ÚLTIMO estado do grupo — um pedido que apareceu numa
 * busca "no meio" (ex.: um refetch disparado logo depois da primeira busca
 * assentar) desaparece sem apitar, porque o efeito nunca roda com o estado
 * intermediário. `queryFn` roda exatamente uma vez por busca de verdade,
 * nunca agrupado, então é o único lugar que vê cada resposta da API.
 */
export function useNewOrderAlert(restaurantId: string) {
  const seen = useRef<Set<string> | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(() => !hasUserGesture());

  const pending = useQuery({
    queryKey: ["orders", "pending", restaurantId],
    queryFn: async () => {
      const orders = await listPendingOrders(restaurantId);
      const result = detectNewPending(seen.current, orders);
      seen.current = result.seen;
      if (result.fresh.length > 0) {
        void playBeep().then((played) => setSoundBlocked(!played));
      }
      return orders;
    },
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
  });

  // defensivo: só conta o que é pendente mesmo.
  const pendingCount = pending.data?.filter((order) => order.status === "pending").length ?? 0;

  useEffect(() => {
    document.title = pendingCount > 0 ? `(${pendingCount}) Pedidos · MenuClick` : "MenuClick · Painel da loja";
  }, [pendingCount]);

  const enableSound = () => {
    void unlockAudio().then((unlocked) => setSoundBlocked(!unlocked));
  };

  return { pendingCount, soundBlocked, enableSound };
}
