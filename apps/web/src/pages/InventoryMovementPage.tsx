import { useMemo, useState } from "react";
import {
  Container,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableFooter,
  TableRow,
  TableCell,
  TableContainer,
  Paper,
  Box,
  CircularProgress,
  Alert,
  Chip,
  TextField,
} from "@mui/material";
import { useInventoryMovements } from "../hooks/useInventory";
import { usePurities, useBrands, useProductTypes } from "../hooks/useMasterData";
import { withCumulative, type WithCumulative } from "../utils/inventoryVolume";
import { formatBusinessDate, formatNumber, formatWeight } from "../utils/format";
import { originLabel, shiftBusinessDate, todayBusinessDate, TRANSACTION_TYPES } from "@gold-platform/types";

const REFERENCE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  TRANSACTION_TYPES.map((t) => [t.value, t.label]),
);

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  Goldbar: "ทองแท่ง",
  "Gold Plate": "ทองแผ่น",
};

// money, with an explicit sign — the ledger reads as movement, so "+1,200.00" and "-1,200.00"
// say more than a bare number and a colour do
function formatCostDelta(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatNumber(Math.abs(value))}`;
}

type MovementRow = {
  id: string;
  purityId: string;
  brandId: string;
  origin: string;
  productTypeId: string;
  referenceType: string;
  weightGbDelta: number;
  weightGmDelta: number;
  costDelta: number;
  // the trading day the movement belongs to; movedAt is when the row was written
  movementDate: string;
  movedAt: string;
  movedBy: string;
  notes: string | null;
};

type CumulativeRow = WithCumulative<MovementRow>;

export function InventoryMovementPage() {
  // Opens on yesterday and today. Days on the shop's calendar, not the viewer's — the ledger is
  // kept on Bangkok time. Today alone was empty every morning before the first movement was
  // booked, which reads as a broken page rather than an empty day; carrying yesterday means the
  // ledger always opens with the last thing that happened still on screen.
  const [fromDate, setFromDate] = useState(() => shiftBusinessDate(todayBusinessDate(), -1));
  const [toDate, setToDate] = useState(() => todayBusinessDate());

  // Plain days, both ends inclusive. The window is matched against each movement's business date
  // server-side, so this no longer has to manufacture an end-of-day instant — and the last day of
  // a range can no longer lose everything recorded after midnight.
  const filter = useMemo(() => ({ from: fromDate, to: toDate }), [fromDate, toDate]);

  const { data: movementsRes, isPending, isError } = useInventoryMovements(filter);
  const { data: puritiesRes } = usePurities();
  const { data: brandsRes } = useBrands();
  const { data: productTypesRes } = useProductTypes();

  const purityById = new Map((puritiesRes?.data ?? []).map((p) => [p.id, p]));
  const brandById = new Map((brandsRes?.data ?? []).map((b) => [b.id, b]));
  const productTypeById = new Map((productTypesRes?.data ?? []).map((pt) => [pt.id, pt]));

  // Movements arrive ascending by (movementDate, movedAt, id). The running balance is seeded from
  // the opening — the deltas before `from` — and the rows stay in that ascending order, so each
  // row's cumulative reads as the balance after it and the last row carries the window's closing.
  const rows: CumulativeRow[] = useMemo(() => {
    const movements = (movementsRes?.movements ?? []) as MovementRow[];
    const opening = movementsRes?.opening ?? [];
    return withCumulative(movements, opening);
  }, [movementsRes]);

  const isNineNineNine = (row: MovementRow) => purityById.get(row.purityId)?.percent === 99.9;
  const nineSixFive = rows.filter((r) => !isNineNineNine(r));
  const nineNineNine = rows.filter(isNineNineNine);

  // 96.5% deltas are in gold baht (บาท); 99.9% in kilograms (กก. = grams / 1000)
  function renderSection(title: string, sectionRows: CumulativeRow[], unit: "gb" | "kg") {
    const weightHeader = unit === "gb" ? "น้ำหนัก (บาท)" : "น้ำหนัก (กก.)";
    // 99.9% pools are keyed by origin, not brand — the column holds a different fact per section
    const brandHeader = unit === "gb" ? "แบรน" : "ที่มา";
    const balanceHeader = unit === "gb" ? "คงเหลือสะสม (บาท)" : "คงเหลือสะสม (กก.)";
    const deltaOf = (r: CumulativeRow) => (unit === "gb" ? r.weightGbDelta : r.weightGmDelta / 1000);
    const balanceOf = (r: CumulativeRow) =>
      unit === "gb" ? r.cumulativeWeightGb : r.cumulativeWeightGm / 1000;
    const totalWeight = sectionRows.reduce((sum, r) => sum + deltaOf(r), 0);
    const totalCost = sectionRows.reduce((sum, r) => sum + r.costDelta, 0);
    // rows are oldest-first, so the closing balance for the window is the last row's cumulative
    const closingBalance = sectionRows.length > 0 ? balanceOf(sectionRows[sectionRows.length-1]) : 0;

    return (
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" sx={{ mb: 1 }}>
          {title}
        </Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>วันที่</TableCell>
                <TableCell>{brandHeader}</TableCell>
                <TableCell>ประเภททอง</TableCell>
                <TableCell>ประเภทรายการ</TableCell>
                <TableCell align="right">{weightHeader}</TableCell>
                <TableCell align="right">มูลค่า</TableCell>
                <TableCell align="right">{balanceHeader}</TableCell>
                <TableCell>บันทึกโดย</TableCell>
                <TableCell>หมายเหตุ</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sectionRows.map((row) => {
                const brandOrOrigin =
                  unit === "kg" ? originLabel(row.origin) : brandById.get(row.brandId)?.brand ?? row.brandId;
                const delta = deltaOf(row);
                const isPositive = row.weightGbDelta >= 0;
                const deltaColor = isPositive ? "success.main" : "error.main";
                const productType = productTypeById.get(row.productTypeId)?.productType;

                return (
                  <TableRow key={row.id}>
                    {/* the day the movement belongs to; for a backdated adjustment that is the
                        day it happened, not the day it was entered */}
                    <TableCell>{formatBusinessDate(row.movementDate)}</TableCell>
                    <TableCell>{brandOrOrigin}</TableCell>
                    <TableCell>{PRODUCT_TYPE_LABEL[productType ?? ""] ?? productType ?? row.productTypeId}</TableCell>
                    <TableCell>
                      <Chip label={REFERENCE_TYPE_LABEL[row.referenceType] ?? row.referenceType} size="small" />
                    </TableCell>
                    <TableCell align="right" sx={{ color: deltaColor }}>
                      {isPositive ? "+" : ""}
                      {formatWeight(delta)}
                    </TableCell>
                                        <TableCell align="right" sx={{ color: deltaColor }}>
                      {formatCostDelta(row.costDelta)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: deltaColor, fontWeight: "medium" }}>
                      {formatWeight(balanceOf(row))}
                    </TableCell>

                    <TableCell>{row.movedBy}</TableCell>
                    <TableCell>{row.notes ?? ""}</TableCell>
                  </TableRow>
                );
              })}
              {sectionRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} align="center">
                    ไม่พบรายการเคลื่อนไหว
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {sectionRows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} sx={{ fontWeight: "bold", color: "text.primary" }}>
                    รวม / คงเหลือ
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontWeight: "bold", color: totalWeight >= 0 ? "success.main" : "error.main" }}
                  >
                    {totalWeight >= 0 ? "+" : ""}
                    {formatWeight(totalWeight)}
                  </TableCell>

                  <TableCell
                    align="right"
                    sx={{ fontWeight: "bold", color: totalCost >= 0 ? "success.main" : "error.main" }}
                  >
                    {formatCostDelta(totalCost)}
                  </TableCell>
                                    <TableCell align="right" sx={{ fontWeight: "bold", color: "text.primary" }}>
                    {formatWeight(closingBalance)}
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
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3, gap: 2, flexWrap: "wrap" }}>
        <Typography variant="h2">ความเคลื่อนไหวทองแท่ง</Typography>
        <Box sx={{ display: "flex", gap: 2 }}>
          <TextField
            label="ตั้งแต่วันที่"
            type="date"
            size="small"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            slotProps={{inputLabel: {shrink: true}}}
          />
          <TextField
            label="ถึงวันที่"
            type="date"
            size="small"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            slotProps={{inputLabel: {shrink: true}}}
          />
        </Box>
      </Box>

      {isPending && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {isError && <Alert severity="error">โหลดความเคลื่อนไหวไม่สำเร็จ</Alert>}

      {movementsRes && (
        <>
          {renderSection("ทอง 96.5%", nineSixFive, "gb")}
          {renderSection("ทอง 99.9%", nineNineNine, "kg")}
        </>
      )}
    </Container>
  );
}
