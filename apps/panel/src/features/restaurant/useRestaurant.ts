import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRestaurant, updateRestaurant } from "../../api/restaurant.ts";

export function restaurantQueryKey(id: string) {
  return ["restaurant", id] as const;
}

export function useRestaurant(id: string) {
  return useQuery({
    queryKey: restaurantQueryKey(id),
    queryFn: () => getRestaurant(id),
    // outro aparelho da loja pode pausar: a faixa não pode mentir por muito tempo
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
