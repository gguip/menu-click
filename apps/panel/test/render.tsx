import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, type RouteObject, useLocation } from "react-router";
import { RouterProvider } from "react-router/dom";
import { cssVariablesResolver, theme } from "../src/theme/theme.ts";

type TestRouter = ReturnType<typeof createMemoryRouter>;

export type RenderOptions = {
  /** Roda antes do render — para instalar handlers que o boot do app instala. */
  beforeRender?: (context: { router: TestRouter; queryClient: QueryClient }) => void;
};

export function renderRoutes(routes: RouteObject[], initialPath: string, options: RenderOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  options.beforeRender?.({ router, queryClient });
  const view = render(
    // env="test": sem transições e sem portal — Modal, Drawer e Menu
    // renderizam no lugar, e a Testing Library os enxerga.
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} env="test">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
  return { ...view, router, queryClient };
}

/** Mostra onde o roteador está, para asserções de navegação. */
export function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}
