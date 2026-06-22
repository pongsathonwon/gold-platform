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
import { productSwitchSchema } from "@gold-platform/types";
import { usePurities, useBrands, useProductTypes } from "../hooks/useMasterData";
import { useProductSwitch } from "../hooks/useInventoryMutations";
import { useToast } from "../components/ToastContext";
import { useAuth } from "../auth/AuthContext";

export function ProductSwitchPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  const { data: puritiesRes } = usePurities();
  const { data: brandsRes } = useBrands();
  const { data: productTypesRes } = useProductTypes();
  const productSwitch = useProductSwitch();

  const [purityId, setPurityId] = useState("");
  const [productTypeId, setProductTypeId] = useState("");
  const [fromBrandId, setFromBrandId] = useState("");
  const [weightGb, setWeightGb] = useState("");
  const [weightGm, setWeightGm] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const nonFungibleBrands = (brandsRes?.data ?? []).filter((b) => b.nonFungible);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const payload = {
      purityId,
      productTypeId,
      fromBrandId,
      weightGb: Number(weightGb),
      weightGm: Number(weightGm),
      notes: notes || undefined,
    };

    const parsed = productSwitchSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setFieldError(null);

    productSwitch.mutate(parsed.data, {
      onSuccess: () => {
        showToast("Reclassified to fungible pool");
        navigate("/inventory");
      },
      onError: (err) => setSubmitError(err instanceof Error ? err.message : "Failed to switch product"),
    });
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h2" sx={{ mb: 3 }}>
        Product Switch
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

            <TextField select label="Product Type" value={productTypeId} onChange={(e) => setProductTypeId(e.target.value)} required>
              {(productTypesRes?.data ?? []).map((pt) => (
                <MenuItem key={pt.id} value={pt.id}>
                  {pt.productType}
                </MenuItem>
              ))}
            </TextField>

            <TextField select label="From Brand" value={fromBrandId} onChange={(e) => setFromBrandId(e.target.value)} required>
              {nonFungibleBrands.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.brand}
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

            <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
            <TextField label="Switched By" value={user?.username ?? ""} disabled />

            {fieldError && <Alert severity="error">{fieldError}</Alert>}
            {submitError && <Alert severity="error">{submitError}</Alert>}

            <Button type="submit" disabled={productSwitch.isPending}>
              {productSwitch.isPending ? "Saving…" : "Switch Product"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
