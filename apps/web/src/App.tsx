import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { Routes, Route, Navigate } from "react-router-dom";
import theme from "./companyTheme";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGuard } from "./auth/AuthGuard";
import { ToastProvider } from "./components/ToastContext";
import { NavBar } from "./components/NavBar";
import { LoginPage } from "./pages/LoginPage";
import { InventoryPage } from "./pages/InventoryPage";
import { InventoryMovementPage } from "./pages/InventoryMovementPage";
import { StockGainPage } from "./pages/StockGainPage";
import { StockLossPage } from "./pages/StockLossPage";
import { ProductSwitchPage } from "./pages/ProductSwitchPage";

const queryClient = new QueryClient();

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <NavBar />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AuthGuard />}>
                <Route path="/" element={<Navigate to="/inventory" replace />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/inventory/movements" element={<InventoryMovementPage />} />
                <Route path="/inventory/gain" element={<StockGainPage />} />
                <Route path="/inventory/loss" element={<StockLossPage />} />
                <Route path="/inventory/switch" element={<ProductSwitchPage />} />
              </Route>
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
