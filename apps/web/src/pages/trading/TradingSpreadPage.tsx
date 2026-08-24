import { Box, Card, CardContent, Paper, Typography } from "@mui/material";
import {
  byDomain, netPosition, spread, splitPurity, summarise,
  type TradingDomain, type TradingRow, type TradingSummary,
} from "../../utils/trading";
import { formatNumber, formatWeight } from "../../utils/format";
import { useTradingContext } from "./TradingLayout";

/**
 * Approach A — the 2×2.
 *
 * The four domains are not four peers, they are customer/supplier × buy/sell, and **the money is on
 * the diagonals**: gold bought from a customer and sold to a supplier is one profit engine, gold
 * bought from a supplier and sold to a customer is the other. A layout that lists four totals in a
 * row hides both of them, which is why this is a grid rather than a strip of cards.
 *
 * Everything here is per purity, in its own section. 96.5% and 99.9% are separate pools in different
 * grades of gold; a spread spanning them would subtract two different things.
 */

const CELLS: { domain: TradingDomain; row: 0 | 1; col: 0 | 1 }[] = [
  { domain: "RETAIL_BUY", row: 0, col: 0 },
  { domain: "RETAIL_SELL", row: 0, col: 1 },
  { domain: "WHOLESALE_BUY", row: 1, col: 0 },
  { domain: "WHOLESALE_SELL", row: 1, col: 1 },
];

const CELL_LABEL: Record<TradingDomain, string> = {
  RETAIL_BUY: "ซื้อปลีก",
  RETAIL_SELL: "ขายปลีก",
  WHOLESALE_BUY: "ซื้อส่ง",
  WHOLESALE_SELL: "ขายส่ง",
};

/** An em dash, not 0.00 — "no trades" and "traded at nothing" are different claims. */
const price = (value: number | null) => (value === null ? "—" : formatNumber(value));

function Cell({ label, summary, unit, direction }: {
  label: string;
  summary: TradingSummary;
  unit: "gb" | "kg";
  direction: "in" | "out";
}) {
  const weight = unit === "gb" ? summary.weightGb : summary.weightGm / 1000;
  const unitLabel = unit === "gb" ? "บาททอง" : "กก.";

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: "100%",
        // gold in and gold out read as two colours, so direction is legible before the labels are
        borderLeft: 3,
        borderLeftColor: direction === "in" ? "warning.main" : "success.main",
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h4" sx={{ fontVariantNumeric: "tabular-nums", mt: 0.5 }}>
        {price(summary.avgPricePerGb)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        บาท/บาททอง
      </Typography>
      <Typography variant="body2" sx={{ mt: 1, fontVariantNumeric: "tabular-nums" }}>
        {formatWeight(weight)} {unitLabel} · {summary.count} รายการ
      </Typography>
      {summary.feeAmount > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          ค่าดำเนินการ {formatNumber(summary.feeAmount)} (ไม่รวมในราคาเฉลี่ย)
        </Typography>
      )}
      {summary.excluded > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          ไม่รวม {summary.excluded} รายการ
        </Typography>
      )}
    </Paper>
  );
}

function Figure({ label, value, note, tone }: {
  label: string;
  value: string;
  note: string;
  tone?: "positive" | "negative";
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: "1 1 220px", borderStyle: "dashed" }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="h4"
        sx={{
          fontVariantNumeric: "tabular-nums",
          mt: 0.5,
          color: tone === "positive" ? "success.main" : tone === "negative" ? "error.main" : undefined,
        }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {note}
      </Typography>
    </Paper>
  );
}

