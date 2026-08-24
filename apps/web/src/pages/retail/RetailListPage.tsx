import { useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Container, Typography, Table, TableBody, TableCell, TableContainer, TableFooter,
  TableHead, TableRow, Paper, Chip, Box, TextField, MenuItem, Button, Alert, CircularProgress,
} from "@mui/material";
import { shiftBusinessDate, todayBusinessDate } from "@gold-platform/types";
import type { RetailTransaction } from "../../hooks/useRetail";
import { useBranches, useProductTypes, usePurities } from "../../hooks/useMasterData";
import { useToast } from "../../components/ToastContext";
import { useAuth } from "../../auth/AuthContext";
import { splitByPurity } from "../../utils/inventoryVolume";
import { downloadWorkbook } from "../../utils/excel";
import {
  buildTransactionWorkbook, transactionFileName, type TransactionExportRow,
} from "../../utils/transactionExport";
import {
  formatBusinessDate, formatNumber, formatWeight, statusColor,
} from "../../utils/retailStatus";
import { RETAIL_BUY_UI, RETAIL_SELL_UI, type RetailUiConfig } from "./retailUi";

// 96.5% is dealt in gold baht, 99.9% in kilograms — the same split every other list uses. It is
// what lets each table state one unit in its header instead of showing a 2 kg trade as its
// 131.20 gold-baht equivalent.
type Unit = "gb" | "kg";

const weightOf = (t: RetailTransaction, unit: Unit) =>
  unit === "gb" ? t.weightGb : t.weightGm / 1000;

// Opens on the last seven days — six back plus today, inclusive. Deliberately not snapped to the
// Fri–Thu settlement period: that bucket is a management convention for comparing buy against sell,
// not a boundary an operator works inside, and anchoring to it would show almost nothing on a
// Friday morning.
const DEFAULT_WINDOW_DAYS = 7;

