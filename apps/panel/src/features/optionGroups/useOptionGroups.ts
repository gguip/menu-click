import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOption,
  createOptionGroup,
  deleteOption,
  deleteOptionGroup,
  listAllOptionGroups,
  type NewOptionBody,
  type OptionBody,
  type OptionGroupBody,
  updateOption,
  updateOptionGroup,
} from "../../api/optionGroups.ts";
import { listAllProducts } from "../../api/products.ts";
import type { OptionGroup } from "../../api/types.ts";
import { setOptionAvailable, usageCounts } from "./optionGroups.ts";

/**
 * A MESMA chave do seletor de grupos do formulário de produto: sem isso, um
 * grupo criado aqui não apareceria lá até o cache vencer.
 */
export function optionGroupsQueryKey(restaurantId: string) {
  return ["option-groups", restaurantId] as const;
}

export function useOptionGroups(restaurantId: string) {
  return useQuery({
    queryKey: optionGroupsQueryKey(restaurantId),
    queryFn: () => listAllOptionGroups(restaurantId),
  });
}

/**
 * Debaixo do prefixo `["products", restaurantId]`: toda invalidação de
 * produto (criar, editar, trocar grupos) refaz a contagem junto.
 */
export function useOptionGroupUsage(restaurantId: string) {
  return useQuery({
    queryKey: ["products", restaurantId, "option-group-usage"],
    queryFn: async () => {
      const result = await listAllProducts(restaurantId);
      return { counts: usageCounts(result.items), truncated: result.truncated };
    },
  });
}

function useInvalidateGroups(restaurantId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: optionGroupsQueryKey(restaurantId) });
}

export function useCreateOptionGroup(restaurantId: string) {
  const invalidate = useInvalidateGroups(restaurantId);
  return useMutation({
    mutationFn: (body: OptionGroupBody) => createOptionGroup(restaurantId, body),
    onSuccess: invalidate,
  });
}

export function useUpdateOptionGroup(restaurantId: string, groupId: string) {
  const invalidate = useInvalidateGroups(restaurantId);
  return useMutation({
    mutationFn: (patch: Partial<OptionGroupBody>) => updateOptionGroup(restaurantId, groupId, patch),
    onSuccess: invalidate,
  });
}

/** Remover o grupo muda os `optionGroupIds` dos produtos: produtos (e a contagem) também invalidam. */
export function useRemoveOptionGroup(restaurantId: string, groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteOptionGroup(restaurantId, groupId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: optionGroupsQueryKey(restaurantId) }),
        queryClient.invalidateQueries({ queryKey: ["products", restaurantId] }),
      ]);
    },
  });
}

export function useCreateOption(restaurantId: string, groupId: string) {
  const invalidate = useInvalidateGroups(restaurantId);
  return useMutation({
    mutationFn: (body: NewOptionBody) => createOption(restaurantId, groupId, body),
    onSuccess: invalidate,
  });
}

export function useUpdateOption(restaurantId: string, groupId: string, optionId: string) {
  const invalidate = useInvalidateGroups(restaurantId);
  return useMutation({
    mutationFn: (patch: Partial<OptionBody>) => updateOption(restaurantId, groupId, optionId, patch),
    onSuccess: invalidate,
  });
}

export function useRemoveOption(restaurantId: string, groupId: string, optionId: string) {
  const invalidate = useInvalidateGroups(restaurantId);
  return useMutation({
    mutationFn: () => deleteOption(restaurantId, groupId, optionId),
    onSuccess: invalidate,
  });
}

/**
 * Interruptor "Disponível": o estado novo aparece na hora e volta atrás se a
 * API recusar — o mesmo comportamento dos interruptores de Modalidades. O
 * `onSettled` relê a lista, então uma volta atrás que atropele outra escrita
 * otimista em voo se corrige na releitura.
 */
export function useToggleOptionAvailable(restaurantId: string, groupId: string, optionId: string) {
  const queryClient = useQueryClient();
  const key = optionGroupsQueryKey(restaurantId);
  return useMutation({
    mutationFn: (available: boolean) => updateOption(restaurantId, groupId, optionId, { available }),
    onMutate: async (available) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<OptionGroup[]>(key);
      if (previous !== undefined) {
        queryClient.setQueryData(key, setOptionAvailable(previous, groupId, optionId, available));
      }
      return { previous };
    },
    onError: (_error, _available, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
