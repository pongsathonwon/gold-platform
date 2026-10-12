import { useState } from "react";
import { Box, Container, Tab, Tabs, Typography, Alert, CircularProgress } from "@mui/material";
import { Link as RouterLink, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { startOfBusinessMonth, todayBusinessDate } from "@gold-platform/types";
import { BusinessDatePicker } from "../../components/BusinessDatePicker";
import { useTransactionRows } from "../../hooks/useTransactionRows";
import type { TradingRow } from "../../utils/trading";
import { formatBusinessDate } from "../../utils/format";

/**
 * The three views are **three renderings of one window**, not three pages.
 *
 * BU has not decided which reading of the four domains they want, so all three are built and offered
 * side by side. That only tells them anything if the views cannot disagree — so the window and the
 * data live here, in the layout, and each child receives the same normalised rows. Switching tabs
 * changes the presentation and nothing else, which is exactly the comparison being asked for.
 *
 * It also means the window survives a tab change. Someone who has framed an interesting week should
 * not lose it by looking at that week a second way.
 *
 * Named กำไรขาดทุน / P&L, not "trading" (it was ภาพรวมการค้า at `/trading`, which still redirects
 * here). Every figure on these tabs is a result over a window — what a baht was bought and sold at,
 * what cash came in net — and "trading" read as a live position, which is the gold balance's job.
 */

const tabs = [
  { label: "ส่วนต่างราคา", to: "/profit-loss" },
  { label: "สรุปรายงวด", to: "/profit-loss/periods" },
  { label: "รายการทั้งหมด", to: "/profit-loss/ledger" },
];

// Opens month-to-date: the 1st of the current month through today.
//
// This is the one window in the app that is not the last seven days, and the reader is why. The
// list pages are worklists — an operator is looking for a deal they handled this week. These three
// views answer "how is the business doing", which is a question asked against the month someone
// is being measured on, and a rolling week answers it about a period nobody reports on.
//
// Still deliberately not snapped to the Fri–Thu งวด: that bucket is a management convention, and
// anchoring to it would show almost nothing on a Friday morning. The สรุปรายงวด tab buckets
// whatever the window contains, so widening the range is how you see more weeks.
//
// A window that starts on the 1st is short on the 1st — that is the honest state of the month, and
// both ends stay editable for anyone who wants a longer run.

export interface ProfitLossContext {
  rows: TradingRow[];
  from: string;
  to: string;
  windowLabel: string;
  productTypeName: (id: string) => string;
  isNineNineNine: (purityId: string) => boolean;
}

export const useProfitLossContext = () => useOutletContext<ProfitLossContext>();

export function ProfitLossLayout() {
  const { pathname } = useLocation();
  const [from, setFrom] = useState(() => startOfBusinessMonth(todayBusinessDate()));
  const [to, setTo] = useState(() => todayBusinessDate());

  const { rows, productTypeName, isNineNineNine, isPending, isError, error } = useTransactionRows({ from, to });

  const currentTab = tabs.find((tab) => tab.to === pathname)?.to ?? tabs[0]!.to;
  const windowLabel = `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`;

  const context: ProfitLossContext = { rows, from, to, windowLabel, productTypeName, isNineNineNine };

  return (
    <Container sx={{ py: 4 }}>
      <Typography variant="h2" sx={{ mb: 1 }}>
        กำไรขาดทุน (P&amp;L)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        ซื้อ–ขาย ทั้งปลีกและส่ง ในช่วงเวลาเดียวกัน
      </Typography>

      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        {/* One window for all three views. Clearing an end opens the range up, as on the lists. */}
        <BusinessDatePicker
          label="ตั้งแต่วันที่"
          value={from}
          onChange={setFrom}
          sx={{ minWidth: 190 }}
        />
        <BusinessDatePicker
          label="ถึงวันที่"
          value={to}
          onChange={setTo}
          sx={{ minWidth: 190 }}
        />
      </Box>

      <Tabs value={currentTab} sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
        {tabs.map((tab) => (
          <Tab key={tab.to} label={tab.label} value={tab.to} component={RouterLink} to={tab.to} />
        ))}
      </Tabs>

      {/* Held here rather than in each child: all four domains have to have answered before any
          view is truthful, and a half-loaded window would report a spread against a side whose
          rows had not arrived. */}
      {isPending && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {isError && (
        <Alert severity="error">{error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"}</Alert>
      )}
      {!isPending && !isError && <Outlet context={context} />}
    </Container>
  );
}
