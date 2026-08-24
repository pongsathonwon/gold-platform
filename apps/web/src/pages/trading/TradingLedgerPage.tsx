import { useState } from "react";
import {
  Alert, Box, Chip, MenuItem, Paper, Table, TableBody, TableCell, TableContainer,
  TableFooter, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import {
  domainLabel, summarise, type TradingDomain, type TradingRow,
} from "../../utils/trading";
import { formatBusinessDate, formatNumber, formatWeight } from "../../utils/format";
import { useTradingContext } from "./TradingLayout";

/**
 * Approach C — every transaction from all four domains, newest first.
 *
 * This is the audit reading: what happened, in order, with the four domains interleaved rather than
 * sitting in four separate lists. What it deliberately does **not** do is average anything — the
 * per-domain footers below are the closest it gets, and the reason to prefer approach A is that the
 * figures a manager acts on are derived, not visible in any single row.
 *
 * Sorted by the business day the trade happened, not the insert timestamp, so a backdated write-up
 * reads where it belongs. Ties inside a day fall back to the domain and then the counterparty,
 * because there is no cross-domain ordering below a day — four independent tables have no shared
 * sequence, and inventing one from `recordedAt` would order by when someone typed rather than by
 * what happened.
 */

const DOMAINS: TradingDomain[] = ["RETAIL_BUY", "RETAIL_SELL", "WHOLESALE_BUY", "WHOLESALE_SELL"];

// gold in reads warm, gold out reads green — the same pairing the spread grid uses
const chipColor = (row: TradingRow): "warning" | "success" =>
  row.direction === "in" ? "warning" : "success";

export function TradingLedgerPage() {
  const { rows, windowLabel, productTypeName, isNineNineNine } = useTradingContext();
  const [domain, setDomain] = useState<"" | TradingDomain>("");

  const filtered = domain ? rows.filter((r) => r.domain === domain) : rows;

  const sorted = [...filtered].sort(
    (a, b) =>
      b.transactionDate.localeCompare(a.transactionDate) ||
      a.domain.localeCompare(b.domain) ||
      a.counterparty.localeCompare(b.counterparty),
  );

  return (
    <Box>
      <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <TextField
          select
          label="ประเภทรายการ"
          value={domain}
          onChange={(e) => setDomain(e.target.value as "" | TradingDomain)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">ทั้งหมด</MenuItem>
          {DOMAINS.map((d) => (
            <MenuItem key={d} value={d}>
              {domainLabel(d)}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {sorted.length === 0 && <Alert severity="info">ไม่พบรายการในช่วงเวลานี้</Alert>}

      {sorted.length > 0 && (
        <TableContainer component={Paper} variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>วันที่</TableCell>
                <TableCell>ประเภท</TableCell>
                <TableCell>คู่ค้า</TableCell>
                <TableCell>ทอง</TableCell>
                <TableCell align="right">น้ำหนัก</TableCell>
                <TableCell align="right">ราคา/บาททอง</TableCell>
                <TableCell align="right">ยอดรวม</TableCell>
                <TableCell>สถานะ</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((r) => {
                const kg = isNineNineNine(r.purityId);
                return (
                  <TableRow
                    key={`${r.domain}-${r.id}`}
                    hover
                    // a cancelled row stays visible but reads as withdrawn rather than as data
                    sx={{ opacity: r.countsTowardTotal ? 1 : 0.55 }}
                  >
                    <TableCell>{formatBusinessDate(r.transactionDate)}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" color={chipColor(r)} label={domainLabel(r.domain)} />
                    </TableCell>
                    <TableCell>{r.counterparty}</TableCell>
                    <TableCell>{productTypeName(r.productTypeId)}</TableCell>
                    {/* each row states its own unit, because the two purities are never one column
                        of comparable numbers */}
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {kg ? `${formatWeight(r.weightGm / 1000)} กก.` : `${formatWeight(r.weightGb)} บ.`}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatNumber(r.pricePerGb)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatNumber(r.amount)}
                    </TableCell>
                    <TableCell>{r.statusLabel}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              {/*
                One row per domain **and purity**, never combined on either axis.

                A single total across the four domains would add gold the shop bought to gold it
                sold, and cash it paid to cash it received — a number that means nothing. And a
                single total across the two purities would add 96.5% metal to 99.9% metal and
                average two different grades of gold into one price, which is the mistake every
                other view here is built to avoid.

                Two dimensions of footer is the honest cost of interleaving four domains in one
                table, and it is the clearest argument for the ส่วนต่างราคา view over this one.
              */}
              {DOMAINS.filter((d) => !domain || d === domain).flatMap((d) =>
                ([false, true] as const).map((is999) => {
                  const scoped = rows.filter(
                    (r) => r.domain === d && isNineNineNine(r.purityId) === is999,
                  );
                  if (scoped.length === 0) return null;
                  const s = summarise(scoped);
                  const weight = is999 ? s.weightGm / 1000 : s.weightGb;
                  return (
                    <TableRow key={`${d}-${is999}`}>
                      <TableCell colSpan={4} sx={{ fontWeight: "bold", color: "text.primary" }}>
                        รวม {domainLabel(d)} · {is999 ? "ทอง 99.9%" : "ทอง 96.5%"}
                        <Typography component="span" variant="caption" sx={{ ml: 1, fontWeight: 400 }}>
                          ({windowLabel})
                        </Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: "bold", color: "text.primary", fontVariantNumeric: "tabular-nums" }}>
                        {formatWeight(weight)} {is999 ? "กก." : "บ."}
                      </TableCell>
                      {/* per gold baht at both purities, matching every other average in the app */}
                      <TableCell align="right" sx={{ fontWeight: "bold", color: "text.primary", fontVariantNumeric: "tabular-nums" }}>
                        {s.avgPricePerGb === null ? "—" : formatNumber(s.avgPricePerGb)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: "bold", color: "text.primary", fontVariantNumeric: "tabular-nums" }}>
                        {formatNumber(s.amount)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  );
                }),
              )}
            </TableFooter>
          </Table>
        </TableContainer>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
        ยอดรวมแยกตามประเภทรายการและความบริสุทธิ์ · ราคาเฉลี่ยคิดเป็นบาท/บาททองทุกความบริสุทธิ์ ·
        รายการที่ยกเลิกแสดงไว้แต่ไม่นับในยอดรวม
      </Typography>
    </Box>
  );
}
