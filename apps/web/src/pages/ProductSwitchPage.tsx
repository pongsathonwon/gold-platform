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
import { productSwitchSchema } from "@gold-platform/types";
import { useBrands, useProductTypePurities, useProductTypes } from "../hooks/useMasterData";
import { useProductSwitch } from "../hooks/useInventoryMutations";
import { useToast } from "../components/ToastContext";
import { useDynamicForm } from "../forms/useDynamicForm";
import { DynamicFormField } from "../forms/DynamicFormField";
import { getVisibleFields, type FieldConfig } from "../forms/types";

// 96.5% is the only purity a switch applies to, so it is not a field. 99.9% pools are keyed by
// origin and carry the 'NA' sentinel as their brand — there is no stamp to move weight between —
// so offering the purity would only let an operator pick the one value the form cannot act on.
// The purity id still comes from the product type's own pairing, never from a literal here.
const SWITCHABLE_PERCENT = 96.5;

interface SwitchValues extends Record<string, string> {
  productTypeId: string;
  fromBrandId: string;
  toBrandId: string;
  weight: string;
  notes: string;
}

const initialValues: SwitchValues = {
  productTypeId: "",
  fromBrandId: "",
  toBrandId: "",
  weight: "",
  notes: "",
};

// when an upstream field changes, downstream selections it no longer governs are reset
const RESET_ON_CHANGE: Record<string, (keyof SwitchValues)[]> = {
  productTypeId: ["weight", "fromBrandId", "toBrandId"],
};

export function ProductSwitchPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { data: productTypesRes } = useProductTypes();
  const { data: brandsRes } = useBrands();
  const productSwitch = useProductSwitch();

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { values, setValue } = useDynamicForm(initialValues);
  const { data: purityRulesRes } = useProductTypePurities(values.productTypeId);
  const rule = (purityRulesRes?.data ?? []).find((p) => p.percent === SWITCHABLE_PERCENT);
  // a product type with no 96.5% pairing has nothing this form can move
  const unswitchable = !!values.productTypeId && !!purityRulesRes && !rule;

  // a switch runs in either direction, so both ends draw from the same active-brand list; each
  // select drops whatever the other one already holds, since a pool cannot switch into itself
  const activeBrands = (brandsRes?.data ?? []).filter((b) => b.active);
  const brandOptions = (exclude: string) =>
    activeBrands.filter((b) => b.id !== exclude).map((b) => ({ value: b.id, label: b.brand }));

  // With exactly two brands registered — NA and ฮั่วเซ่งเฮง today — naming the source names the
  // destination: there is nowhere else the weight could go. So the second select is derived rather
  // than asked for, and the direction shows in the source field's helper text. Register a third
  // brand and the destination stops being implied, so the select reappears with no code change.
  const isImplied = activeBrands.length === 2;
  const impliedTo = (fromBrandId: string) =>
    isImplied ? (activeBrands.find((b) => b.id !== fromBrandId)?.id ?? "") : "";

  function handleChange(name: keyof SwitchValues, value: string) {
    setValue(name, value);
    RESET_ON_CHANGE[name as string]?.forEach((dep) => setValue(dep, ""));
    if (name === "fromBrandId" && isImplied) setValue("toBrandId", impliedTo(value));
  }

  const fields: FieldConfig<SwitchValues>[] = [
    {
      name: "productTypeId",
      label: "ประเภททองคำ",
      kind: "select",
      required: true,
      getOptions: () => (productTypesRes?.data ?? []).map((pt) => ({ value: pt.id, label: pt.productType })),
    },
    {
      name: "fromBrandId",
      label: "ยี่ห้อต้นทาง",
      kind: "select",
      required: true,
      // nothing to exclude when the destination is derived — excluding it would strand the operator
      // on their first pick, since the derived value is exactly the brand they'd want to switch to
      getOptions: (v) => brandOptions(isImplied ? "" : v.toBrandId),
      helperText: (v) => {
        if (!isImplied || !v.fromBrandId) return undefined;
        const to = activeBrands.find((b) => b.id === impliedTo(v.fromBrandId));
        return to ? `ปรับเป็น ${to.brand}` : undefined;
      },
    },
    {
      name: "toBrandId",
      label: "ยี่ห้อปลายทาง",
      kind: "select",
      required: true,
      isVisible: () => !isImplied,
      getOptions: (v) => brandOptions(v.fromBrandId),
    },
    {
      // 96.5% is always entered in gold baht, so there is no unit branch left to take
      name: "weight",
      label: "น้ำหนัก (บาท)",
      kind: () => (rule?.allowedValues ? "select" : "number"),
      required: true,
      isVisible: () => !!rule,
      getOptions: () => (rule?.allowedValues ?? []).map((n) => ({ value: String(n), label: String(n) })),
      helperText: () => (rule && !rule.allowedValues ? `ขั้นต่ำ ${rule.minQuantity} บาททอง` : undefined),
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

    if (!rule) {
      setFieldError("ประเภททองคำนี้ไม่มีทอง 96.5%");
      return;
    }

    const payload = {
      purityId: rule.purityId,
      productTypeId: values.productTypeId,
      fromBrandId: values.fromBrandId,
      toBrandId: values.toBrandId || impliedTo(values.fromBrandId),
      weight: Number(values.weight),
      notes: values.notes || undefined,
    };

    const parsed = productSwitchSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
      return;
    }
    setFieldError(null);

    productSwitch.mutate(parsed.data, {
      onSuccess: () => {
        showToast("ปรับยี่ห้อทองคำแท่งเรียบร้อย");
        navigate("/inventory");
      },
      onError: (err) => setSubmitError(err instanceof Error ? err.message : "ปรับยี่ห้อไม่สำเร็จ"),
    });
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h2">ปรับยี่ห้อทองคำแท่ง</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        เฉพาะทอง 96.5%
      </Typography>
      <Card>
        <CardContent>
          <Box component="form" onSubmit={handleSubmit} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {getVisibleFields(fields, values).map((field) => (
              <DynamicFormField key={String(field.name)} field={field} values={values} onChange={handleChange} />
            ))}

            {unswitchable && (
              <Alert severity="info">ประเภททองคำนี้ไม่มีทอง 96.5% — ปรับยี่ห้อได้เฉพาะทอง 96.5%</Alert>
            )}
            {fieldError && <Alert severity="error">{fieldError}</Alert>}
            {submitError && <Alert severity="error">{submitError}</Alert>}

            <Button type="submit" disabled={productSwitch.isPending || unswitchable}>
              {productSwitch.isPending ? "กำลังบันทึก…" : "บันทึก"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
