import { apiRequest } from "./client.ts";
import { fetchAllPages } from "./pagination.ts";
import type { OptionGroup, Page } from "./types.ts";

export function listAllOptionGroups(restaurantId: string): Promise<OptionGroup[]> {
  return fetchAllPages((offset) =>
    apiRequest<Page<OptionGroup>>(`/restaurants/${restaurantId}/option-groups`, {
      query: { limit: 100, offset },
    }),
  );
}
