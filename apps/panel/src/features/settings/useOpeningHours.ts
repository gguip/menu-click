import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getOpeningHours, putOpeningHours } from "../../api/openingHours.ts";

export function openingHoursQueryKey(restaurantId: string) {
  return ["opening-hours", restaurantId] as const;
}

export function useOpeningHours(restaurantId: string) {
  return useQuery({
    queryKey: openingHoursQueryKey(restaurantId),
    queryFn: () => getOpeningHours(restaurantId),
  });
}

export function useSaveOpeningHours(restaurantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hours: { weekday: number; opensAt: string; closesAt: string }[]) =>
      putOpeningHours(restaurantId, hours),
    onSuccess: (hours) => queryClient.setQueryData(openingHoursQueryKey(restaurantId), hours),
  });
}
