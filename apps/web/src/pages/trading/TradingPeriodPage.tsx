import {
  Alert, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from "@mui/material";
import { byPeriod, netPosition, splitPurity, type TradingRow } from "../../utils/trading";
import { formatNumber, formatWeight } from "../../utils/format";
import { useTradingContext } from "./TradingLayout";

/**
 * Approach B — one row per Fri–Thu งวด, the model root `CONTEXT.md` describes.
 *
 * Three independent signed figures per period: net gold at each purity, and net cash. They are
 * genuinely independent, not three views of one number — a week of heavy customer buying is negative
 * cash and positive gold, and both are correct at once.
 *
 * **Rows never sum.** There is no carryover: a supplier order in one period that covers a customer
 * buy from the previous one counts in the period it happened, and the earlier period is unchanged.
 * So there is no total row here, deliberately.
 *
 * The periods come from the rows rather than a generated calendar, so a week nothing fell into
 * simply does not appear. Widening the window is how you see more of them — which is also why the
 * page says so when the window only spans one.
 */

function signed(value: number, digits: "weight" | "money") {
  const rendered = digits === "weight" ? formatWeight(value) : formatNumber(value);
  return value > 0 ? `+${rendered}` : rendered;
}

function toneOf(value: number) {
  if (value > 0) return "success.main";
  if (value < 0) return "error.main";
  return undefined;
}

function NetCell({ value, kind, suffix }: { value: number; kind: "weight" | "money"; suffix?: string }) {
  // exactly zero is neither a gain nor a loss, so it gets no colour — the sign is the message
  return (
    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", color: toneOf(value) }}>
      {value === 0 ? "—" : `${signed(value, kind)}${suffix ? ` ${suffix}` : ""}`}
    </TableCell>
  );
}

export function TradingPeriodPage() {
  const { rows, isNineNineNine } = useTradingContext();
  const periods = byPeriod(rows);

  const periodRow = (periodRows: TradingRow[]) => {
    const { nineSixFive, nineNineNine } = splitPurity(periodRows, isNineNineNine);
    return {
      // Per purity, because the two pools are different grades of gold and never mix. There is
      // deliberately no combined ทองเข้า/ทองออก pair: summing gold baht across purities adds
      // 96.5% metal to 99.9% metal and produces a weight nobody holds. Gross flow, if it is ever
      // wanted here, has to arrive as two more pairs of columns rather than one.
      net965: netPosition(nineSixFive).netWeightGb,
      net999: netPosition(nineNineNine).netWeightGm / 1000,
      // Cash is the one figure that *is* combined, and legitimately: money is money whatever grade
      // of gold it bought. This is the model root CONTEXT.md describes — gold splits, cash does not.
      netCash: netPosition(periodRows).netCash,
    };
  };

  return (
    <Box>
      {periods.length === 0 && <Alert severity="info">ไม่พบรายการในช่วงเวลานี้</Alert>}

      {periods.length === 1 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          ช่วงเวลาที่เลือกอยู่ในงวดเดียว — ขยายช่วงวันที่ด้านบนเพื่อเปรียบเทียบหลายงวด
        </Alert>
      )}

      {periods.length > 0 && (
        <TableContainer component={Paper} variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>งวด</TableCell>
                <TableCell align="right">สุทธิ 96.5% (บาททอง)</TableCell>
                <TableCell align="right">สุทธิ 99.9% (กก.)</TableCell>
                <TableCell align="right">เงินสดสุทธิ (บาท)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {periods.map(({ period, rows: periodRows }) => {
                const figures = periodRow(periodRows);
                return (
                  <TableRow key={period} hover>
                    <TableCell>{period}</TableCell>
                    <NetCell value={figures.net965} kind="weight" />
                    <NetCell value={figures.net999} kind="weight" />
                    <NetCell value={figures.netCash} kind="money" />
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
        แต่ละงวดคือวันศุกร์–พฤหัสบดี · ไม่มียอดยกไปงวดถัดไป จึงไม่มีแถวรวม ·
        ทองแยกตามความบริสุทธิ์เสมอ ส่วนเงินสดเป็นยอดเดียวรวมค่าดำเนินการแล้ว
      </Typography>
    </Box>
  );
}
