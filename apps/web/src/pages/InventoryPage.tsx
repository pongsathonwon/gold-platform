import {
  Container,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Paper,
  Button,
  Box,
  CircularProgress,
  Alert,
  Stack,
  Chip,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useInventoryVolume, useComputeSnapshot, useTodaySnapshots } from "../hooks/useInventory";
import { usePurities, useBrands, useProductTypes } from "../hooks/useMasterData";
import { useToast } from "../components/ToastContext";

function poolKey(row: { purityId: string; brandId: string; origin: string; productTypeId: string }) {
  return `${row.purityId}-${row.brandId}-${row.origin}-${row.productTypeId}`;
}

export function InventoryPage() {
  const { data: volumeRes, isPending, isError } = useInventoryVolume();
  const { data: snapshotsRes } = useTodaySnapshots();
  const { data: puritiesRes } = usePurities();
  const { data: brandsRes } = useBrands();
  const { data: productTypesRes } = useProductTypes();
  const computeSnapshot = useComputeSnapshot();
  const { showToast } = useToast();

  const purityById = new Map((puritiesRes?.data ?? []).map((p) => [p.id, p]));
  const brandById = new Map((brandsRes?.data ?? []).map((b) => [b.id, b]));
  const productTypeById = new Map((productTypesRes?.data ?? []).map((pt) => [pt.id, pt]));
  const computedPools = new Set((snapshotsRes?.data ?? []).map(poolKey));

  function handleComputeSnapshot() {
    computeSnapshot.mutate(undefined, {
      onSuccess: () => showToast("Today's rate computed"),
      onError: () => showToast("Failed to compute today's rate", "error"),
    });
  }

  return (
    <Container sx={{ py: 4 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h2">Inventory</Typography>
        <Stack direction="row" spacing={2}>
          <Button component={RouterLink} to="/inventory/gain" variant="outlined">
            Stock Gain
          </Button>
          <Button component={RouterLink} to="/inventory/loss" variant="outlined">
            Stock Loss
          </Button>
          <Button component={RouterLink} to="/inventory/switch" variant="outlined">
            Product Switch
          </Button>
          <Button onClick={handleComputeSnapshot} disabled={computeSnapshot.isPending}>
            {computeSnapshot.isPending ? "Computing…" : "Compute Today's Rate"}
          </Button>
        </Stack>
      </Box>

      {isPending && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {isError && <Alert severity="error">Failed to load inventory volume.</Alert>}

      {volumeRes && (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Purity</TableCell>
                <TableCell>Brand / Origin</TableCell>
                <TableCell>Product Type</TableCell>
                <TableCell align="right">Weight (GB)</TableCell>
                <TableCell align="right">Weight (g)</TableCell>
                <TableCell align="right">Total Cost</TableCell>
                <TableCell align="right">WAC Rate (THB/GB)</TableCell>
                <TableCell align="center">Today's Rate</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {volumeRes.data.map((row) => {
                const purity = purityById.get(row.purityId);
                const isNineNineNine = purity?.percent === 99.9;
                const brandOrOrigin = isNineNineNine
                  ? row.origin
                  : brandById.get(row.brandId)?.brand ?? row.brandId;
                const wacRate = row.totalWeightGb > 0 ? row.totalCost / row.totalWeightGb : 0;
                const isComputed = computedPools.has(poolKey(row));

                return (
                  <TableRow key={poolKey(row)}>
                    <TableCell>{purity?.label ?? row.purityId}</TableCell>
                    <TableCell>{brandOrOrigin}</TableCell>
                    <TableCell>{productTypeById.get(row.productTypeId)?.productType ?? row.productTypeId}</TableCell>
                    <TableCell align="right">{row.totalWeightGb.toFixed(4)}</TableCell>
                    <TableCell align="right">{row.totalWeightGm.toFixed(2)}</TableCell>
                    <TableCell align="right">{row.totalCost.toFixed(2)}</TableCell>
                    <TableCell align="right">{wacRate.toFixed(2)}</TableCell>
                    <TableCell align="center">
                      <Chip
                        label={isComputed ? "Computed" : "Not computed"}
                        color={isComputed ? "success" : "default"}
                        size="small"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {volumeRes.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    No inventory balance yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Container>
  );
}
