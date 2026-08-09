import { useState } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import {
  Container, Typography, Card, CardContent, Box, Chip, Button, Alert, CircularProgress,
  Table, TableBody, TableCell, TableRow, TableHead, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Divider, Stack,
} from "@mui/material";
import type { WholeSellStatusValue } from "@gold-platform/types";
import { useWholesaleSellDetail } from "../hooks/useWholesaleSell";
import { useAdvanceWholesaleSellStatus, usePackShipWholesaleSell } from "../hooks/useWholesaleSellMutations";
import { useProductTypes, useSuppliers } from "../hooks/useMasterData";
import { useToast } from "../components/ToastContext";
import { formatNumber, formatWeight, nextStatuses, requiresNote, statusColor, statusLabel } from "../utils/wholeSellStatus";

// the combined pack+ship action, offered alongside the plain transitions
const PACK_SHIP = "PACK_SHIP" as const;
type PendingAction = WholeSellStatusValue | typeof PACK_SHIP;

export function WholesaleSellDetailPage() {
  const { id = "" } = useParams();
  const { showToast } = useToast();
  const { data, isPending, isError, error } = useWholesaleSellDetail(id);
  const { data: suppliersRes } = useSuppliers();
  const { data: productTypesRes } = useProductTypes();

  const advance = useAdvanceWholesaleSellStatus(id);
  const packShip = usePackShipWholesaleSell(id);

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
  // Two moves carry a weight, and they mean opposite things.
  //   PACKED / PACK_SHIP — what we pulled from the vault. It must equal the agreement; the API
  //                        rejects anything else so the operator re-packs rather than recording
  //                        a deal we did not fulfil.
  //   DISPUTED           — what the *buyer* says they weighed. Free-form: it is their number,
  //                        and the whole point is that it disagrees with ours.
  const packsWeight = pending === "PACKED" || pending === PACK_SHIP;
  const contestsWeight = pending === "DISPUTED";
  const collectsWeight = packsWeight || contestsWeight;
  const noteRequired = pending !== null && pending !== PACK_SHIP && requiresNote(pending);
  const agreedInInputUnit = is999 ? t.weightGm / 1000 : t.weightGb;
  const inputUnitLabel = is999 ? "kg" : "บาท";

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

    const weight = actualWeight ? Number(actualWeight) : undefined;

    const onSuccess = () => {
      showToast("อัปเดตสถานะแล้ว");
      closeDialog();
    };
    // a packed weight that does not match comes back 422 rather than as a diverted status, so
    // the message belongs in the dialog where the operator can fix the number and retry
    const onError = (err: unknown) =>
      setActionError(err instanceof Error ? err.message : "อัปเดตสถานะไม่สำเร็จ");

    if (pending === PACK_SHIP) {
      packShip.mutate(
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

  // only ever populated by a DISPUTED move — the packed weight always equals the agreement,
  // because the API refuses to pack anything else
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
              {/* one operator action today: the people who pull the gold are the people who hand
                  it to the courier. Both status entries are still written server-side. */}
              {t.currentStatus === "CONFIRMED" && (
                <Button onClick={() => setPending(PACK_SHIP)}>เบิกทองแพ็คและส่งออก</Button>
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
          {pending === PACK_SHIP ? "เบิกทองแพ็คและส่งออก" : `เปลี่ยนสถานะเป็น ${pending ? statusLabel(pending) : ""}`}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            {collectsWeight && (
              <>
                <TextField
                  label={
                    packsWeight
                      ? `น้ำหนักที่เบิกแพ็ค (${inputUnitLabel})`
                      : `น้ำหนักที่ผู้ซื้อชั่งได้ (${inputUnitLabel})`
                  }
                  type="number"
                  value={actualWeight}
                  onChange={(e) => setActualWeight(e.target.value)}
                  helperText={
                    packsWeight
                      ? `ต้องเท่ากับที่ตกลง (${formatWeight(agreedInInputUnit)} ${inputUnitLabel}) — ถ้าไม่เท่า ระบบจะไม่ตัดสต๊อกและให้แพ็คใหม่ เว้นว่างไว้ได้หากตรงกันอยู่แล้ว`
                      : `น้ำหนักตามที่ผู้ซื้อแจ้ง เทียบกับที่ตกลง ${formatWeight(agreedInInputUnit)} ${inputUnitLabel} — บันทึกไว้เป็นหลักฐาน ไม่กระทบสต๊อก`
                  }
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
          <Button onClick={submitAction} disabled={advance.isPending || packShip.isPending}>
            ยืนยัน
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
