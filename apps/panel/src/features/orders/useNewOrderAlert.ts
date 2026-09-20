import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { listPendingOrders } from "../../api/orders.ts";
import type { Order } from "../../api/types.ts";
import { hasUserGesture, playBeep, unlockAudio } from "../../lib/audio.ts";
import { detectNewPending } from "./newOrders.ts";
import { ORDERS_POLL_MS } from "./polling.ts";

/**
 * Escopado a "hoje" (FIX 5 da revisão): `listPendingOrders` já manda
 * `period: "today"` para a API, e a chave carrega o mesmo recorte — o rail
 * âmbar, o contador e o título da aba precisam descrever o mesmo conjunto
 * que o operador vê na coluna "Novos" do kanban (que também é `today`), não
 * "todo `pending` que a loja já recebeu". Sem isso, um pedido nunca recusado
 * de dias atrás deixava o alerta ligado para sempre.
 */
function pendingQueryKey(restaurantId: string) {
  return ["orders", "pending", "today", restaurantId] as const;
}

/**
 * "Um pedido novo tem que se anunciar sozinho — ninguém vai apertar F5."
 * Mora na casca do painel, então toca em qualquer tela, com qualquer filtro.
 *
 * A detecção NÃO mora dentro do `queryFn`. O v5 tirou de propósito o
 * `onSuccess`/`onError` do `useQuery` — "um fetch terminou" não é o mesmo
 * evento que "um observer renderizou dado novo" —, e o resto do projeto já
 * segue essa regra: `onSuccess` só aparece em `useMutation`
 * (`useRestaurant.ts`), nunca em `useQuery`. `queryFn` fica puro (só busca);
 * quem reage a cada busca bem-sucedida — sem depender de o React ter
 * comprometido aquele estado específico num render, e sem prender o efeito
 * colateral ao closure de UMA chamada do hook, caso ele um dia seja
 * consumido de dois lugares ao mesmo tempo — é uma inscrição direta em
 * `queryClient.getQueryCache()`, feita uma vez no mount e cancelada no
 * unmount, filtrando só as atualizações desta chave e só as de sucesso.
 *
 * (Uma versão anterior detectava o pedido novo num `useEffect` reagindo a
 * `pending.data`, e falhava um teste do brief: um fetch que resolve logo
 * depois de outro pode nunca aparecer como o SEU PRÓPRIO render — o efeito só
 * via o último estado do grupo. Não dá para afirmar com certeza se a causa
 * exata era o batching do React ou o notifyManager do TanStack agrupando as
 * notificações; o que se sabe, medido, é que o efeito não via o estado
 * intermediário.)
 */
export function useNewOrderAlert(restaurantId: string) {
  const queryClient = useQueryClient();
  const seen = useRef<Set<string> | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(() => !hasUserGesture());

  const pending = useQuery({
    queryKey: pendingQueryKey(restaurantId),
    queryFn: () => listPendingOrders(restaurantId),
    refetchInterval: ORDERS_POLL_MS,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    let active = true;
    const key = pendingQueryKey(restaurantId);
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (JSON.stringify(event.query.queryKey) !== JSON.stringify(key)) return;
      const orders = event.action.data as Order[] | undefined;
      if (orders === undefined) return;
      const result = detectNewPending(seen.current, orders);
      seen.current = result.seen;
      if (result.fresh.length > 0) {
        void playBeep().then((played) => {
          // guarda de unmount: a promessa pode assentar depois de a tela sair.
          if (active) setSoundBlocked(!played);
        });
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [queryClient, restaurantId]);

  // defensivo: só conta o que é pendente mesmo.
  const pendingCount = pending.data?.filter((order) => order.status === "pending").length ?? 0;

  useEffect(() => {
    document.title = pendingCount > 0 ? `(${pendingCount}) Pedidos · MenuClick` : "MenuClick · Painel da loja";
    // Ao desmontar (logout, navegação para fora do painel) o título volta ao
    // default — sem isso, a aba de login continuava lendo "(3) Pedidos ·
    // MenuClick" depois de sair da conta (FIX 8 da revisão).
    return () => {
      document.title = "MenuClick · Painel da loja";
    };
  }, [pendingCount]);

  const enableSound = () => {
    void unlockAudio().then((unlocked) => setSoundBlocked(!unlocked));
  };

  return { pendingCount, soundBlocked, enableSound };
}
