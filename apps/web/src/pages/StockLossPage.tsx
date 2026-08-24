import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Typography,
  Card,
  CardContent,
  Button,
  Box,
  Alert,
} from "@mui/material";
import { stockLossSchema, todayBusinessDate, LOSS_TRANSACTION_TYPES } from "@gold-platform/types";
import { useBrands, useProductTypePurities, useProductTypes } from "../hooks/useMasterData";
import { useStockLoss } from "../hooks/useInventoryMutations";
import { useToast } from "../components/ToastContext";
import { useDynamicForm } from "../forms/useDynamicForm";
import { DynamicFormField } from "../forms/DynamicFormField";
import { getVisibleFields, type FieldConfig } from "../forms/types";

interface LossValues extends Record<string, string> {
  transactionDate: string;
  productTypeId: string;
  purityId: string;
  brandId: string;
  origin: string;
  weight: string;
  referenceType: string;
  notes: string;
}

// as on the gain form: today by default, backdatable to the day the loss belongs to, and the
// balance moves now regardless of which day that is
const initialValues: LossValues = {
  transactionDate: todayBusinessDate(),
  productTypeId: "",
  purityId: "",
  brandId: "",
  origin: "foreign",
  weight: "",
  referenceType: LOSS_TRANSACTION_TYPES[0].value,
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
    // origin is not a field any more — it is always "foreign" here — but it stays in the reset
    // list so it is restored to that default rather than blanked
    RESET_ON_CHANGE[name as string]?.forEach((dep) => setValue(dep, dep === "origin" ? "foreign" : ""));
  }

  const fields: FieldConfig<LossValues>[] = [
    {
      name: "transactionDate",
      label: "วันที่ทำรายการ",
      kind: "date",
      required: true,
      helperText: (v) =>
        v.transactionDate && v.transactionDate !== todayBusinessDate()
          ? "บันทึกย้อนหลัง — สต๊อกจะลดทันที แต่รายการจะแสดงตามวันที่เลือก"
          : undefined,
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
      name: "brandId",
      label: "ยี่ห้อ",
      kind: "select",
      required: true,
      isVisible: (v) => matchingRule(v)?.percent !== 99.9,
      getOptions: () => (brandsRes?.data ?? []).filter((b) => b.active).map((b) => ({ value: b.id, label: b.brand })),
    },
    {
      name: "weight",
      label: (v) => (matchingRule(v)?.inputUnit === "kg" ? "น้ำหนัก (kg)" : "น้ำหนัก (บาท)"),
      kind: (v) => (matchingRule(v)?.allowedValues ? "select" : "number"),
      required: true,
      getOptions: (v) => (matchingRule(v)?.allowedValues ?? []).map((n) => ({ value: String(n), label: String(n) })),
      // The unit follows the pairing's own input unit, exactly as the label above does — this
      // said "บาททอง" for kilogram pairings, so a 1 kg minimum read as "ขั้นต่ำ 1 บาททอง".
      // The step is named too: for 96.5% gold bar the minimum alone does not tell an operator
      // that 7 is invalid, and finding that out from a rejected submit is a poor way to learn it.
      helperText: (v) => {
        const rule = matchingRule(v);
        if (!rule || rule.allowedValues) return undefined;
        const unit = rule.inputUnit === "kg" ? "กก." : "บาททอง";
        return rule.stepQuantity
          ? `ครั้งละ ${rule.stepQuantity} ${unit} (${rule.minQuantity}, ${rule.minQuantity + rule.stepQuantity}, ${rule.minQuantity + rule.stepQuantity * 2}, …)`
          : `ขั้นต่ำ ${rule.minQuantity} ${unit}`;
      },
    },
    {
      name: "referenceType",
      label: "ประเภทรายการ",
      kind: "select",
      required: true,
      getOptions: () => LOSS_TRANSACTION_TYPES.map((t) => ({ value: t.value, label: t.label })),
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
      purityId: values.purityId,
      brandId: rule?.percent === 99.9 ? undefined : values.brandId || undefined,
      // Always foreign. The domestic pool is smelted stock: only `smelting` creates it and only
      // `convert_out` may draw it down, so a manual adjustment must never name it. The form used
      // to offer it as a choice for 99.9%.
      origin: "foreign" as const,
      productTypeId: values.productTypeId,
      weight: Number(values.weight),
      referenceType: values.referenceType,
      transactionDate: values.transactionDate,
      notes: values.notes || undefined,
    };

    const parsed = stockLossSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
      return;
    }
    setFieldError(null);

    stockLoss.mutate(parsed.data, {
      onSuccess: () => {
        showToast("ปรับลดสต๊อกเรียบร้อย");
        navigate("/inventory");
      },
      onError: (err) => setSubmitError(err instanceof Error ? err.message : "ปรับลดสต๊อกไม่สำเร็จ"),
    });
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h2" sx={{ mb: 3 }}>
        ปรับลดทองคำแท่ง
      </Typography>
      <Card>
        <CardContent>
          <Box component="form" onSubmit={handleSubmit} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {getVisibleFields(fields, values).map((field) => (
              <DynamicFormField key={String(field.name)} field={field} values={values} onChange={handleChange} />
            ))}

            {fieldError && <Alert severity="error">{fieldError}</Alert>}
            {submitError && <Alert severity="error">{submitError}</Alert>}

            <Button type="submit" disabled={stockLoss.isPending}>
              {stockLoss.isPending ? "กำลังบันทึก…" : "บันทึก"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
