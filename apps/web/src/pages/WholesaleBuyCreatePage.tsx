import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container, Typography, Card, CardContent, Button, Box, Alert,
} from "@mui/material";
import { createWholeBuySchema, derivePricePerGb999 } from "@gold-platform/types";
import {
  useBrands, useProductTypePurities, useProductTypes, useSuppliers,
} from "../hooks/useMasterData";
import { useCreateWholesaleBuy } from "../hooks/useWholesaleBuyMutations";
import { useToast } from "../components/ToastContext";
import { useDynamicForm } from "../forms/useDynamicForm";
import { DynamicFormField } from "../forms/DynamicFormField";
import { getVisibleFields, type FieldConfig } from "../forms/types";

interface BuyValues extends Record<string, string> {
  supplierId: string;
  productTypeId: string;
  purityId: string;
  brandId: string;
  weight: string;
  pricePerGb965: string;
  pricePerGb999: string;
  notes: string;
}

const initialValues: BuyValues = {
  supplierId: "",
  productTypeId: "",
  purityId: "",
  brandId: "",
  weight: "",
  pricePerGb965: "",
  pricePerGb999: "",
  notes: "",
};

// when an upstream field changes, downstream selections it no longer governs are reset
const RESET_ON_CHANGE: Record<string, (keyof BuyValues)[]> = {
  productTypeId: ["purityId", "weight", "brandId"],
  purityId: ["weight"],
};

export function WholesaleBuyCreatePage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { data: suppliersRes } = useSuppliers();
  const { data: productTypesRes } = useProductTypes();
  const { data: brandsRes } = useBrands();
  const createTransaction = useCreateWholesaleBuy();

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { values, setValue } = useDynamicForm(initialValues);
  const { data: purityRulesRes } = useProductTypePurities(values.productTypeId);
  const purityRules = purityRulesRes?.data ?? [];
  const matchingRule = (v: BuyValues) => purityRules.find((p) => p.purityId === v.purityId);

  function handleChange(name: keyof BuyValues, value: string) {
    setValue(name, value);
    RESET_ON_CHANGE[name as string]?.forEach((dep) => setValue(dep, ""));
    // the 99.9% quote is the 96.5% quote scaled by the purity ratio. Pre-fill it so the
    // operator does not retype the arithmetic — they stay free to overwrite it, and whatever
    // sits in the field at submit time is what gets stored.
    if (name === "pricePerGb965") {
      const base = Number(value);
      setValue("pricePerGb999", base > 0 ? String(derivePricePerGb999(base)) : "");
    }
  }

  const fields: FieldConfig<BuyValues>[] = [
    {
      name: "supplierId",
      label: "ผู้ขายส่ง",
      kind: "select",
      required: true,
      getOptions: () =>
        (suppliersRes?.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.supplierName })),
    },
    {
      name: "productTypeId",
      label: "ประเภททองคำ",
      kind: "select",
      required: true,
      getOptions: () => (productTypesRes?.data ?? []).map((pt) => ({ value: pt.id, label: pt.productType })),
    },
    {
      name: "purityId",
      label: "% ทอง",
      kind: "select",
      required: true,
      isVisible: (v) => !!v.productTypeId,
      getOptions: () => purityRules.map((p) => ({ value: p.purityId, label: p.label })),
    },
    {
      // 99.9% pools are keyed by origin rather than brand — the server substitutes the sentinel
      name: "brandId",
      label: "ยี่ห้อ",
      kind: "select",
      required: true,
      isVisible: (v) => !!v.purityId && matchingRule(v)?.percent !== 99.9,
      getOptions: () => (brandsRes?.data ?? []).filter((b) => b.active).map((b) => ({ value: b.id, label: b.brand })),
    },
    {
      name: "weight",
      label: (v) => (matchingRule(v)?.inputUnit === "kg" ? "น้ำหนัก (kg)" : "น้ำหนัก (บาท)"),
      kind: (v) => (matchingRule(v)?.allowedValues ? "select" : "number"),
      required: true,
      isVisible: (v) => !!v.purityId,
      getOptions: (v) => (matchingRule(v)?.allowedValues ?? []).map((n) => ({ value: String(n), label: String(n) })),
      helperText: (v) => {
        const rule = matchingRule(v);
        return rule && !rule.allowedValues ? `ขั้นต่ำ ${rule.minQuantity} บาททอง` : undefined;
      },
    },
    {
      name: "pricePerGb965",
      label: "ราคาต่อบาททอง 96.5%",
      kind: "number",
      required: true,
    },
    {
      name: "pricePerGb999",
      label: "ราคาต่อบาททอง 99.9%",
      kind: "number",
      required: true,
      helperText: (v) =>
        matchingRule(v)?.percent === 99.9
          ? "ราคานี้ใช้คำนวณยอดรวมของรายการนี้"
          : "คำนวณจากราคา 96.5% × (99.9/96.5) — แก้ไขได้",
    },
    {
      name: "notes",
      label: "หมายเหตุ",
      kind: "multiline",
    },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const rule = matchingRule(values);
    const payload = {
      supplierId: values.supplierId,
      purityId: values.purityId,
      brandId: rule?.percent === 99.9 ? undefined : values.brandId || undefined,
      productTypeId: values.productTypeId,
      weight: Number(values.weight),
      pricePerGb965: Number(values.pricePerGb965),
      pricePerGb999: Number(values.pricePerGb999),
      notes: values.notes || undefined,
    };

    const parsed = createWholeBuySchema.safeParse(payload);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setFieldError(null);

    createTransaction.mutate(parsed.data, {
      onSuccess: () => {
        showToast("สร้างรายการซื้อส่งแล้ว");
        navigate("/wholesale-buy");
      },
      onError: (err) => setSubmitError(err instanceof Error ? err.message : "สร้างรายการไม่สำเร็จ"),
    });
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h2" sx={{ mb: 3 }}>
        สร้างรายการซื้อส่ง
      </Typography>
      <Card>
        <CardContent>
          <Box component="form" onSubmit={handleSubmit} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {getVisibleFields(fields, values).map((field) => (
              <DynamicFormField key={String(field.name)} field={field} values={values} onChange={handleChange} />
            ))}

            {fieldError && <Alert severity="error">{fieldError}</Alert>}
            {submitError && <Alert severity="error">{submitError}</Alert>}

            <Button type="submit" disabled={createTransaction.isPending}>
              {createTransaction.isPending ? "กำลังบันทึก…" : "สร้างรายการ"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
