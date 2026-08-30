import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Box, CircularProgress, CssBaseline, ThemeProvider } from "@mui/material";
import { Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, type ReactElement } from "react";
import theme from "./companyTheme";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGuard, AdminGuard } from "./auth/AuthGuard";
import { UnauthorizedError } from "./api/client";
import { ToastProvider } from "./components/ToastContext";
import { NavBar } from "./components/NavBar";
import { LoginPage } from "./pages/LoginPage";

/**
 * Every page below the login screen is loaded on demand.
 *
 * The whole app used to be one 739 KB script, so an operator opening the retail list downloaded
 * both wholesale detail pages, all three trading views and the three admin adjustment forms before
 * anything rendered. Nobody visits more than a handful of these in a session, and the ADMIN-only
 * pages are dead weight for the operators who make up most of the logins.
 *
 * `LoginPage` is deliberately **not** lazy. It is the one route an unauthenticated visitor always
 * lands on, so deferring it would buy a second round trip on the critical path to trade the
 * fastest paint in the app for nothing.
 *
 * Pages export named components, hence the `.then(...)` unwrapping — `lazy` wants a default.
 */
const lazyPage = <M, K extends keyof M>(load: () => Promise<M>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType })));

const UsersPage = lazyPage(() => import("./pages/UsersPage"), "UsersPage");
const InventoryLayout = lazyPage(() => import("./pages/InventoryLayout"), "InventoryLayout");
const InventoryPage = lazyPage(() => import("./pages/InventoryPage"), "InventoryPage");
const InventoryMovementPage = lazyPage(() => import("./pages/InventoryMovementPage"), "InventoryMovementPage");
const StockGainPage = lazyPage(() => import("./pages/StockGainPage"), "StockGainPage");
const StockLossPage = lazyPage(() => import("./pages/StockLossPage"), "StockLossPage");
const ProductSwitchPage = lazyPage(() => import("./pages/ProductSwitchPage"), "ProductSwitchPage");
const WholesaleBuyListPage = lazyPage(() => import("./pages/WholesaleBuyListPage"), "WholesaleBuyListPage");
const WholesaleBuyCreatePage = lazyPage(() => import("./pages/WholesaleBuyCreatePage"), "WholesaleBuyCreatePage");
const WholesaleBuyDetailPage = lazyPage(() => import("./pages/WholesaleBuyDetailPage"), "WholesaleBuyDetailPage");
const WholesaleSellListPage = lazyPage(() => import("./pages/WholesaleSellListPage"), "WholesaleSellListPage");
const WholesaleSellCreatePage = lazyPage(() => import("./pages/WholesaleSellCreatePage"), "WholesaleSellCreatePage");
const WholesaleSellDetailPage = lazyPage(() => import("./pages/WholesaleSellDetailPage"), "WholesaleSellDetailPage");
/**
 * The retail pair is one implementation behind two component types, and that must survive here.
 * Two `lazy()` calls on the same module share one network fetch but produce two distinct types, so
 * routing from `/retail-buy` to `/retail-sell` still remounts rather than letting React reconcile
 * one component whose hooks would swap underneath it. See `apps/web/CLAUDE.md` §9g.
 */
const RetailBuyListPage = lazyPage(() => import("./pages/retail/RetailListPage"), "RetailBuyListPage");
const RetailSellListPage = lazyPage(() => import("./pages/retail/RetailListPage"), "RetailSellListPage");
const RetailBuyCreatePage = lazyPage(() => import("./pages/retail/RetailCreatePage"), "RetailBuyCreatePage");
const RetailSellCreatePage = lazyPage(() => import("./pages/retail/RetailCreatePage"), "RetailSellCreatePage");
const RetailBuyDetailPage = lazyPage(() => import("./pages/retail/RetailDetailPage"), "RetailBuyDetailPage");
const RetailSellDetailPage = lazyPage(() => import("./pages/retail/RetailDetailPage"), "RetailSellDetailPage");
const TradingLayout = lazyPage(() => import("./pages/trading/TradingLayout"), "TradingLayout");
const TradingSpreadPage = lazyPage(() => import("./pages/trading/TradingSpreadPage"), "TradingSpreadPage");
const TradingPeriodPage = lazyPage(() => import("./pages/trading/TradingPeriodPage"), "TradingPeriodPage");
const TradingLedgerPage = lazyPage(() => import("./pages/trading/TradingLedgerPage"), "TradingLedgerPage");

/**
 * Wraps one route element in its own Suspense boundary.
 *
 * Per route rather than once around `<Routes>`: a single outer boundary would blank the layout
 * chrome — the inventory and trading tab bars — every time someone switched tabs underneath it,
 * because the nearest boundary above the suspending child would be outside the layout. Here the
 * layout stays mounted and only the panel it wraps shows the spinner.
 */
const page = (element: ReactElement) => (
  <Suspense
    fallback={
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    }
  >
    {element}
  </Suspense>
);

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
                <Route path="/inventory" element={page(<InventoryLayout />)}>
                  <Route index element={page(<InventoryPage />)} />
                  <Route path="movements" element={page(<InventoryMovementPage />)} />
                  {/* The three adjustment forms move gold on the books with no counterparty
                      behind them, and the API restricts them to ADMIN. */}
                  <Route element={<AdminGuard />}>
                    <Route path="gain" element={page(<StockGainPage />)} />
                    <Route path="loss" element={page(<StockLossPage />)} />
                    <Route path="switch" element={page(<ProductSwitchPage />)} />
                  </Route>
                </Route>
                <Route path="/wholesale-buy" element={page(<WholesaleBuyListPage />)} />
                <Route path="/wholesale-buy/new" element={page(<WholesaleBuyCreatePage />)} />
                <Route path="/wholesale-buy/:id" element={page(<WholesaleBuyDetailPage />)} />
                <Route path="/wholesale-sell" element={page(<WholesaleSellListPage />)} />
                <Route path="/wholesale-sell/new" element={page(<WholesaleSellCreatePage />)} />
                <Route path="/wholesale-sell/:id" element={page(<WholesaleSellDetailPage />)} />
                {/* Retail is open to any operator, like wholesale: recording the day's counter
                    trades is ordinary work. The ADMIN gate is for the inventory adjustments, which
                    move gold with nobody on the other side of the transaction. */}
                <Route path="/retail-buy" element={page(<RetailBuyListPage />)} />
                <Route path="/retail-buy/new" element={page(<RetailBuyCreatePage />)} />
                <Route path="/retail-buy/:id" element={page(<RetailBuyDetailPage />)} />
                <Route path="/retail-sell" element={page(<RetailSellListPage />)} />
                <Route path="/retail-sell/new" element={page(<RetailSellCreatePage />)} />
                <Route path="/retail-sell/:id" element={page(<RetailSellDetailPage />)} />
                {/* Three readings of one window, offered side by side because BU has not chosen
                    between them. The layout owns the window and the data so the tabs cannot
                    disagree — which is the whole point of showing all three. */}
                {/* Account administration. Behind AdminGuard because every route it calls is
                    ADMIN-only on the API — issuing a login is how someone gets the ability to
                    move gold, so it belongs with the adjustments rather than with the day's work. */}
                <Route element={<AdminGuard />}>
                  <Route path="/users" element={page(<UsersPage />)} />
                </Route>
                <Route path="/trading" element={page(<TradingLayout />)}>
                  <Route index element={page(<TradingSpreadPage />)} />
                  <Route path="periods" element={page(<TradingPeriodPage />)} />
                  <Route path="ledger" element={page(<TradingLedgerPage />)} />
                </Route>
              </Route>
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
