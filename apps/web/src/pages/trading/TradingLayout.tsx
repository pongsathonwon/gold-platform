import { useState } from "react";
import { Box, Container, Tab, Tabs, TextField, Typography, Alert, CircularProgress } from "@mui/material";
import { Link as RouterLink, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { shiftBusinessDate, todayBusinessDate } from "@gold-platform/types";
import { useTrading } from "../../hooks/useTrading";
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
 */

const tabs = [
  { label: "ส่วนต่างราคา", to: "/trading" },
  { label: "สรุปรายงวด", to: "/trading/periods" },
  { label: "รายการทั้งหมด", to: "/trading/ledger" },
];

// Opens on the last seven days, matching every list page in the app. Deliberately not snapped to
// the Fri–Thu งวด: that bucket is a management convention, and anchoring to it would show almost
// nothing on a Friday morning. The สรุปรายงวด tab buckets whatever the window contains, so widening
// the range is how you see more weeks.
const DEFAULT_WINDOW_DAYS = 7;

export interface TradingContext {
  rows: TradingRow[];
  from: string;
  to: string;
  windowLabel: string;
  productTypeName: (id: string) => string;
  isNineNineNine: (purityId: string) => boolean;
}

export const useTradingContext = () => useOutletContext<TradingContext>();

export function TradingLayout() {
  const { pathname } = useLocation();
  const [from, setFrom] = useState(() =>
    shiftBusinessDate(todayBusinessDate(), -(DEFAULT_WINDOW_DAYS - 1)),
  );
  const [to, setTo] = useState(() => todayBusinessDate());

  const { rows, productTypeName, isNineNineNine, isPending, isError, error } = useTrading({ from, to });

  const currentTab = tabs.find((tab) => tab.to === pathname)?.to ?? tabs[0]!.to;
  const windowLabel = `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`;

  const context: TradingContext = { rows, from, to, windowLabel, productTypeName, isNineNineNine };

  return (
    <Container sx={{ py: 4 }}>
      <Typography variant="h2" sx={{ mb: 1 }}>
        ภาพรวมการค้า
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        ซื้อ–ขาย ทั้งปลีกและส่ง ในช่วงเวลาเดียวกัน
      </Typography>

      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        {/* One window for all three views. Clearing an end opens the range up, as on the lists. */}
        <TextField
          type="date"
          label="ตั้งแต่วันที่"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ minWidth: 170 }}
        />
        <TextField
          type="date"
          label="ถึงวันที่"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ minWidth: 170 }}
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
