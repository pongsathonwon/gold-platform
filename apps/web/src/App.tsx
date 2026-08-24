import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { Routes, Route, Navigate } from "react-router-dom";
import theme from "./companyTheme";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGuard, AdminGuard } from "./auth/AuthGuard";
import { UnauthorizedError } from "./api/client";
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
import { RetailBuyListPage, RetailSellListPage } from "./pages/retail/RetailListPage";
import { RetailBuyCreatePage, RetailSellCreatePage } from "./pages/retail/RetailCreatePage";
import { RetailBuyDetailPage, RetailSellDetailPage } from "./pages/retail/RetailDetailPage";
import { TradingLayout } from "./pages/trading/TradingLayout";
import { TradingSpreadPage } from "./pages/trading/TradingSpreadPage";
import { TradingPeriodPage } from "./pages/trading/TradingPeriodPage";
import { TradingLedgerPage } from "./pages/trading/TradingLedgerPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * Never retry an authorisation failure.
       *
       * The default is three attempts with backoff, which on an expired session meant every query
       * on the page spent about five seconds failing before it showed anything — so a dead session
       * read as a slow, broken app. A 401 will not come good on the second try; the handler in
       * `api/client.ts` has already ended the session by the time this is consulted.
       */
      retry: (failureCount, error) => {
        if (error instanceof UnauthorizedError) return false;
        return failureCount < 2;
      },
      /**
       * Master data (brands, purities, product types, suppliers) is administered rarely and read
       * on nearly every page. Five minutes stops a tab-switch refetching the whole reference set;
       * transaction and inventory queries override this where freshness matters.
       */
      staleTime: 5 * 60 * 1000,
    },
  },
});

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
                  {/* The three adjustment forms move gold on the books with no counterparty
                      behind them, and the API restricts them to ADMIN. */}
                  <Route element={<AdminGuard />}>
                    <Route path="gain" element={<StockGainPage />} />
                    <Route path="loss" element={<StockLossPage />} />
                    <Route path="switch" element={<ProductSwitchPage />} />
                  </Route>
                </Route>
                <Route path="/wholesale-buy" element={<WholesaleBuyListPage />} />
                <Route path="/wholesale-buy/new" element={<WholesaleBuyCreatePage />} />
                <Route path="/wholesale-buy/:id" element={<WholesaleBuyDetailPage />} />
                <Route path="/wholesale-sell" element={<WholesaleSellListPage />} />
                <Route path="/wholesale-sell/new" element={<WholesaleSellCreatePage />} />
                <Route path="/wholesale-sell/:id" element={<WholesaleSellDetailPage />} />
                {/* Retail is open to any operator, like wholesale: recording the day's counter
                    trades is ordinary work. The ADMIN gate is for the inventory adjustments, which
                    move gold with nobody on the other side of the transaction. */}
                <Route path="/retail-buy" element={<RetailBuyListPage />} />
                <Route path="/retail-buy/new" element={<RetailBuyCreatePage />} />
                <Route path="/retail-buy/:id" element={<RetailBuyDetailPage />} />
                <Route path="/retail-sell" element={<RetailSellListPage />} />
                <Route path="/retail-sell/new" element={<RetailSellCreatePage />} />
                <Route path="/retail-sell/:id" element={<RetailSellDetailPage />} />
                {/* Three readings of one window, offered side by side because BU has not chosen
                    between them. The layout owns the window and the data so the tabs cannot
                    disagree — which is the whole point of showing all three. */}
                <Route path="/trading" element={<TradingLayout />}>
                  <Route index element={<TradingSpreadPage />} />
                  <Route path="periods" element={<TradingPeriodPage />} />
                  <Route path="ledger" element={<TradingLedgerPage />} />
                </Route>
              </Route>
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
