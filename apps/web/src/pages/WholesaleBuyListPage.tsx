import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Container, Typography, Table, TableBody, TableCell, TableContainer, TableFooter,
  TableHead, TableRow, Paper, Chip, Box, TextField, MenuItem, Button, Alert, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from "@mui/material";
import { WHOLE_BUY_STATUSES, shiftBusinessDate, todayBusinessDate } from "@gold-platform/types";
import { useWholesaleBuyList, type WholeBuyTransaction } from "../hooks/useWholesaleBuy";
import { useConfirmAllWholesaleBuy } from "../hooks/useWholesaleBuyMutations";
import { useProductTypes, usePurities, useSuppliers } from "../hooks/useMasterData";
import { useToast } from "../components/ToastContext";
import { useAuth } from "../auth/AuthContext";
import { splitByPurity } from "../utils/inventoryVolume";
import { downloadWorkbook } from "../utils/excel";
import {
  buildTransactionWorkbook, transactionFileName, BUY_REPORT, type TransactionExportRow,
} from "../utils/transactionExport";
import { countsTowardTotal, formatBusinessDate, formatNumber, formatWeight, statusColor, statusLabel } from "../utils/wholeBuyStatus";

// 96.5% is ordered in gold baht, 99.9% in kilograms — the same split the inventory pages use.
// Sectioning by purity is what lets each table state one unit in its header instead of showing
// a 2 kg order as its 131.20 gold-baht equivalent.
type Unit = "gb" | "kg";

const orderedWeight = (t: WholeBuyTransaction, unit: Unit) =>
  unit === "gb" ? t.weightGb : t.weightGm / 1000;

// what physically arrived, once checked; the ordered figure until then
const deliveredWeight = (t: WholeBuyTransaction, unit: Unit) =>
  unit === "gb" ? t.actualWeightGb ?? t.weightGb : (t.actualWeightGm ?? t.weightGm) / 1000;

const amountOf = (t: WholeBuyTransaction) => t.actualAmount ?? t.totalAmount;

// The list opens on the last seven days — six back plus today, inclusive. A week's worth of
// trading is what the manager pictures and what the operator is still working through, so it
// serves both without either having to touch the filter.
//
// It deliberately does *not* snap to the Fri–Thu settlement period. That period is a management
// convention for comparing buy against sell, not a boundary an operator works inside: anchoring
// the window to it would show almost nothing on a Friday morning.
const DEFAULT_WINDOW_DAYS = 7;

