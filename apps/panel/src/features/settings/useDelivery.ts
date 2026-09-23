import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listNeighborhoods, putNeighborhoods } from "../../api/delivery.ts";
import type { DeliveryNeighborhood } from "../../api/types.ts";

/**
 * A MESMA chave do `useDeliveryAlert` (`features/orders/useOrders.ts`):
 * salvar os bairros aqui atualiza sozinho o aviso do kanban e o de
 * Modalidades.
 */
export function neighborhoodsQueryKey(restaurantId: string) {
  return ["delivery-neighborhoods", restaurantId] as const;
}

export function useNeighborhoods(restaurantId: string) {
  return useQuery({
    queryKey: neighborhoodsQueryKey(restaurantId),
    queryFn: () => listNeighborhoods(restaurantId),
  });
}

export function useSaveNeighborhoods(restaurantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (neighborhoods: DeliveryNeighborhood[]) => putNeighborhoods(restaurantId, neighborhoods),
    onSuccess: (saved) => queryClient.setQueryData(neighborhoodsQueryKey(restaurantId), saved),
  });
}
