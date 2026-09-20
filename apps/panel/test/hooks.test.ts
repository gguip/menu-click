import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCountdown } from "../src/lib/useCountdown.ts";
import { useOnline } from "../src/lib/useOnline.ts";

describe("hooks genéricos", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("useCountdown desce um por segundo até zero", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCountdown());
    act(() => result.current.start(2));
    expect(result.current.seconds).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.seconds).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.seconds).toBe(0);
  });

  it("useOnline acompanha os eventos de rede do navegador", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
  });
});