export function WholesaleBuyListPage() {
  const [currentStatus, setCurrentStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [from, setFrom] = useState(() =>
    shiftBusinessDate(todayBusinessDate(), -(DEFAULT_WINDOW_DAYS - 1)),
  );
  const [to, setTo] = useState(() => todayBusinessDate());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const filter = {
    ...(currentStatus ? { currentStatus } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const [isExporting, setIsExporting] = useState(false);

  const { data, isPending, isError, error } = useWholesaleBuyList(filter);
  const confirmAll = useConfirmAllWholesaleBuy();
  const { showToast } = useToast();
  const { isAdmin, user } = useAuth();
  const { data: suppliersRes } = useSuppliers();
  const { data: productTypesRes } = useProductTypes();
  const { data: puritiesRes } = usePurities();

  const purityById = new Map((puritiesRes?.data ?? []).map((p) => [p.id, p]));
  const supplierName = (id: string) => suppliersRes?.data.find((s) => s.id === id)?.supplierName ?? id;
  const productTypeName = (id: string) =>
    productTypesRes?.data.find((p) => p.id === id)?.productType ?? id;

  const { nineSixFive, nineNineNine } = splitByPurity(
    data ?? [],
    (t) => purityById.get(t.purityId)?.percent === 99.9,
  );

  // counts only what is on screen; with a status filter applied the button follows the filter,
  // but the endpoint always sweeps every CREATED transaction — so the count is a floor, not a cap
  const createdCount = (data ?? []).filter((t) => t.currentStatus === "CREATED").length;

  const windowLabel = `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`;

  /**
   * The sweep is not scoped to what is on screen — it confirms *every* transaction still in
   * CREATED, including ones outside the current filter — and confirmation is the lock that ends
   * the edit window. An irreversible action with a wider reach than the page implies has to be
   * confirmed, and the dialog is where the real scope gets stated.
   */
  /**
   * A transaction as the report shows it. Every figure is the one the table beside it renders —
   * the delivered weight against the ordered one, `amountOf`'s choice of amount, and the same
   * `countsTowardTotal` test the footer applies — so the file cannot total something the screen
   * does not.
   */
  const toExportRow = (t: WholeBuyTransaction, unit: Unit): TransactionExportRow => ({
    transactionDate: t.transactionDate,
    counterparty: supplierName(t.supplierId),
    productType: productTypeName(t.productTypeId),
    weightGb: t.actualWeightGb ?? t.weightGb,
    weightGm: t.actualWeightGm ?? t.weightGm,
    // always known on a buy: what the order said, whether or not the delivery matched it
    comparisonWeightGb: t.weightGb,
    comparisonWeightGm: t.weightGm,
    pricePerGb: unit === "kg" ? t.pricePerGb999 : t.pricePerGb965,
    amount: amountOf(t),
    status: statusLabel(t.currentStatus),
    countsTowardTotal: countsTowardTotal(t.currentStatus),
  });

  async function handleExport() {
    setIsExporting(true);
    try {
      await downloadWorkbook(
        buildTransactionWorkbook({
          nineSixFive: nineSixFive.map((t) => toExportRow(t, "gb")),
          nineNineNine: nineNineNine.map((t) => toExportRow(t, "kg")),
          config: BUY_REPORT,
          from,
          to,
          generatedAt: new Date(),
          generatedBy: user?.name ?? user?.username ?? "",
        }),
        transactionFileName(BUY_REPORT, from, to),
      );
    } catch {
      showToast("ส่งออกไฟล์ไม่สำเร็จ", "error");
    } finally {
      setIsExporting(false);
    }
  }

  function handleConfirmAll() {
    setConfirmOpen(false);
    confirmAll.mutate(undefined, {
      onSuccess: (res) => showToast(`ยืนยันแล้ว ${res.data.confirmed} รายการ`),
      onError: (err) => showToast(err instanceof Error ? err.message : "ยืนยันไม่สำเร็จ", "error"),
    });
  }

  function renderSection(title: string, rows: WholeBuyTransaction[], unit: Unit) {
    const weightHeader = unit === "gb" ? "น้ำหนัก (บาท)" : "น้ำหนัก (กก.)";
    // cancelled / rejected / returned orders delivered nothing — they must not inflate the totals
    const counted = rows.filter((t) => countsTowardTotal(t.currentStatus));
    const totalWeight = counted.reduce((sum, t) => sum + deliveredWeight(t, unit), 0);
    const totalAmount = counted.reduce((sum, t) => sum + amountOf(t), 0);
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
                <TableCell>ผู้ขายส่ง</TableCell>
                <TableCell>ประเภททอง</TableCell>
                <TableCell align="right">{weightHeader}</TableCell>
                <TableCell align="right">ราคา/บาททอง</TableCell>
                <TableCell align="right">ยอดรวม</TableCell>
                <TableCell>สถานะ</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    ไม่พบรายการ
                  </TableCell>
                </TableRow>
              )}
              {rows.map((t) => {
                const delivered = deliveredWeight(t, unit);
                const ordered = orderedWeight(t, unit);
                const short = t.actualWeightGb !== null && delivered !== ordered;

                return (
                  <TableRow key={t.id} hover>
                    {/* the day the order was placed, not the day it was typed in — the list is
                        sorted by it too, so a backdated entry reads where it belongs */}
                    <TableCell>{formatBusinessDate(t.transactionDate)}</TableCell>
                    <TableCell>{supplierName(t.supplierId)}</TableCell>
                    <TableCell>{productTypeName(t.productTypeId)}</TableCell>
                    <TableCell align="right">
                      {formatWeight(delivered)}
                      {short && (
                        <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.5 }}>
                          (สั่ง {formatWeight(ordered)})
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {formatNumber(unit === "kg" ? t.pricePerGb999 : t.pricePerGb965)}
                    </TableCell>
                    <TableCell align="right">{formatNumber(amountOf(t))}</TableCell>
                    <TableCell>
                      <Chip size="small" label={statusLabel(t.currentStatus)} color={statusColor(t.currentStatus)} />
                    </TableCell>
                    <TableCell>
                      <Button component={RouterLink} to={`/wholesale-buy/${t.id}`} variant="text" size="small">
                        ดู
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {/* shown whenever the section has rows, even if every one is excluded — a section
                with orders but no footer reads as a bug, where an explicit 0 plus the exclusion
                caption reads as the answer */}
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
                        (ไม่รวม {excluded} รายการที่ยกเลิก/ปฏิเสธ/ตีกลับ)
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
          ซื้อส่ง
        </Typography>
        {/* the nightly job does this automatically; the button is the mid-day run for when the
            day's orders need locking before then */}
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
        {isAdmin && (
        <Button variant="outlined" onClick={() => setConfirmOpen(true)} disabled={confirmAll.isPending || createdCount === 0}>
          {confirmAll.isPending ? "กำลังยืนยัน…" : `ยืนยันทั้งหมด (${createdCount})`}
        </Button>
        )}
        <Button component={RouterLink} to="/wholesale-buy/new">
          สร้างรายการ
        </Button>
      </Box>

      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        {/* a day window over วันที่ทำรายการ, both ends inclusive. Clearing a field drops that end
            of the window rather than falling back to the default — an operator chasing an old
            order should be able to open the range up. */}
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
          {WHOLE_BUY_STATUSES.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="ผู้ขายส่ง"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">ทั้งหมด</MenuItem>
          {(suppliersRes?.data ?? []).map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.supplierName}
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

      {/* The count on the button is what is visible under the current filter; the sweep is not
          filtered. Saying so here is the whole reason the dialog exists — an operator who has
          filtered to one supplier should not discover that afterwards. */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>ยืนยันรายการทั้งหมด?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ระบบจะยืนยัน<strong>ทุกรายการซื้อส่ง ที่ยังอยู่ในสถานะ "สร้างรายการ"</strong> — รวมถึงรายการที่ไม่ได้แสดงอยู่ในตัวกรองปัจจุบัน
          </DialogContentText>
          <DialogContentText sx={{ mt: 2 }}>
            เมื่อยืนยันแล้วจะ<strong>แก้ไขรายการไม่ได้อีก</strong> และไม่สามารถย้อนกลับได้
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setConfirmOpen(false)}>ยกเลิก</Button>
          <Button onClick={handleConfirmAll} disabled={confirmAll.isPending}>ยืนยันทั้งหมด</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
