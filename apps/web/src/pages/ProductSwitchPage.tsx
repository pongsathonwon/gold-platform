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
import { productSwitchSchema } from "@gold-platform/types";
import { useBrands, useProductTypePurities, useProductTypes } from "../hooks/useMasterData";
import { useProductSwitch } from "../hooks/useInventoryMutations";
import { useToast } from "../components/ToastContext";
import { useAuth } from "../auth/AuthContext";
import { useDynamicForm } from "../forms/useDynamicForm";
import { DynamicFormField } from "../forms/DynamicFormField";
import { getVisibleFields, type FieldConfig } from "../forms/types";

interface SwitchValues extends Record<string, string> {
  productTypeId: string;
  purityId: string;
  fromBrandId: string;
  weight: string;
  notes: string;
}

const initialValues: SwitchValues = {
  productTypeId: "",
  purityId: "",
  fromBrandId: "",
  weight: "",
  notes: "",
};

// when an upstream field changes, downstream selections it no longer governs are reset
const RESET_ON_CHANGE: Record<string, (keyof SwitchValues)[]> = {
  productTypeId: ["purityId", "weight", "fromBrandId"],
  purityId: ["weight"],
};

export function ProductSwitchPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  const { data: productTypesRes } = useProductTypes();
  const { data: brandsRes } = useBrands();
  const productSwitch = useProductSwitch();

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { values, setValue } = useDynamicForm(initialValues);
  const { data: purityRulesRes } = useProductTypePurities(values.productTypeId);
  const purityRules = purityRulesRes?.data ?? [];

  function handleChange(name: keyof SwitchValues, value: string) {
    setValue(name, value);
    RESET_ON_CHANGE[name as string]?.forEach((dep) => setValue(dep, ""));
  }

  const fields: FieldConfig<SwitchValues>[] = [
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
      name: "fromBrandId",
      label: "From Brand",
      kind: "select",
      required: true,
      // only non-fungible, active brands can be reclassified into the fungible pool
      getOptions: () => (brandsRes?.data ?? []).filter((b) => b.active && b.nonFungible).map((b) => ({ value: b.id, label: b.brand })),
    },
    {
      name: "weight",
      label: (v) => {
        const rule = purityRules.find((p) => p.purityId === v.purityId);
        return rule?.inputUnit === "kg" ? "Weight (kg)" : "Weight (GB)";
      },
      kind: (v) => {
        const rule = purityRules.find((p) => p.purityId === v.purityId);
        return rule?.allowedValues ? "select" : "number";
      },
      required: true,
      getOptions: (v) => {
        const rule = purityRules.find((p) => p.purityId === v.purityId);
        return (rule?.allowedValues ?? []).map((n) => ({ value: String(n), label: String(n) }));
      },
      helperText: (v) => {
        const rule = purityRules.find((p) => p.purityId === v.purityId);
        return rule && !rule.allowedValues ? `Minimum ${rule.minQuantity} GB` : undefined;
      },
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

    const payload = {
      purityId: values.purityId,
      productTypeId: values.productTypeId,
      fromBrandId: values.fromBrandId,
      weight: Number(values.weight),
      notes: values.notes || undefined,
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
            {getVisibleFields(fields, values).map((field) => (
              <DynamicFormField key={String(field.name)} field={field} values={values} onChange={handleChange} />
            ))}

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
