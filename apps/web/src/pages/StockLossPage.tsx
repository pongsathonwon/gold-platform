import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Box,
  Alert,
} from "@mui/material";
import { stockLossSchema, TRANSACTION_TYPES } from "@gold-platform/types";
import { useBrands, useProductTypePurities, useProductTypes } from "../hooks/useMasterData";
import { useStockLoss } from "../hooks/useInventoryMutations";
import { useToast } from "../components/ToastContext";
import { useAuth } from "../auth/AuthContext";
import { useDynamicForm } from "../forms/useDynamicForm";
import { DynamicFormField } from "../forms/DynamicFormField";
import { getVisibleFields, type FieldConfig } from "../forms/types";

interface LossValues extends Record<string, string> {
  productTypeId: string;
  purityId: string;
  brandId: string;
  origin: string;
  weight: string;
  referenceType: string;
  notes: string;
}

const initialValues: LossValues = {
  productTypeId: "",
  purityId: "",
  brandId: "",
  origin: "foreign",
  weight: "",
  referenceType: TRANSACTION_TYPES[0].value,
  notes: "",
};

// when an upstream field changes, downstream selections it no longer governs are reset
const RESET_ON_CHANGE: Record<string, (keyof LossValues)[]> = {
  productTypeId: ["purityId", "weight", "brandId", "origin"],
  purityId: ["weight"],
};

export function StockLossPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  const { data: productTypesRes } = useProductTypes();
  const { data: brandsRes } = useBrands();
  const stockLoss = useStockLoss();

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { values, setValue } = useDynamicForm(initialValues);
  const { data: purityRulesRes } = useProductTypePurities(values.productTypeId);
  const purityRules = purityRulesRes?.data ?? [];
  const matchingRule = (v: LossValues) => purityRules.find((p) => p.purityId === v.purityId);

  function handleChange(name: keyof LossValues, value: string) {
    setValue(name, value);
    // origin defaults to "foreign" and is only user-editable for 99.9% purity — reset it back to
    // that default, not to "", since the field stays hidden (and thus unfixable) for other purities
    RESET_ON_CHANGE[name as string]?.forEach((dep) => setValue(dep, dep === "origin" ? "foreign" : ""));
  }

  const fields: FieldConfig<LossValues>[] = [
    {
      name: "productTypeId",
      label: "Product Type",
      kind: "select",
      required: true,
      getOptions: () => (productTypesRes?.data ?? []).map((pt) => ({ value: pt.id, label: pt.productType })),
    },
    {
      name: "purityId",
      label: "Purity",
      kind: "select",
      required: true,
      isVisible: (v) => !!v.productTypeId,
      getOptions: () => purityRules.map((p) => ({ value: p.purityId, label: p.label })),
    },
    {
      name: "origin",
      label: "Origin",
      kind: "select",
      required: true,
      isVisible: (v) => matchingRule(v)?.percent === 99.9,
      getOptions: () => [
        { value: "domestic", label: "Domestic" },
        { value: "foreign", label: "Foreign" },
      ],
    },
    {
      name: "brandId",
      label: "Brand",
      kind: "select",
      required: true,
      isVisible: (v) => matchingRule(v)?.percent !== 99.9,
      getOptions: () => (brandsRes?.data ?? []).filter((b) => b.active).map((b) => ({ value: b.id, label: b.brand })),
    },
    {
      name: "weight",
      label: (v) => (matchingRule(v)?.inputUnit === "kg" ? "Weight (kg)" : "Weight (GB)"),
      kind: (v) => (matchingRule(v)?.allowedValues ? "select" : "number"),
      required: true,
      getOptions: (v) => (matchingRule(v)?.allowedValues ?? []).map((n) => ({ value: String(n), label: String(n) })),
      helperText: (v) => {
        const rule = matchingRule(v);
        return rule && !rule.allowedValues ? `Minimum ${rule.minQuantity} GB` : undefined;
      },
    },
    {
      name: "referenceType",
      label: "ประเภทรายการ",
      kind: "select",
      required: true,
      getOptions: () => TRANSACTION_TYPES.map((t) => ({ value: t.value, label: t.label })),
    },
    {
      name: "notes",
      label: "Notes",
      kind: "multiline",
    },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const rule = matchingRule(values);
    const payload = {
      purityId: values.purityId,
      brandId: rule?.percent === 99.9 ? undefined : values.brandId || undefined,
      origin: values.origin as "domestic" | "foreign",
      productTypeId: values.productTypeId,
      weight: Number(values.weight),
      referenceType: values.referenceType,
      notes: values.notes || undefined,
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
            {getVisibleFields(fields, values).map((field) => (
              <DynamicFormField key={String(field.name)} field={field} values={values} onChange={handleChange} />
            ))}

            <TextField label="Audited By" value={user?.username ?? ""} disabled />

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