function RetailListPage({ config }: { config: RetailUiConfig }) {
  const [currentStatus, setCurrentStatus] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [from, setFrom] = useState(() =>
    shiftBusinessDate(todayBusinessDate(), -(DEFAULT_WINDOW_DAYS - 1)),
  );
  const [to, setTo] = useState(() => todayBusinessDate());
  const [isExporting, setIsExporting] = useState(false);

  const filter = {
    ...(currentStatus ? { currentStatus } : {}),
    ...(branchCode ? { branchCode } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  const { data, isPending, isError, error } = config.useList(filter);
  const { showToast } = useToast();
  const { user } = useAuth();
  const { data: branchesRes } = useBranches();
  const { data: productTypesRes } = useProductTypes();
  const { data: puritiesRes } = usePurities();

  // rebuilt once per master-data change rather than on every render, for lookups done per row
  const purityById = useMemo(
    () => new Map((puritiesRes?.data ?? []).map((p) => [p.id, p])),
    [puritiesRes],
  );
  const branchById = useMemo(
    () => new Map((branchesRes?.data ?? []).map((b) => [b.branchCode, b])),
    [branchesRes],
  );
  const productTypeById = useMemo(
    () => new Map((productTypesRes?.data ?? []).map((p) => [p.id, p])),
    [productTypesRes],
  );

  // Resolves retired branches too — the endpoint returns every branch precisely so a closed shop's
  // historical rows do not degrade to a bare code.
  const branchName = (code: string) => branchById.get(code)?.branchName ?? code;
  const productTypeName = (id: string) => productTypeById.get(id)?.productType ?? id;

  const { nineSixFive, nineNineNine } = splitByPurity(
    data ?? [],
    (t) => purityById.get(t.purityId)?.percent === 99.9,
  );

  const windowLabel = `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`;

  /**
   * A transaction as the report shows it. Every figure is the one the table beside it renders — the
   * same weight, the same gold-only amount, and the same `countsTowardTotal` test the footer
   * applies — so the file cannot total something the screen does not.
   */
  const toExportRow = (t: RetailTransaction): TransactionExportRow => ({
    transactionDate: t.transactionDate,
    counterparty: branchName(t.branchCode),
    productType: productTypeName(t.productTypeId),
    weightGb: t.weightGb,
    weightGm: t.weightGm,
    // Retail records one weight. There is no order to compare against and no second party
    // weighing it, so the comparison column stays empty rather than repeating the same figure.
    comparisonWeightGb: null,
    comparisonWeightGm: null,
    pricePerGb: t.pricePerGb,
    // gold value only, matching the screen — the operating fee is not spread and must not enter
    // the average
    amount: t.totalAmount,
    status: config.statusLabel(t.currentStatus),
    countsTowardTotal: config.countsTowardTotal(t.currentStatus),
  });

  async function handleExport() {
    setIsExporting(true);
    try {
      await downloadWorkbook(
        buildTransactionWorkbook({
          nineSixFive: nineSixFive.map(toExportRow),
          nineNineNine: nineNineNine.map(toExportRow),
          config: config.report,
          from,
          to,
          generatedAt: new Date(),
          generatedBy: user?.name ?? user?.username ?? "",
        }),
        transactionFileName(config.report, from, to),
      );
    } catch {
      showToast("ส่งออกไฟล์ไม่สำเร็จ", "error");
    } finally {
      setIsExporting(false);
    }
  }

  function renderSection(title: string, rows: RetailTransaction[], unit: Unit) {
    const weightHeader = unit === "gb" ? "น้ำหนัก (บาท)" : "น้ำหนัก (กก.)";
    // a cancelled trade did not happen, so it cannot inform what gold cost or fetched
    const counted = rows.filter((t) => config.countsTowardTotal(t.currentStatus));
    const totalWeight = counted.reduce((sum, t) => sum + weightOf(t, unit), 0);
    const totalAmount = counted.reduce((sum, t) => sum + t.totalAmount, 0);
    const totalFee = counted.reduce((sum, t) => sum + (t.operationFee ?? 0), 0);
    const excluded = rows.length - counted.length;

    return (
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" sx={{ mb: 1 }}>
          {title}
        </Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>วันที่</TableCell>
                <TableCell>สาขา</TableCell>
                <TableCell>ประเภททอง</TableCell>
                <TableCell align="right">{weightHeader}</TableCell>
                <TableCell align="right">ราคา/บาททอง</TableCell>
                <TableCell align="right">ยอดรวม</TableCell>
                <TableCell align="right">ค่าดำเนินการ</TableCell>
                <TableCell>สถานะ</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} align="center">
                    ไม่พบรายการ
                  </TableCell>
                </TableRow>
              )}
              {rows.map((t) => (
                <TableRow key={t.id} hover>
                  {/* the day the trade happened, not the day it was typed in — the list is sorted
                      by it too, so a backdated write-up reads where it belongs */}
                  <TableCell>{formatBusinessDate(t.transactionDate)}</TableCell>
                  <TableCell>{branchName(t.branchCode)}</TableCell>
                  <TableCell>{productTypeName(t.productTypeId)}</TableCell>
                  <TableCell align="right">{formatWeight(weightOf(t, unit))}</TableCell>
                  <TableCell align="right">{formatNumber(t.pricePerGb)}</TableCell>
                  <TableCell align="right">{formatNumber(t.totalAmount)}</TableCell>
                  {/* its own column, never folded into the total beside it — an em dash rather
                      than 0.00, because no fee charged is not a fee of nothing */}
                  <TableCell align="right">
                    {t.operationFee === null ? "—" : formatNumber(t.operationFee)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={config.statusLabel(t.currentStatus)}
                      color={statusColor(t.currentStatus)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button component={RouterLink} to={`${config.basePath}/${t.id}`} variant="text" size="small">
                      ดู
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {/* shown whenever the section has rows, even if every one is excluded — a section with
                trades but no footer reads as a bug, where an explicit 0 plus the exclusion caption
                reads as the answer */}
            {rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} sx={{ fontWeight: "bold", color: "text.primary" }}>
                    รวม
                    {/* the window is part of what the number means — a total over a span the
                        reader has to scroll up to find is not self-describing */}
                    <Typography component="span" variant="caption" sx={{ ml: 1, fontWeight: 400 }}>
                      ({windowLabel})
                    </Typography>
                    {excluded > 0 && (
                      <Typography component="span" variant="caption" sx={{ ml: 1, fontWeight: 400 }}>
                        (ไม่รวม {excluded} รายการที่ยกเลิก)
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: "bold", color: "text.primary" }}>
                    {formatWeight(totalWeight)}
                  </TableCell>
                  <TableCell />
                  <TableCell align="right" sx={{ fontWeight: "bold", color: "text.primary" }}>
                    {formatNumber(totalAmount)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: "bold", color: "text.primary" }}>
                    {totalFee === 0 ? "—" : formatNumber(totalFee)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </TableContainer>
      </Box>
    );
  }

  return (
    <Container sx={{ py: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 3, gap: 2 }}>
        <Typography variant="h2" sx={{ flexGrow: 1 }}>
          {config.listTitle}
        </Typography>
        {/* waits for the window's data — a report written from a half-loaded list would carry a
            summary that averages only part of it */}
        <Button
          variant="outlined"
          onClick={handleExport}
          disabled={isPending || isError || isExporting}
          startIcon={isExporting ? <CircularProgress size={16} /> : undefined}
        >
          ส่งออก Excel
        </Button>
        <Button component={RouterLink} to={`${config.basePath}/new`}>
          บันทึกรายการ
        </Button>
      </Box>

      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        {/* a day window over วันที่ทำรายการ, both ends inclusive. Clearing a field drops that end
            of the window rather than falling back to the default — someone chasing an old trade
            should be able to open the range up. */}
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
        <TextField
          select
          label="สถานะ"
          value={currentStatus}
          onChange={(e) => setCurrentStatus(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">ทั้งหมด</MenuItem>
          {config.statuses.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        {/* every branch, retired ones included: filtering the list by a closed shop is exactly
            when someone is looking back at its history */}
        <TextField
          select
          label="สาขา"
          value={branchCode}
          onChange={(e) => setBranchCode(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">ทั้งหมด</MenuItem>
          {(branchesRes?.data ?? []).map((b) => (
            <MenuItem key={b.branchCode} value={b.branchCode}>
              {b.branchName}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {isPending && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}
      {isError && <Alert severity="error">{error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"}</Alert>}

      {data && (
        <>
          {renderSection("ทอง 96.5%", nineSixFive, "gb")}
          {renderSection("ทอง 99.9%", nineNineNine, "kg")}
        </>
      )}
    </Container>
  );
}

// Distinct component types per route — see the note in retailUi.ts on why this matters.
export const RetailBuyListPage = () => <RetailListPage config={RETAIL_BUY_UI} />;
export const RetailSellListPage = () => <RetailListPage config={RETAIL_SELL_UI} />;
