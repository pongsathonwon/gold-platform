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
  Button,
  CircularProgress,
  Alert,
} from "@mui/material";
import { originLabel, todayBusinessDate } from "@gold-platform/types";
import { useInventoryVolume } from "../hooks/useInventory";
import { usePurities, useBrands, useProductTypes } from "../hooks/useMasterData";
import { type VolumeRow, poolKey, weightOf, splitByPurity, wacRate } from "../utils/inventoryVolume";
import { balanceFileName, buildBalanceWorkbook, downloadWorkbook } from "../utils/inventoryExport";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/ToastContext";
import { formatNumber, formatWeight } from "../utils/format";

export function InventoryPage() {
  const { data: volumeRes, isPending, isError } = useInventoryVolume();
  const { data: puritiesRes } = usePurities();
  const { data: brandsRes } = useBrands();
  const { data: productTypesRes } = useProductTypes();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  // Rebuilt on every render before this was memoised — three Maps over the whole master data set,
  // for lookups the table performs once per row.
  const purityById = useMemo(
    () => new Map((puritiesRes?.data ?? []).map((p) => [p.id, p])),
    [puritiesRes],
  );
  const brandById = useMemo(() => new Map((brandsRes?.data ?? []).map((b) => [b.id, b])), [brandsRes]);
  const productTypeById = useMemo(
    () => new Map((productTypesRes?.data ?? []).map((pt) => [pt.id, pt])),
    [productTypesRes],
  );

  const rows: VolumeRow[] = volumeRes?.data ?? [];
  const { nineSixFive, nineNineNine } = splitByPurity(
    rows,
    (row) => purityById.get(row.purityId)?.percent === 99.9,
  );

  // The same resolution the table below does, handed to the workbook builder so the file and the
  // screen cannot disagree about what a pool is called.
  const exportLabels = {
    pool: (row: { brandId: string; origin: string }, unit: "gb" | "kg") =>
      unit === "kg" ? originLabel(row.origin) : brandById.get(row.brandId)?.brand ?? row.brandId,
    productType: (id: string) => productTypeById.get(id)?.productType ?? id,
    referenceType: (type: string) => type,
  };

  async function handleExport() {
    setIsExporting(true);
    try {
      const asOf = todayBusinessDate();
      await downloadWorkbook(
        buildBalanceWorkbook({
          nineSixFive,
          nineNineNine,
          labels: exportLabels,
          asOf,
          generatedAt: new Date(),
          generatedBy: user?.name ?? user?.username ?? "",
        }),
        balanceFileName(asOf),
      );
    } catch {
      showToast("ส่งออกไฟล์ไม่สำเร็จ", "error");
    } finally {
      setIsExporting(false);
    }
  }

  function renderSection(title: string, sectionRows: VolumeRow[], unit: "gb" | "kg") {
    const weightHeader = unit === "gb" ? "น้ำหนัก (บาท)" : "น้ำหนัก (กก.)";
    // 99.9% pools are keyed by origin, not brand — the column holds a different fact per section
    const brandHeader = unit === "gb" ? "แบรน" : "ที่มา";
    const totalWeight = sectionRows.reduce((sum, r) => sum + weightOf(r, unit), 0);
    const totalCost = sectionRows.reduce((sum, r) => sum + (r.totalCost ?? 0), 0);
    // The average is per **gold baht** in both sections, because that is what the column says and
    // what every row above it shows. Dividing by `totalWeight` gave THB/kg in the 99.9% table — a
    // footer in a different unit from the rows it totals. Weight can legitimately be zero (a pool
    // drained but still listed), and `0/0` printed a literal "NaN".
    const totalWeightGb = sectionRows.reduce((sum, r) => sum + r.totalWeightGb, 0);
    const averageRate = totalWeightGb > 0 ? totalCost / totalWeightGb : 0;

    return (
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" sx={{ mb: 1 }}>
          {title}
        </Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{brandHeader}</TableCell>
                <TableCell>ประเภททอง</TableCell>
                <TableCell align="right">{weightHeader}</TableCell>
                <TableCell align="right">มูลค่า</TableCell>
                <TableCell align="right">ราคาเฉลี่ย (บาท/บาททอง)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sectionRows.map((row) => {
                const brandOrOrigin =
                  unit === "kg" ? originLabel(row.origin) : brandById.get(row.brandId)?.brand ?? row.brandId;

                return (
                  <TableRow key={poolKey(row)}>
                    <TableCell>{brandOrOrigin}</TableCell>
                    <TableCell>{productTypeById.get(row.productTypeId)?.productType ?? row.productTypeId}</TableCell>
                    <TableCell align="right">{formatWeight(weightOf(row, unit))}</TableCell>
                    <TableCell align="right">{formatNumber(row.totalCost ?? 0)}</TableCell>
                    <TableCell align="right">{formatNumber(wacRate(row))}</TableCell>
                  </TableRow>
                );
              })}
              {sectionRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    ไม่พบรายการ
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {sectionRows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} sx={{ fontWeight: "bold", color: "text.primary" }}>
                    รวม
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: "bold", color: "text.primary" }}>
                    {formatWeight(totalWeight)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: "bold", color: "text.primary" }}>
                    {formatNumber(totalCost)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: "bold", color: "text.primary" }}>{formatNumber(averageRate)}</TableCell>
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
      <Box
        sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3, gap: 2, flexWrap: "wrap" }}
      >
        <Typography variant="h2">คลังทองคำแท่ง</Typography>
        {/* Exporting a half-loaded table is worse than offering no button, so the control waits
            for the data it is going to write. */}
        <Button
          variant="outlined"
          onClick={handleExport}
          disabled={isPending || isError || isExporting}
          startIcon={isExporting ? <CircularProgress size={16} /> : undefined}
        >
          ส่งออก Excel
        </Button>
      </Box>

      {isPending && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {isError && <Alert severity="error">โหลดข้อมูลคลังไม่สำเร็จ</Alert>}

      {volumeRes && (
        <>
          {renderSection("ทอง 96.5%", nineSixFive, "gb")}
          {renderSection("ทอง 99.9%", nineNineNine, "kg")}
        </>
      )}
    </Container>
  );
}
