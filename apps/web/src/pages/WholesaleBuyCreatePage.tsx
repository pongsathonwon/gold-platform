import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container, Typography, Card, CardContent, Button, Box, Alert,
} from "@mui/material";
import { createWholeBuySchema, derivePricePerGb999, todayBusinessDate } from "@gold-platform/types";
import { useProductTypePurities, useProductTypes, useSuppliers } from "../hooks/useMasterData";
import { useCreateWholesaleBuy } from "../hooks/useWholesaleBuyMutations";
import { useToast } from "../components/ToastContext";
import { useDynamicForm } from "../forms/useDynamicForm";
import { DynamicFormField } from "../forms/DynamicFormField";
import { getVisibleFields, type FieldConfig } from "../forms/types";

// No brand field. An order cannot know what stamp will turn up — that is recorded when the
// delivery is put into stock, against the pools it actually lands in.
interface BuyValues extends Record<string, string> {
  transactionDate: string;
  supplierId: string;
  productTypeId: string;
  purityId: string;
  weight: string;
  pricePerGb965: string;
  notes: string;
}

// The date defaults to today, so a shop working in real time never touches it. It is editable
// because on day one the operator is writing up orders that already happened — and the value
// they pick is what decides the settlement period, not the moment they hit save.
const initialValues: BuyValues = {
  transactionDate: todayBusinessDate(),
  supplierId: "",
  productTypeId: "",
  purityId: "",
  weight: "",
  pricePerGb965: "",
  notes: "",
};

// when an upstream field changes, downstream selections it no longer governs are reset
const RESET_ON_CHANGE: Record<string, (keyof BuyValues)[]> = {
  productTypeId: ["purityId", "weight"],
  purityId: ["weight"],
};

export function WholesaleBuyCreatePage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { data: suppliersRes } = useSuppliers();
  const { data: productTypesRes } = useProductTypes();
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
  }

  const fields: FieldConfig<BuyValues>[] = [
    {
      name: "transactionDate",
      label: "วันที่ทำรายการ",
      kind: "date",
      required: true,
      helperText: (v) =>
        v.transactionDate && v.transactionDate !== todayBusinessDate()
          ? "บันทึกย้อนหลัง — รายการนี้จะถูกนับในงวดของวันที่เลือก"
          : undefined,
    },
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
      // One price only. The 99.9% quote is arithmetic off this one, so the server derives it —
      // two separately-typed prices could disagree, a derived one cannot. For a 99.9% order the
      // helper text shows what it works out to, so the operator can sanity-check the conversion.
      name: "pricePerGb965",
      label: "ราคาต่อบาททอง (96.5%)",
      kind: "number",
      required: true,
      helperText: (v) => {
        const base = Number(v.pricePerGb965);
        if (matchingRule(v)?.percent !== 99.9 || !(base > 0)) return undefined;
        return `ทอง 99.9% = ${derivePricePerGb999(base).toLocaleString("en-US")} บาท/บาททอง`;
      },
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

    const payload = {
      supplierId: values.supplierId,
      purityId: values.purityId,
      productTypeId: values.productTypeId,
      weight: Number(values.weight),
      pricePerGb965: Number(values.pricePerGb965),
      transactionDate: values.transactionDate,
      notes: values.notes || undefined,
    };

    const parsed = createWholeBuySchema.safeParse(payload);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
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
