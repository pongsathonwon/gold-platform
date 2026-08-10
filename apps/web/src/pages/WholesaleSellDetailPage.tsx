import { useState } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import {
  Container, Typography, Card, CardContent, Box, Chip, Button, Alert, CircularProgress,
  Table, TableBody, TableCell, TableRow, TableHead, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Divider, Stack, MenuItem,
} from "@mui/material";
import {
  RETURN_REASONS, returnReasonLabel, type ReturnReasonValue, type WholeSellStatusValue,
} from "@gold-platform/types";
import { useWholesaleSellDetail } from "../hooks/useWholesaleSell";
import { useAdvanceWholesaleSellStatus } from "../hooks/useWholesaleSellMutations";
import { useProductTypes, useSuppliers } from "../hooks/useMasterData";
import { useToast } from "../components/ToastContext";
import { formatNumber, formatWeight, nextStatuses, requiresNote, statusColor, statusLabel } from "../utils/wholeSellStatus";

// Packing and shipping are two separate operator actions. They used to be fused behind one
// button, copied from the buy side by symmetry rather than from how the floor works: receiving
// and stocking really are one moment, but a packed box waits for a courier. Leaving PACKED as a
// state to rest in is what makes "ready to ship" a list somebody can work.
type PendingAction = WholeSellStatusValue;

