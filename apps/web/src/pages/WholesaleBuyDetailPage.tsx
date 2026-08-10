import { useState } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import {
  Container, Typography, Card, CardContent, Box, Chip, Button, Alert, CircularProgress,
  Table, TableBody, TableCell, TableRow, TableHead, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Divider, Stack, MenuItem,
} from "@mui/material";
import {
  RETURN_REASONS, returnReasonLabel, type ReturnReasonValue, type WholeBuyStatusValue,
} from "@gold-platform/types";
import { useWholesaleBuyDetail } from "../hooks/useWholesaleBuy";
import { useAdvanceWholesaleBuyStatus, useReceiveStockWholesaleBuy } from "../hooks/useWholesaleBuyMutations";
import { useProductTypes, useSuppliers } from "../hooks/useMasterData";
import { useToast } from "../components/ToastContext";
import { formatNumber, formatWeight, nextStatuses, requiresNote, statusColor, statusLabel } from "../utils/wholeBuyStatus";

// the combined receive+stock action, offered alongside the plain transitions
const RECEIVE_STOCK = "RECEIVE_STOCK" as const;
type PendingAction = WholeBuyStatusValue | typeof RECEIVE_STOCK;

export function WholesaleBuyDetailPage() {
  const { id = "" } = useParams();
  const { showToast } = useToast();
  const { data, isPending, isError, error } = useWholesaleBuyDetail(id);
  const { data: suppliersRes } = useSuppliers();
  const { data: productTypesRes } = useProductTypes();

  const advance = useAdvanceWholesaleBuyStatus(id);
  const receiveStock = useReceiveStockWholesaleBuy(id);

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
  // Accepting takes no weight — it means the delivery matched its document, so the only figure it
  // could hold is the one already on the order. DISPUTED is the one move where a weight is worth
  // typing, because a dispute is meaningless without the number being disputed.
  const contestsWeight = pending === "DISPUTED";
  const collectsSettledAmount = pending === "PAID";
  const collectsReturnReason = pending === "RETURNED";
  const noteRequired = pending !== null && pending !== RECEIVE_STOCK && requiresNote(pending);

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

    // Nothing diverts any more: the caller asks for a status and gets it. A delivery that failed
    // its check at the door is refused via ตีกลับผู้ขาย before custody transfers, rather than
    // being taken in and silently rerouted to รอตรวจสอบ.
    const onSuccess = () => {
      showToast("อัปเดตสถานะแล้ว");
      closeDialog();
    };
    const onError = (err: unknown) =>
      setActionError(err instanceof Error ? err.message : "อัปเดตสถานะไม่สำเร็จ");

    const weight = actualWeight ? Number(actualWeight) : undefined;
    const settled = settledAmount ? Number(settledAmount) : undefined;

    if (pending === RECEIVE_STOCK) {
      receiveStock.mutate(
        { ...(trimmedNote ? { note: trimmedNote } : {}) },
        { onSuccess, onError },
      );
      return;
    }

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
    ["ผู้ขายส่ง", supplierName],
    ["ประเภททองคำ", productTypeName],
    ["% ทอง", is999 ? "99.9%" : "96.5%"],
    ["ยี่ห้อ", t.brandId === "NA" ? "—" : t.brandId],
    ["น้ำหนักที่สั่ง", `${formatWeight(is999 ? t.weightGm : t.weightGb)} ${weightUnit}`],
    ["ราคาต่อบาททอง 96.5%", formatNumber(t.pricePerGb965)],
    ["ราคาต่อบาททอง 99.9%", formatNumber(t.pricePerGb999)],
    ["ยอดรวมที่สั่ง", formatNumber(t.totalAmount)],
    ["งวดชำระ", t.settlementPeriod],
    ["บันทึกโดย", `${t.recordedBy} · ${new Date(t.recordedAt).toLocaleString("th-TH")}`],
  ];

  // editable only while CREATED, and the nightly job is what ends that — so the deadline is
  // worth showing on exactly the transactions it still applies to
  if (t.currentStatus === "CREATED") {
    rows.push(["ยืนยันอัตโนมัติ", new Date(t.confirmDueAt).toLocaleString("th-TH")]);
  }

  if (t.settledAmount !== null) {
    const variance = t.settledAmount - t.totalAmount;
    rows.push([
      "ยอดที่จ่ายจริง",
      <Box component="span">
        {formatNumber(t.settledAmount)}
        <Typography component="span" variant="caption" color={variance > 0 ? "error.main" : "success.main"} sx={{ ml: 1 }}>
          ({variance > 0 ? "+" : ""}{formatNumber(variance)} เทียบกับที่สั่ง)
        </Typography>
      </Box>,
    ]);
  }

  if (t.returnReason !== null) {
    rows.push(["สาเหตุที่ตีกลับ", returnReasonLabel(t.returnReason)]);
  }

  // only ever populated by a DISPUTED move — accepting means the delivery matched its document,
  // and acceptance clears any figure a previous dispute recorded
  if (t.actualWeightGb !== null) {
    const orderedGb = t.weightGb;
    const variance = t.actualWeightGb - orderedGb;
    rows.push([
      "น้ำหนักที่ชั่งได้",
      <Box component="span">
        {formatWeight(is999 ? (t.actualWeightGm ?? 0) : t.actualWeightGb)} {weightUnit}
        {variance !== 0 && (
          <Typography component="span" variant="caption" color={variance < 0 ? "error.main" : "success.main"} sx={{ ml: 1 }}>
            ({variance > 0 ? "+" : ""}{formatWeight(variance)} บาท เทียบกับที่สั่ง)
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
          รายการซื้อส่ง
        </Typography>
        <Chip label={statusLabel(t.currentStatus)} color={statusColor(t.currentStatus)} />
        <Button component={RouterLink} to="/wholesale-buy" variant="text">
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
              {/* one operator action: the person who accepts a delivery is the person who puts it
                  away. Both status entries are still written server-side, so splitting it later
                  loses no history. */}
              {t.currentStatus === "PAID" && (
                <Button onClick={() => setPending(RECEIVE_STOCK)}>รับของและเข้าสต๊อก</Button>
              )}
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
        <DialogTitle>
          {pending === RECEIVE_STOCK ? "รับของและเข้าสต๊อก" : `เปลี่ยนสถานะเป็น ${pending ? statusLabel(pending) : ""}`}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            {pending === RECEIVE_STOCK && (
              <Alert severity="info">
                เข้าสต๊อกตามน้ำหนักที่สั่ง {formatWeight(is999 ? t.weightGm / 1000 : t.weightGb)}{" "}
                {is999 ? "kg" : "บาท"} — หากของไม่ตรงกับเอกสาร ให้ปฏิเสธด้วย "ตีกลับผู้ขาย" แทน
              </Alert>
            )}
            {contestsWeight && (
              <>
                <TextField
                  label={`น้ำหนักที่ชั่งได้ (${is999 ? "kg" : "บาท"})`}
                  type="number"
                  value={actualWeight}
                  onChange={(e) => setActualWeight(e.target.value)}
                  helperText={`เทียบกับที่สั่ง ${formatWeight(is999 ? t.weightGm / 1000 : t.weightGb)} ${is999 ? "kg" : "บาท"} — บันทึกไว้เป็นหลักฐาน ไม่เข้าสต๊อก`}
                />
                <Divider />
              </>
            )}
            {collectsSettledAmount && (
              <>
                <TextField
                  label="ยอดที่จ่ายจริง"
                  type="number"
                  value={settledAmount}
                  onChange={(e) => setSettledAmount(e.target.value)}
                  helperText={`เว้นว่างไว้หากตรงกับยอดที่สั่ง (${formatNumber(t.totalAmount)}) — กรอกเฉพาะเมื่อจ่ายไม่เท่ากับที่สั่งและปิดรายการเลย`}
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
          <Button onClick={submitAction} disabled={advance.isPending || receiveStock.isPending}>
            ยืนยัน
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
