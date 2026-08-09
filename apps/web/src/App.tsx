import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { Routes, Route, Navigate } from "react-router-dom";
import theme from "./companyTheme";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGuard } from "./auth/AuthGuard";
import { ToastProvider } from "./components/ToastContext";
import { NavBar } from "./components/NavBar";
import { LoginPage } from "./pages/LoginPage";
import { InventoryLayout } from "./pages/InventoryLayout";
import { InventoryPage } from "./pages/InventoryPage";
import { InventoryMovementPage } from "./pages/InventoryMovementPage";
import { StockGainPage } from "./pages/StockGainPage";
import { StockLossPage } from "./pages/StockLossPage";
import { ProductSwitchPage } from "./pages/ProductSwitchPage";
import { WholesaleBuyListPage } from "./pages/WholesaleBuyListPage";
import { WholesaleBuyCreatePage } from "./pages/WholesaleBuyCreatePage";
import { WholesaleBuyDetailPage } from "./pages/WholesaleBuyDetailPage";
import { WholesaleSellListPage } from "./pages/WholesaleSellListPage";
import { WholesaleSellCreatePage } from "./pages/WholesaleSellCreatePage";
import { WholesaleSellDetailPage } from "./pages/WholesaleSellDetailPage";

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
                <Route path="/inventory" element={<InventoryLayout />}>
                  <Route index element={<InventoryPage />} />
                  <Route path="movements" element={<InventoryMovementPage />} />
                  <Route path="gain" element={<StockGainPage />} />
                  <Route path="loss" element={<StockLossPage />} />
                  <Route path="switch" element={<ProductSwitchPage />} />
                </Route>
                <Route path="/wholesale-buy" element={<WholesaleBuyListPage />} />
                <Route path="/wholesale-buy/new" element={<WholesaleBuyCreatePage />} />
                <Route path="/wholesale-buy/:id" element={<WholesaleBuyDetailPage />} />
                <Route path="/wholesale-sell" element={<WholesaleSellListPage />} />
                <Route path="/wholesale-sell/new" element={<WholesaleSellCreatePage />} />
                <Route path="/wholesale-sell/:id" element={<WholesaleSellDetailPage />} />
              </Route>
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