export function WholesaleSellDetailPage() {
  const { id = "" } = useParams();
  const { showToast } = useToast();
  const { data, isPending, isError, error } = useWholesaleSellDetail(id);
  const { data: suppliersRes } = useSuppliers();
  const { data: productTypesRes } = useProductTypes();

  const advance = useAdvanceWholesaleSellStatus(id);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [note, setNote] = useState("");
  const [actualWeight, setActualWeight] = useState("");
  const [settledAmount, setSettledAmount] = useState("");
  const [returnReason, setReturnReason] = useState<ReturnReasonValue | "">("");
  const [actionError, setActionError] = useState<string | null>(null);

  if (isPending) return <Container sx={{ py: 4 }}><CircularProgress /></Container>;
  if (isError || !data) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="error">{error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"}</Alert>
      </Container>
    );
  }

  const { transaction: t, statuses } = data;
  const is999 = t.purityId === "999";
  const weightUnit = is999 ? "กรัม" : "บาท";
  const supplierName = suppliersRes?.data.find((s) => s.id === t.supplierId)?.supplierName ?? t.supplierId;
  const productTypeName = productTypesRes?.data.find((p) => p.id === t.productTypeId)?.productType ?? t.productTypeId;

  const moves = nextStatuses(t.currentStatus);
  // DISPUTED is the only move that carries a weight, and it is the *buyer's* number — the whole
  // point is that it disagrees with ours. Packing records nothing: we boxed our own gold from our
  // own vault, so the agreed weight is what left and there is no second measurement to capture.
  const contestsWeight = pending === "DISPUTED";
  const collectsSettledAmount = pending === "PAID";
  const collectsReturnReason = pending === "RETURNED";
  const noteRequired = pending !== null && requiresNote(pending);
  const agreedInInputUnit = is999 ? t.weightGm / 1000 : t.weightGb;
  const inputUnitLabel = is999 ? "kg" : "บาท";

  function closeDialog() {
    setPending(null);
    setNote("");
    setActualWeight("");
    setSettledAmount("");
    setReturnReason("");
    setActionError(null);
  }

  function submitAction() {
    if (pending === null) return;
    setActionError(null);

    const trimmedNote = note.trim();
    if (noteRequired && !trimmedNote) {
      setActionError("กรุณาระบุเหตุผล");
      return;
    }
    if (collectsReturnReason && !returnReason) {
      setActionError("กรุณาเลือกสาเหตุที่ตีกลับ");
      return;
    }

    const weight = actualWeight ? Number(actualWeight) : undefined;
    const settled = settledAmount ? Number(settledAmount) : undefined;

    const onSuccess = () => {
      showToast("อัปเดตสถานะแล้ว");
      closeDialog();
    };
    const onError = (err: unknown) =>
      setActionError(err instanceof Error ? err.message : "อัปเดตสถานะไม่สำเร็จ");

    advance.mutate(
      {
        toStatus: pending,
        ...(trimmedNote ? { note: trimmedNote } : {}),
        ...(contestsWeight && weight !== undefined ? { actualWeight: weight } : {}),
        ...(collectsSettledAmount && settled !== undefined ? { settledAmount: settled } : {}),
        ...(collectsReturnReason && returnReason ? { returnReason } : {}),
      },
      { onSuccess, onError },
    );
  }

  const rows: [string, React.ReactNode][] = [
    ["ผู้รับซื้อส่ง", supplierName],
    ["ประเภททองคำ", productTypeName],
    ["% ทอง", is999 ? "99.9%" : "96.5%"],
    ["ยี่ห้อ", t.brandId === "NA" ? "—" : t.brandId],
    ["น้ำหนักที่ตกลง", `${formatWeight(is999 ? t.weightGm : t.weightGb)} ${weightUnit}`],
    ["ราคาต่อบาททอง 96.5%", formatNumber(t.pricePerGb965)],
    ["ราคาต่อบาททอง 99.9%", formatNumber(t.pricePerGb999)],
    ["ยอดรวมที่ตกลง", formatNumber(t.totalAmount)],
    ["งวดชำระ", t.settlementPeriod],
    ["บันทึกโดย", `${t.recordedBy} · ${new Date(t.recordedAt).toLocaleString("th-TH")}`],
  ];

  // editable only while CREATED, and the nightly sweep is what ends that — so the deadline is
  // worth showing on exactly the transactions it still applies to
  if (t.currentStatus === "CREATED") {
    rows.push(["ยืนยันอัตโนมัติ", new Date(t.confirmDueAt).toLocaleString("th-TH")]);
  }

  if (t.settledAmount !== null) {
    const variance = t.settledAmount - t.totalAmount;
    rows.push([
      "ยอดที่รับจริง",
      <Box component="span">
        {formatNumber(t.settledAmount)}
        <Typography component="span" variant="caption" color={variance < 0 ? "error.main" : "success.main"} sx={{ ml: 1 }}>
          ({variance > 0 ? "+" : ""}{formatNumber(variance)} เทียบกับที่ตกลง)
        </Typography>
      </Box>,
    ]);
  }

  if (t.returnReason !== null) {
    rows.push(["สาเหตุที่ตีกลับ", returnReasonLabel(t.returnReason)]);
  }

  // only ever populated by a DISPUTED move — packing records no weight of its own, since we boxed
  // our own gold and the agreed figure is what left
  if (t.actualWeightGb !== null) {
    const variance = t.actualWeightGb - t.weightGb;
    rows.push([
      "น้ำหนักที่ผู้ซื้อชั่งได้",
      <Box component="span">
        {formatWeight(is999 ? (t.actualWeightGm ?? 0) : t.actualWeightGb)} {weightUnit}
        {variance !== 0 && (
          <Typography component="span" variant="caption" color={variance < 0 ? "error.main" : "success.main"} sx={{ ml: 1 }}>
            ({variance > 0 ? "+" : ""}{formatWeight(variance)} บาท เทียบกับที่ตกลง)
          </Typography>
        )}
      </Box>,
    ]);
    rows.push(["ยอดรวมตามจริง", formatNumber(t.actualAmount ?? 0)]);
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <Typography variant="h2" sx={{ flexGrow: 1 }}>
          รายการขายส่ง
        </Typography>
        <Chip label={statusLabel(t.currentStatus)} color={statusColor(t.currentStatus)} />
        <Button component={RouterLink} to="/wholesale-sell" variant="text">
          กลับ
        </Button>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Table size="small">
            <TableBody>
              {rows.map(([label, value]) => (
                <TableRow key={label}>
                  <TableCell sx={{ width: 220, color: "text.secondary" }}>{label}</TableCell>
                  <TableCell>{value}</TableCell>
                </TableRow>
              ))}
              {t.notes && (
                <TableRow>
                  <TableCell sx={{ color: "text.secondary" }}>หมายเหตุ</TableCell>
                  <TableCell>{t.notes}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {moves.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h5" sx={{ mb: 2 }}>
              ดำเนินการต่อ
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              {moves.map((s) => (
                <Button
                  key={s}
                  variant={requiresNote(s) ? "outlined" : "contained"}
                  color={requiresNote(s) ? "error" : "primary"}
                  onClick={() => setPending(s)}
                >
                  {statusLabel(s)}
                </Button>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <Typography variant="h5" sx={{ mb: 2 }}>
            ประวัติสถานะ
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>สถานะ</TableCell>
                <TableCell>หมายเหตุ</TableCell>
                <TableCell>โดย</TableCell>
                <TableCell>เวลา</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {statuses.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Chip size="small" label={statusLabel(s.status)} color={statusColor(s.status)} />
                  </TableCell>
                  <TableCell>{s.note ?? "—"}</TableCell>
                  <TableCell>{s.createdBy}</TableCell>
                  <TableCell>{new Date(s.createdAt).toLocaleString("th-TH")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={pending !== null} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>เปลี่ยนสถานะเป็น {pending ? statusLabel(pending) : ""}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            {contestsWeight && (
              <>
                <TextField
                  label={`น้ำหนักที่ผู้ซื้อชั่งได้ (${inputUnitLabel})`}
                  type="number"
                  value={actualWeight}
                  onChange={(e) => setActualWeight(e.target.value)}
                  helperText={`น้ำหนักตามที่ผู้ซื้อแจ้ง เทียบกับที่ตกลง ${formatWeight(agreedInInputUnit)} ${inputUnitLabel} — บันทึกไว้เป็นหลักฐาน ไม่กระทบสต๊อก`}
                />
                <Divider />
              </>
            )}
            {collectsSettledAmount && (
              <>
                <TextField
                  label="ยอดที่รับจริง"
                  type="number"
                  value={settledAmount}
                  onChange={(e) => setSettledAmount(e.target.value)}
                  helperText={`เว้นว่างไว้หากตรงกับยอดที่ตกลง (${formatNumber(t.totalAmount)}) — กรอกเฉพาะเมื่อรับเงินไม่เท่ากับที่ตกลงและปิดรายการเลย`}
                />
                <Divider />
              </>
            )}
            {collectsReturnReason && (
              <>
                <TextField
                  select
                  label="สาเหตุที่ตีกลับ (จำเป็น)"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value as ReturnReasonValue)}
                  required
                  helperText="บันทึกเป็นข้อมูลสรุปได้ ต่างจากหมายเหตุที่เป็นข้อความอิสระ"
                >
                  {RETURN_REASONS.map((r) => (
                    <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
                  ))}
                </TextField>
                <Divider />
              </>
            )}
            <TextField
              label={noteRequired ? "เหตุผล (จำเป็น)" : "หมายเหตุ"}
              multiline
              minRows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required={noteRequired}
            />
            {actionError && <Alert severity="error">{actionError}</Alert>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={closeDialog}>
            ยกเลิก
          </Button>
          <Button onClick={submitAction} disabled={advance.isPending}>
            ยืนยัน
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
