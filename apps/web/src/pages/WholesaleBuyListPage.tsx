import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Container, Typography, Table, TableBody, TableCell, TableContainer, TableFooter,
  TableHead, TableRow, Paper, Chip, Box, TextField, MenuItem, Button, Alert, CircularProgress,
} from "@mui/material";
import { WHOLE_BUY_STATUSES } from "@gold-platform/types";
import { useWholesaleBuyList, type WholeBuyTransaction } from "../hooks/useWholesaleBuy";
import { useProductTypes, usePurities, useSuppliers } from "../hooks/useMasterData";
import { splitByPurity } from "../utils/inventoryVolume";
import { countsTowardTotal, formatNumber, statusColor, statusLabel } from "../utils/wholeBuyStatus";

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

export function WholesaleBuyListPage() {
  const [currentStatus, setCurrentStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");

  const filter = {
    ...(currentStatus ? { currentStatus } : {}),
    ...(supplierId ? { supplierId } : {}),
  };
  const { data, isPending, isError, error } = useWholesaleBuyList(filter);
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
                const delivered = deliveredWeight(t, unit);
                const ordered = orderedWeight(t, unit);
                const short = t.actualWeightGb !== null && delivered !== ordered;

                return (
                  <TableRow key={t.id} hover>
                    <TableCell>{new Date(t.recordedAt).toLocaleDateString("th-TH")}</TableCell>
                    <TableCell>{supplierName(t.supplierId)}</TableCell>
                    <TableCell>{productTypeName(t.productTypeId)}</TableCell>
                    <TableCell align="right">
                      {formatNumber(delivered, unit === "kg" ? 3 : 2)}
                      {short && (
                        <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.5 }}>
                          (สั่ง {formatNumber(ordered, unit === "kg" ? 3 : 2)})
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
                    {excluded > 0 && (
                      <Typography component="span" variant="caption" sx={{ ml: 1, fontWeight: 400 }}>
                        (ไม่รวม {excluded} รายการที่ยกเลิก/ปฏิเสธ/ตีกลับ)
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: "bold", color: "text.primary" }}>
                    {formatNumber(totalWeight, unit === "kg" ? 3 : 2)}
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
          ซื้อส่ง
        </Typography>
        <Button component={RouterLink} to="/wholesale-buy/new">
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
    </Container>
  );
}
