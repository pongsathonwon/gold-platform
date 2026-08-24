import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container, Typography, Card, CardContent, Button, Box, Alert,
} from "@mui/material";
import { todayBusinessDate } from "@gold-platform/types";
import { liveBranches, useBranches, useProductTypePurities, useProductTypes } from "../../hooks/useMasterData";
import { useToast } from "../../components/ToastContext";
import { useDynamicForm } from "../../forms/useDynamicForm";
import { DynamicFormField } from "../../forms/DynamicFormField";
import { getVisibleFields, type FieldConfig } from "../../forms/types";
import { RETAIL_BUY_UI, RETAIL_SELL_UI, type RetailUiConfig } from "./retailUi";

interface RetailValues extends Record<string, string> {
  transactionDate: string;
  branchCode: string;
  productTypeId: string;
  purityId: string;
  weight: string;
  pricePerGb: string;
  operationFee: string;
  notes: string;
}

const initialValues: RetailValues = {
  transactionDate: todayBusinessDate(),
  branchCode: "",
  productTypeId: "",
  purityId: "",
  weight: "",
  pricePerGb: "",
  operationFee: "",
  notes: "",
};

// when an upstream field changes, downstream selections it no longer governs are reset
const RESET_ON_CHANGE: Record<string, (keyof RetailValues)[]> = {
  productTypeId: ["purityId", "weight"],
  purityId: ["weight"],
};

function RetailCreatePage({ config }: { config: RetailUiConfig }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { data: branchesRes } = useBranches();
  const { data: productTypesRes } = useProductTypes();
  const createTransaction = config.useCreate();

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { values, setValue } = useDynamicForm(initialValues);
  const { data: purityRulesRes } = useProductTypePurities(values.productTypeId);
  const purityRules = purityRulesRes?.data ?? [];
  const matchingRule = (v: RetailValues) => purityRules.find((p) => p.purityId === v.purityId);

  function handleChange(name: keyof RetailValues, value: string) {
    setValue(name, value);
    RESET_ON_CHANGE[name as string]?.forEach((dep) => setValue(dep, ""));
  }

  const fields: FieldConfig<RetailValues>[] = [
    {
      // Defaults to today, and is the field that matters most here: retail is written up after the
      // fact, so a whole week can be entered on one afternoon. The picked day decides which
      // settlement period the trade lands in.
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
      // The only party to the trade the shop can name. A walk-in customer is not an entity here,
      // and branch is the cut a manager would actually take — which shop is trading well.
      // Retired branches are filtered out of the options but still resolve on existing records.
      name: "branchCode",
      label: "สาขา",
      kind: "select",
      required: true,
      getOptions: () =>
        liveBranches(branchesRes?.data).map((b) => ({ value: b.branchCode, label: b.branchName })),
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
      /**
       * Always a free number, never the wholesale forms' select-from-`allowedValues`, and with no
       * minimum or step in the helper text. Those rules describe what can be *ordered* from a
       * supplier; what crossed the counter weighed what it weighed, and the server uses the
       * measured resolver here for the same reason.
       */
      name: "weight",
      label: (v) => (matchingRule(v)?.inputUnit === "kg" ? "น้ำหนัก (กก.)" : "น้ำหนัก (บาททอง)"),
      kind: "number",
      required: true,
      isVisible: (v) => !!v.purityId,
    },
    {
      // One price, for both purities: retail deals in gold baht either way, so there is no 96.5/99.9
      // quote to derive the way the wholesale forms do.
      name: "pricePerGb",
      label: config.priceLabel,
      kind: "number",
      required: true,
    },
    {
      // Captured separately and kept out of totalAmount, so the average price per gold baht reads
      // spread rather than fee — and so the figure stays comparable with wholesale, which has none.
      name: "operationFee",
      label: config.feeLabel,
      kind: "number",
      helperText: () => config.feeHelper,
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
      branchCode: values.branchCode,
      purityId: values.purityId,
      productTypeId: values.productTypeId,
      weight: Number(values.weight),
      pricePerGb: Number(values.pricePerGb),
      // an untouched fee field means none was charged, which is not the same as a fee of zero
      operationFee: values.operationFee === "" ? undefined : Number(values.operationFee),
      transactionDate: values.transactionDate,
      notes: values.notes || undefined,
    };

    const parsed = config.createSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
      return;
    }
    setFieldError(null);

    createTransaction.mutate(parsed.data, {
      onSuccess: () => {
        showToast(config.createdToast);
        navigate(config.basePath);
      },
      onError: (err) => setSubmitError(err instanceof Error ? err.message : "บันทึกรายการไม่สำเร็จ"),
    });
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h2" sx={{ mb: 3 }}>
        {config.createTitle}
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
              {createTransaction.isPending ? "กำลังบันทึก…" : config.createAction}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}

// Distinct component types per route — see the note in retailUi.ts on why this matters.
export const RetailBuyCreatePage = () => <RetailCreatePage config={RETAIL_BUY_UI} />;
export const RetailSellCreatePage = () => <RetailCreatePage config={RETAIL_SELL_UI} />;
