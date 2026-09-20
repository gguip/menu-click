import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Com `globals: false`, a Testing Library não registra a limpeza sozinha.
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// O jsdom não implementa matchMedia, e o MantineProvider consulta o esquema
// de cor do sistema por ele.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: ResizeObserverStub,
});
window.HTMLElement.prototype.scrollIntoView = () => {};
