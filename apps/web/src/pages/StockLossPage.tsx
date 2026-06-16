import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Typography,
  Card,
  CardContent,
  TextField,
  MenuItem,
  Button,
  Box,
  Alert,
} from "@mui/material";
import { stockLossSchema } from "@gold-platform/types";
import { usePurities, useBrands, useProductTypes } from "../hooks/useMasterData";
import { useStockLoss } from "../hooks/useInventoryMutations";
import { useToast } from "../components/ToastContext";

const LOSS_REASONS = [
  { value: "stock_count_loss", label: "Stock Count Loss" },
  { value: "damage", label: "Damage" },
  { value: "lost", label: "Lost" },
  { value: "correction", label: "Correction" },
] as const;

export function StockLossPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { data: puritiesRes } = usePurities();
  const { data: brandsRes } = useBrands();
  const { data: productTypesRes } = useProductTypes();
  const stockLoss = useStockLoss();

  const [purityId, setPurityId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [origin, setOrigin] = useState<"domestic" | "foreign">("foreign");
  const [productTypeId, setProductTypeId] = useState("");
  const [weightGb, setWeightGb] = useState("");
  const [weightGm, setWeightGm] = useState("");
  const [reason, setReason] = useState<"stock_count_loss" | "damage" | "lost" | "correction">("stock_count_loss");
  const [notes, setNotes] = useState("");
  const [auditedBy, setAuditedBy] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedPurity = (puritiesRes?.data ?? []).find((p) => p.id === purityId);
  const isNineNineNine = selectedPurity?.percent === 99.9;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const payload = {
      purityId,
      brandId: isNineNineNine ? undefined : brandId || undefined,
      origin,
      productTypeId,
      weightGb: Number(weightGb),
      weightGm: Number(weightGm),
      reason,
      notes: notes || undefined,
      auditedBy,
    };

    const parsed = stockLossSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setFieldError(null);

    stockLoss.mutate(parsed.data, {
      onSuccess: () => {
        showToast("Stock removed");
        navigate("/inventory");
      },
      onError: (err) => setSubmitError(err instanceof Error ? err.message : "Failed to remove stock"),
    });
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h2" sx={{ mb: 3 }}>
        Stock Loss
      </Typography>
      <Card>
        <CardContent>
          <Box component="form" onSubmit={handleSubmit} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField select label="Purity" value={purityId} onChange={(e) => setPurityId(e.target.value)} required>
              {(puritiesRes?.data ?? []).map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.label}
                </MenuItem>
              ))}
            </TextField>

            {isNineNineNine ? (
              <TextField select label="Origin" value={origin} onChange={(e) => setOrigin(e.target.value as "domestic" | "foreign")} required>
                <MenuItem value="domestic">Domestic</MenuItem>
                <MenuItem value="foreign">Foreign</MenuItem>
              </TextField>
            ) : (
              <TextField select label="Brand" value={brandId} onChange={(e) => setBrandId(e.target.value)} required>
                {(brandsRes?.data ?? []).map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.brand}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <TextField select label="Product Type" value={productTypeId} onChange={(e) => setProductTypeId(e.target.value)} required>
              {(productTypesRes?.data ?? []).map((pt) => (
                <MenuItem key={pt.id} value={pt.id}>
                  {pt.productType}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Weight (GB)"
              type="number"
              value={weightGb}
              onChange={(e) => setWeightGb(e.target.value)}
              required
            />
            <TextField
              label="Weight (g)"
              type="number"
              value={weightGm}
              onChange={(e) => setWeightGm(e.target.value)}
              required
            />

            <TextField select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} required>
              {LOSS_REASONS.map((r) => (
                <MenuItem key={r.value} value={r.value}>
                  {r.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
            <TextField label="Audited By" value={auditedBy} onChange={(e) => setAuditedBy(e.target.value)} required />

            {fieldError && <Alert severity="error">{fieldError}</Alert>}
            {submitError && <Alert severity="error">{submitError}</Alert>}

            <Button type="submit" disabled={stockLoss.isPending}>
              {stockLoss.isPending ? "Saving…" : "Remove Stock"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
