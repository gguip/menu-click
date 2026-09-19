import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { installSessionExpiry } from "./auth/sessionExpiry.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { routes } from "./router.tsx";

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);
installSessionExpiry(queryClient, router);

export function App() {
  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
