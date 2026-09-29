import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Nenhum teste sai para a rede: quem precisa de resposta substitui este fetch.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("fetch sem mock"))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
