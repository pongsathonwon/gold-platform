import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { Routes, Route } from "react-router-dom";
import { UserList } from "./components/UserList";

const queryClient = new QueryClient();
const theme = createTheme();

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/" element={<UserList />} />
        </Routes>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