function Section({ title, rows, unit, windowLabel }: {
  title: string;
  rows: TradingRow[];
  unit: "gb" | "kg";
  windowLabel: string;
}) {
  const summaries = Object.fromEntries(
    CELLS.map((c) => [c.domain, summarise(byDomain(rows, c.domain))]),
  ) as Record<TradingDomain, TradingSummary>;

  // The two profit engines. Each is null unless both of its sides traded — a spread against a side
  // that did nothing is not a small spread, it is no answer.
  const retailToWholesale = spread(summaries.RETAIL_BUY, summaries.WHOLESALE_SELL);
  const wholesaleToRetail = spread(summaries.WHOLESALE_BUY, summaries.RETAIL_SELL);
  const net = netPosition(rows);
  const netWeight = unit === "gb" ? net.netWeightGb : net.netWeightGm / 1000;
  const grossIn = unit === "gb" ? net.inWeightGb : net.inWeightGm / 1000;
  const grossOut = unit === "gb" ? net.outWeightGb : net.outWeightGm / 1000;
  const unitLabel = unit === "gb" ? "บาททอง" : "กก.";
  const signed = (n: number) => `${n > 0 ? "+" : ""}${formatWeight(n)}`;

  return (
    <Box sx={{ mb: 5 }}>
      <Typography variant="h3" sx={{ mb: 2 }}>
        {title}
      </Typography>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "88px 1fr 1fr" },
          gap: 1.5,
          alignItems: "stretch",
        }}
      >
        <Box sx={{ display: { xs: "none", sm: "block" } }} />
        <Typography variant="caption" color="text.secondary" align="center" sx={{ display: { xs: "none", sm: "block" } }}>
          ซื้อ — ทองเข้า / เงินออก
        </Typography>
        <Typography variant="caption" color="text.secondary" align="center" sx={{ display: { xs: "none", sm: "block" } }}>
          ขาย — ทองออก / เงินเข้า
        </Typography>

        {([0, 1] as const).map((rowIndex) => (
          <Box key={rowIndex} sx={{ display: "contents" }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: { xs: "none", sm: "flex" }, alignItems: "center", fontWeight: 600 }}
            >
              {rowIndex === 0 ? "ลูกค้า" : "ผู้ค้าส่ง"}
            </Typography>
            {CELLS.filter((c) => c.row === rowIndex).map((c) => (
              <Cell
                key={c.domain}
                label={CELL_LABEL[c.domain]}
                summary={summaries[c.domain]}
                unit={unit}
                direction={c.col === 0 ? "in" : "out"}
              />
            ))}
          </Box>
        ))}
      </Box>

      <Box sx={{ display: "flex", gap: 1.5, mt: 2, flexWrap: "wrap" }}>
        <Figure
          label="ซื้อปลีก → ขายส่ง"
          value={retailToWholesale === null ? "—" : `${retailToWholesale > 0 ? "+" : ""}${formatNumber(retailToWholesale)}`}
          note="บาท/บาททอง · รับซื้อจากลูกค้า ส่งต่อผู้ค้าส่ง"
          tone={retailToWholesale === null ? undefined : retailToWholesale >= 0 ? "positive" : "negative"}
        />
        <Figure
          label="ซื้อส่ง → ขายปลีก"
          value={wholesaleToRetail === null ? "—" : `${wholesaleToRetail > 0 ? "+" : ""}${formatNumber(wholesaleToRetail)}`}
          note="บาท/บาททอง · รับจากผู้ค้าส่ง ขายลูกค้า"
          tone={wholesaleToRetail === null ? undefined : wholesaleToRetail >= 0 ? "positive" : "negative"}
        />
        <Figure
          label="ทองคงเหลือสุทธิ"
          value={`${signed(netWeight)} ${unitLabel}`}
          note={`ซื้อ ${formatWeight(grossIn)} − ขาย ${formatWeight(grossOut)} (${windowLabel})`}
          tone={netWeight >= 0 ? "positive" : "negative"}
        />
      </Box>
    </Box>
  );
}

export function TradingSpreadPage() {
  const { rows, windowLabel, isNineNineNine } = useTradingContext();
  const { nineSixFive, nineNineNine } = splitPurity(rows, isNineNineNine);

  return (
    <Card variant="outlined">
      <CardContent>
        <Section title="ทอง 96.5%" rows={nineSixFive} unit="gb" windowLabel={windowLabel} />
        {/* written even when empty, like every other purity-split view here: a missing section
            reads as a broken page rather than as a purity nobody traded this week */}
        <Section title="ทอง 99.9%" rows={nineNineNine} unit="kg" windowLabel={windowLabel} />
      </CardContent>
    </Card>
  );
}
