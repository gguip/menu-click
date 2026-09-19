import { AppProviders, createQueryClient } from "./providers.tsx";

const queryClient = createQueryClient();

export function App() {
  return (
    <AppProviders queryClient={queryClient}>
      <h1>MenuClick</h1>
    </AppProviders>
  );
}
