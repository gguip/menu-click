import { describe, expect, it, vi } from "vitest";
import { fetchAllPages } from "../src/api/pagination.ts";

describe("fetchAllPages", () => {
  it("pede páginas seguidas até completar o total", async () => {
    const fetchPage = vi.fn(async (offset: number) => ({
      data: offset === 0 ? [1, 2] : [3],
      limit: 2,
      offset,
      total: 3,
    }));
    await expect(fetchAllPages(fetchPage)).resolves.toEqual([1, 2, 3]);
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 2]);
  });

  it("para numa página vazia mesmo se o total mentir", async () => {
    const fetchPage = vi.fn(async (offset: number) => ({ data: [], limit: 100, offset, total: 50 }));
    await expect(fetchAllPages(fetchPage)).resolves.toEqual([]);
    expect(fetchPage).toHaveBeenCalledOnce();
  });
});
