import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTable,
  deleteTable,
  listAllTables,
  renameTable,
  rotateTableHash,
} from "../../api/tables.ts";

/**
 * A MESMA chave do filtro por mesa do kanban de Pedidos (`useTables`, em
 * `features/orders/useOrders.ts`): criar, renomear, girar o código ou remover
 * aqui invalida lá também, e o filtro enxerga a mudança na hora.
 */
export function tablesQueryKey(restaurantId: string) {
  return ["tables", restaurantId] as const;
}

export function useTablesList(restaurantId: string) {
  return useQuery({
    queryKey: tablesQueryKey(restaurantId),
    queryFn: () => listAllTables(restaurantId),
  });
}

function useInvalidateTables(restaurantId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: tablesQueryKey(restaurantId) });
}

export function useCreateTable(restaurantId: string) {
  const invalidate = useInvalidateTables(restaurantId);
  return useMutation({
    mutationFn: (label: string) => createTable(restaurantId, label),
    onSuccess: invalidate,
  });
}

/**
 * Uma instância por mesa (o hook é chamado dentro do cartão): com uma
 * instância dividida, `mutate()` de um cartão desanexaria o observer do
 * anterior e a falha de um `PATCH` sobreposto sumiria sem mensagem.
 */
export function useRenameTable(restaurantId: string, tableId: string) {
  const invalidate = useInvalidateTables(restaurantId);
  return useMutation({
    mutationFn: (label: string) => renameTable(restaurantId, tableId, label),
    onSuccess: invalidate,
  });
}

export function useRotateTableHash(restaurantId: string, tableId: string) {
  const invalidate = useInvalidateTables(restaurantId);
  return useMutation({
    mutationFn: () => rotateTableHash(restaurantId, tableId),
    onSuccess: invalidate,
  });
}

export function useRemoveTable(restaurantId: string, tableId: string) {
  const invalidate = useInvalidateTables(restaurantId);
  return useMutation({
    mutationFn: () => deleteTable(restaurantId, tableId),
    onSuccess: invalidate,
  });
}
