import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRestaurant, updateRestaurant } from "../../api/restaurant.ts";

export function restaurantQueryKey(id: string) {
  return ["restaurant", id] as const;
}

/**
 * Sem polling próprio: lê a MESMA query que `usePolledRestaurant` mantém
 * fresca. Antes das três chamadas (`PanelLayout`, `OrdersPage`,
 * `OrderDrawer`) terem, cada uma, seu próprio `refetchInterval` de 30 s
 * desalinhado — o que somava perto do dobro do orçamento de `polling.ts`
 * (FIX 3 da revisão). Use este hook em quem só PRECISA do dado.
 */
export function useRestaurant(id: string) {
  return useQuery({
    queryKey: restaurantQueryKey(id),
    queryFn: () => getRestaurant(id),
  });
}

/**
 * Único lugar que mantém `restaurant` fresco por polling — o `PanelLayout`,
 * dono do shell. Outro aparelho da loja pode pausar a qualquer momento, e a
 * faixa de pausa não pode mentir por muito tempo.
 */
export function usePolledRestaurant(id: string) {
  return useQuery({
    queryKey: restaurantQueryKey(id),
    queryFn: () => getRestaurant(id),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
}

export function useSetAcceptingOrders(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (acceptingOrders: boolean) => updateRestaurant(id, { acceptingOrders }),
    onSuccess: (restaurant) => queryClient.setQueryData(restaurantQueryKey(id), restaurant),
  });
}
