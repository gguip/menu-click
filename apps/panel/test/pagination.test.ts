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
    await expect(fetchAllPages(fetchPage)).resolves.toEqual({ items: [1, 2, 3], truncated: false });
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 2]);
  });

  it("para numa página vazia mesmo se o total mentir", async () => {
    const fetchPage = vi.fn(async (offset: number) => ({ data: [], limit: 100, offset, total: 50 }));
    await expect(fetchAllPages(fetchPage)).resolves.toEqual({ items: [], truncated: false });
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it("estoura o teto de páginas e avisa com `truncated: true`, sem sumir calado", async () => {
    const fetchPage = vi.fn(async (offset: number) => ({
      data: [offset],
      limit: 1,
      offset,
      total: 1000,
    }));
    const result = await fetchAllPages(fetchPage, 3);
    expect(result).toEqual({ items: [0, 1, 2], truncated: true });
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});
