import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserList } from "./components/UserList";

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <main>
        <h1>Gold Platform</h1>
        <UserList />
      </main>
    </QueryClientProvider>
  );
}
