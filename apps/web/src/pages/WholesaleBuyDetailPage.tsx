import { useState } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import {
  Container, Typography, Card, CardContent, Box, Chip, Button, Alert, CircularProgress,
  Table, TableBody, TableCell, TableRow, TableHead, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Divider, Stack,
} from "@mui/material";
import type { WholeBuyStatusValue } from "@gold-platform/types";
import { useWholesaleBuyDetail } from "../hooks/useWholesaleBuy";
import { useAdvanceWholesaleBuyStatus, useReceiveCheckWholesaleBuy } from "../hooks/useWholesaleBuyMutations";
import { useProductTypes, useSuppliers } from "../hooks/useMasterData";
import { useToast } from "../components/ToastContext";
import { formatNumber, nextStatuses, requiresNote, statusColor, statusLabel } from "../utils/wholeBuyStatus";

// the combined receive+check action, offered alongside the plain transitions
const RECEIVE_CHECK = "RECEIVE_CHECK" as const;
type PendingAction = WholeBuyStatusValue | typeof RECEIVE_CHECK;

export function WholesaleBuyDetailPage() {
  const { id = "" } = useParams();
  const { showToast } = useToast();
  const { data, isPending, isError, error } = useWholesaleBuyDetail(id);
  const { data: suppliersRes } = useSuppliers();
  const { data: productTypesRes } = useProductTypes();

  const advance = useAdvanceWholesaleBuyStatus(id);
  const receiveCheck = useReceiveCheckWholesaleBuy(id);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [note, setNote] = useState("");
  const [actualWeight, setActualWeight] = useState("");
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
  // both actions in the dialog can carry a delivered weight, since both end at CHECKED
  const collectsWeight = pending === "CHECKED" || pending === RECEIVE_CHECK;
  const noteRequired = pending !== null && pending !== RECEIVE_CHECK && requiresNote(pending);

  function closeDialog() {
    setPending(null);
    setNote("");
    setActualWeight("");
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

    const onSuccess = () => {
      showToast("อัปเดตสถานะแล้ว");
      closeDialog();
    };
    const onError = (err: unknown) =>
      setActionError(err instanceof Error ? err.message : "อัปเดตสถานะไม่สำเร็จ");

    const weight = actualWeight ? Number(actualWeight) : undefined;

    if (pending === RECEIVE_CHECK) {
      receiveCheck.mutate(
        { ...(weight !== undefined ? { actualWeight: weight } : {}), ...(trimmedNote ? { note: trimmedNote } : {}) },
        { onSuccess, onError },
      );
      return;
    }

    advance.mutate(
      {
        toStatus: pending,
        ...(trimmedNote ? { note: trimmedNote } : {}),
        ...(collectsWeight && weight !== undefined ? { actualWeight: weight } : {}),
      },
      { onSuccess, onError },
    );
  }

  const rows: [string, React.ReactNode][] = [
    ["ผู้ขายส่ง", supplierName],
    ["ประเภททองคำ", productTypeName],
    ["% ทอง", is999 ? "99.9%" : "96.5%"],
    ["ยี่ห้อ", t.brandId === "NA" ? "—" : t.brandId],
    ["น้ำหนักที่สั่ง", `${formatNumber(is999 ? t.weightGm : t.weightGb)} ${weightUnit}`],
    ["ราคาต่อบาททอง 96.5%", formatNumber(t.pricePerGb965)],
    ["ราคาต่อบาททอง 99.9%", formatNumber(t.pricePerGb999)],
    ["ยอดรวมที่สั่ง", formatNumber(t.totalAmount)],
    ["งวดชำระ", t.settlementPeriod],
    ["บันทึกโดย", `${t.recordedBy} · ${new Date(t.recordedAt).toLocaleString("th-TH")}`],
    ["แก้ไขได้ถึง", new Date(t.confirmDueAt).toLocaleString("th-TH")],
  ];

  if (t.actualWeightGb !== null) {
    const orderedGb = t.weightGb;
    const variance = t.actualWeightGb - orderedGb;
    rows.push([
      "น้ำหนักที่รับจริง",
      <Box component="span">
        {formatNumber(is999 ? (t.actualWeightGm ?? 0) : t.actualWeightGb)} {weightUnit}
        {variance !== 0 && (
          <Typography component="span" variant="caption" color={variance < 0 ? "error.main" : "success.main"} sx={{ ml: 1 }}>
            ({variance > 0 ? "+" : ""}{formatNumber(variance)} บาท เทียบกับที่สั่ง)
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
              {/* one operator action today: receive and check together. Both status entries are
                  still written server-side, so splitting it later loses no history. */}
              {t.currentStatus === "PAID" && (
                <Button onClick={() => setPending(RECEIVE_CHECK)}>รับของและตรวจรับ</Button>
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
          {pending === RECEIVE_CHECK ? "รับของและตรวจรับ" : `เปลี่ยนสถานะเป็น ${pending ? statusLabel(pending) : ""}`}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            {collectsWeight && (
              <>
                <TextField
                  label={`น้ำหนักที่รับจริง (${is999 ? "kg" : "บาท"})`}
                  type="number"
                  value={actualWeight}
                  onChange={(e) => setActualWeight(e.target.value)}
                  helperText="เว้นว่างไว้หากตรงกับที่สั่ง — ยอดที่เข้าสต๊อกจะคิดตามน้ำหนักที่กรอก"
                />
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
          <Button onClick={submitAction} disabled={advance.isPending || receiveCheck.isPending}>
            ยืนยัน
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
