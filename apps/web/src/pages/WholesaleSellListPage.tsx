import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Container, Typography, Table, TableBody, TableCell, TableContainer, TableFooter,
  TableHead, TableRow, Paper, Chip, Box, TextField, MenuItem, Button, Alert, CircularProgress,
} from "@mui/material";
import { WHOLE_SELL_STATUSES } from "@gold-platform/types";
import { useWholesaleSellList, type WholeSellTransaction } from "../hooks/useWholesaleSell";
import { useConfirmAllWholesaleSell } from "../hooks/useWholesaleSellMutations";
import { useProductTypes, usePurities, useSuppliers } from "../hooks/useMasterData";
import { useToast } from "../components/ToastContext";
import { splitByPurity } from "../utils/inventoryVolume";
import { countsTowardTotal, formatBusinessDate, formatNumber, formatWeight, statusColor, statusLabel } from "../utils/wholeSellStatus";

// 96.5% is dealt in gold baht, 99.9% in kilograms — the same split the inventory pages use.
// Sectioning by purity is what lets each table state one unit in its header instead of showing
// a 2 kg deal as its 131.20 gold-baht equivalent.
type Unit = "gb" | "kg";

// What we packed and shipped, which is always the agreed weight — the API refuses to pack
// anything else, so this is the figure that moved stock.
const agreedWeight = (t: WholeSellTransaction, unit: Unit) =>
  unit === "gb" ? t.weightGb : t.weightGm / 1000;

// What the buyer says they weighed, set only on a DISPUTED move. Null means nobody is arguing.
const contestedWeight = (t: WholeSellTransaction, unit: Unit) =>
  t.actualWeightGb === null
    ? null
    : unit === "gb" ? t.actualWeightGb : (t.actualWeightGm ?? 0) / 1000;

const amountOf = (t: WholeSellTransaction) => t.totalAmount;

export function WholesaleSellListPage() {
  const [currentStatus, setCurrentStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");

  const filter = {
    ...(currentStatus ? { currentStatus } : {}),
    ...(supplierId ? { supplierId } : {}),
  };
  const { data, isPending, isError, error } = useWholesaleSellList(filter);
  const confirmAll = useConfirmAllWholesaleSell();
  const { showToast } = useToast();
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

  function handleConfirmAll() {
    confirmAll.mutate(undefined, {
      onSuccess: (res) => showToast(`ยืนยันแล้ว ${res.data.confirmed} รายการ`),
      onError: (err) => showToast(err instanceof Error ? err.message : "ยืนยันไม่สำเร็จ", "error"),
    });
  }

  function renderSection(title: string, rows: WholeSellTransaction[], unit: Unit) {
    const weightHeader = unit === "gb" ? "น้ำหนัก (บาท)" : "น้ำหนัก (กก.)";
    // cancelled / rejected deals moved no gold, and a returned one moved it out and straight
    // back in — none may inflate the totals. A written-off deal did lose the gold for good, so
    // it stays counted; see countsTowardTotal().
    const counted = rows.filter((t) => countsTowardTotal(t.currentStatus));
    const totalWeight = counted.reduce((sum, t) => sum + agreedWeight(t, unit), 0);
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
                <TableCell>ผู้รับซื้อส่ง</TableCell>
                <TableCell>ประเภททอง</TableCell>
                <TableCell align="right">{weightHeader}</TableCell>
                <TableCell align="right">ราคา/บาททอง</TableCell>
                <TableCell align="right">ยอดรวม</TableCell>
                <TableCell>งวด</TableCell>
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
              {rows.map((t) => {
                const agreed = agreedWeight(t, unit);
                const contested = contestedWeight(t, unit);
                const mismatch = contested !== null && contested !== agreed;

                return (
                  <TableRow key={t.id} hover>
                    {/* the day the deal was struck, which is also what the list sorts on */}
                    <TableCell>{formatBusinessDate(t.transactionDate)}</TableCell>
                    <TableCell>{supplierName(t.supplierId)}</TableCell>
                    <TableCell>{productTypeName(t.productTypeId)}</TableCell>
                    {/* the shipped weight is the agreed one; the buyer's contested figure shows
                        beside it so a disagreement is visible without opening the row */}
                    <TableCell align="right">
                      {formatWeight(agreed)}
                      {mismatch && (
                        <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.5 }}>
                          (ผู้ซื้อชั่งได้ {formatWeight(contested)})
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {formatNumber(unit === "kg" ? t.pricePerGb999 : t.pricePerGb965)}
                    </TableCell>
                    <TableCell align="right">{formatNumber(amountOf(t))}</TableCell>
                    <TableCell>{t.settlementPeriod}</TableCell>
                    <TableCell>
                      <Chip size="small" label={statusLabel(t.currentStatus)} color={statusColor(t.currentStatus)} />
                    </TableCell>
                    <TableCell>
                      <Button component={RouterLink} to={`/wholesale-sell/${t.id}`} variant="text" size="small">
                        ดู
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {/* shown whenever the section has rows, even if every one is excluded — a section
                with deals but no footer reads as a bug, where an explicit 0 plus the exclusion
                caption reads as the answer */}
            {rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} sx={{ fontWeight: "bold", color: "text.primary" }}>
                    รวม
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
                  <TableCell colSpan={3} />
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
          ขายส่ง
        </Typography>
        {/* the nightly job does this automatically; the button is the mid-day run for when the
            day's deals need locking before then */}
        <Button variant="outlined" onClick={handleConfirmAll} disabled={confirmAll.isPending || createdCount === 0}>
          {confirmAll.isPending ? "กำลังยืนยัน…" : `ยืนยันทั้งหมด (${createdCount})`}
        </Button>
        <Button component={RouterLink} to="/wholesale-sell/new">
          สร้างรายการ
        </Button>
      </Box>

      <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
        <TextField
          select
          label="สถานะ"
          value={currentStatus}
          onChange={(e) => setCurrentStatus(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">ทั้งหมด</MenuItem>
          {WHOLE_SELL_STATUSES.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="ผู้รับซื้อส่ง"
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
    </Container>
  );
}
