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
} from "@mui/material";
import { useInventoryMovements } from "../hooks/useInventory";
import { usePurities, useBrands, useProductTypes } from "../hooks/useMasterData";
import { TRANSACTION_TYPES } from "@gold-platform/types";

const REFERENCE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  TRANSACTION_TYPES.map((t) => [t.value, t.label]),
);

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  Goldbar: "ทองแท่ง",
  "Gold Plate": "ทองแผ่น",
};

function formatCostDelta(value: number) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
  movedAt: string;
  movedBy: string;
  notes: string | null;
};

export function InventoryMovementPage() {
  const { data: movementsRes, isPending, isError } = useInventoryMovements();
  const { data: puritiesRes } = usePurities();
  const { data: brandsRes } = useBrands();
  const { data: productTypesRes } = useProductTypes();

  const purityById = new Map((puritiesRes?.data ?? []).map((p) => [p.id, p]));
  const brandById = new Map((brandsRes?.data ?? []).map((b) => [b.id, b]));
  const productTypeById = new Map((productTypesRes?.data ?? []).map((pt) => [pt.id, pt]));

  const rows: MovementRow[] = movementsRes?.data ?? [];
  const isNineNineNine = (row: MovementRow) => purityById.get(row.purityId)?.percent === 99.9;
  const nineSixFive = rows.filter((r) => !isNineNineNine(r));
  const nineNineNine = rows.filter(isNineNineNine);

  // 96.5% deltas are in gold baht (บาท); 99.9% in kilograms (กก. = grams / 1000)
  function renderSection(title: string, sectionRows: MovementRow[], unit: "gb" | "kg") {
    const weightHeader = unit === "gb" ? "น้ำหนัก (บาท)" : "น้ำหนัก (กก.)";
    const weightOf = (r: MovementRow) => (unit === "gb" ? r.weightGbDelta : r.weightGmDelta / 1000);
    const totalWeight = sectionRows.reduce((sum, r) => sum + weightOf(r), 0);
    const totalCost = sectionRows.reduce((sum, r) => sum + r.costDelta, 0);

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
                <TableCell>แบรน</TableCell>
                <TableCell>ประเภททอง</TableCell>
                <TableCell>ประเภทรายการ</TableCell>
                <TableCell align="right">{weightHeader}</TableCell>
                <TableCell align="right">มูลค่า</TableCell>
                <TableCell>บันทึกโดย</TableCell>
                <TableCell>หมายเหตุ</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sectionRows.map((row) => {
                const brandOrOrigin =
                  unit === "kg" ? row.origin : brandById.get(row.brandId)?.brand ?? row.brandId;
                const weight = weightOf(row);
                const isPositive = row.weightGbDelta >= 0;
                const deltaColor = isPositive ? "success.main" : "error.main";
                const productType = productTypeById.get(row.productTypeId)?.productType;

                return (
                  <TableRow key={row.id}>
                    <TableCell>{new Date(row.movedAt).toLocaleString()}</TableCell>
                    <TableCell>{brandOrOrigin}</TableCell>
                    <TableCell>{PRODUCT_TYPE_LABEL[productType ?? ""] ?? productType ?? row.productTypeId}</TableCell>
                    <TableCell>
                      <Chip label={REFERENCE_TYPE_LABEL[row.referenceType] ?? row.referenceType} size="small" />
                    </TableCell>
                    <TableCell align="right" sx={{ color: deltaColor }}>
                      {isPositive ? "+" : ""}
                      {weight.toFixed(4)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: deltaColor }}>
                      {formatCostDelta(row.costDelta)}
                    </TableCell>
                    <TableCell>{row.movedBy}</TableCell>
                    <TableCell>{row.notes ?? ""}</TableCell>
                  </TableRow>
                );
              })}
              {sectionRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    ไม่พบรายการเคลื่อนไหว
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {sectionRows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} sx={{ fontWeight: "bold", color: "text.primary" }}>
                    รวม
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontWeight: "bold", color: totalWeight >= 0 ? "success.main" : "error.main" }}
                  >
                    {totalWeight >= 0 ? "+" : ""}
                    {totalWeight.toFixed(4)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontWeight: "bold", color: totalCost >= 0 ? "success.main" : "error.main" }}
                  >
                    {formatCostDelta(totalCost)}
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
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h2">Inventory Movement</Typography>
      </Box>

      {isPending && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {isError && <Alert severity="error">Failed to load inventory movements.</Alert>}

      {movementsRes && (
        <>
          {renderSection("ทอง 96.5%", nineSixFive, "gb")}
          {renderSection("ทอง 99.9%", nineNineNine, "kg")}
        </>
      )}
    </Container>
  );
}
