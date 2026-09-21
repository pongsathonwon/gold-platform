import { useState, type ReactNode } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Container, Typography, Card, CardContent, Table, TableBody, TableCell, TableRow,
  Chip, Box, Button, Alert, CircularProgress, TextField, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from "@mui/material";
import { businessDateOf } from "@gold-platform/types";
import { useBranches, useBrands, useProductTypes, usePurities } from "../../hooks/useMasterData";
import { useToast } from "../../components/ToastContext";
import { BrandSplitFields, toBrandSplit, type BrandSplitDraft } from "../../components/BrandSplitFields";
import { displayWeight, isInvestmentGrade, weightUnitLabel } from "../../utils/purityDisplay";
import {
  formatBusinessDate, formatNumber, formatWeight, statusColor,
} from "../../utils/retailStatus";
import { RETAIL_BUY_UI, RETAIL_SELL_UI, type RetailUiConfig } from "./retailUi";

function RetailDetailPage({ config }: { config: RetailUiConfig }) {
  const { id = "" } = useParams();
  const { showToast } = useToast();
  const { data, isPending, isError, error } = config.useDetail(id);
  const advance = config.useAdvance(id);

  const { data: branchesRes } = useBranches();
  const { data: productTypesRes } = useProductTypes();
  const { data: puritiesRes } = usePurities();
  const { data: brandsRes } = useBrands();

  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [brandSplit, setBrandSplit] = useState<BrandSplitDraft>({});

  if (isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (isError || !data) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="error">{error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"}</Alert>
      </Container>
    );
  }

  const t = data.transaction;
  const purity = puritiesRes?.data.find((p) => p.id === t.purityId);
  const branch = branchesRes?.data.find((b) => b.branchCode === t.branchCode);
  const productType = productTypesRes?.data.find((p) => p.id === t.productTypeId);

  // 99.9% is dealt in kilograms; showing its gold-baht equivalent would print a number nobody typed.
  // Which purity this is comes from master data, never from the id.
  const isKg = isInvestmentGrade(purity);
  const weightText = isKg
    ? `${formatWeight(t.weightGm / 1000)} กก.`
    : `${formatWeight(t.weightGb)} บาททอง`;
  const brandName = (brandId: string) => brandsRes?.data.find((b) => b.id === brandId)?.brand ?? brandId;

  // the two dates agreeing is the ordinary case and deserves no chrome; a gap between them is the
  // thing worth pointing at
  const backdated = businessDateOf(new Date(t.recordedAt)) !== t.transactionDate;

  const noteRequired = pendingStatus !== null && config.requiresNote(pendingStatus);
  // brand is recorded on the one move that puts gold on the books or takes it off — the same move
  // the server reads the split on, named once in the shared types so the two cannot drift
  const collectsBrandSplit = pendingStatus === config.inventoryStatus;

  function closeDialog() {
    setPendingStatus(null);
    setNote("");
    setBrandSplit({});
  }

  function handleAdvance() {
    if (!pendingStatus) return;
    // only the named lines travel — the fungible residual is the server's subtraction
    const split = toBrandSplit(brandSplit);
    advance.mutate(
      {
        toStatus: pendingStatus,
        note: note.trim() || undefined,
        ...(collectsBrandSplit && !isKg && split.length > 0 ? { brandSplit: split } : {}),
      },
      {
        onSuccess: () => {
          showToast(`เปลี่ยนสถานะเป็น ${config.statusLabel(pendingStatus)} แล้ว`);
          closeDialog();
        },
        onError: (err) => showToast(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ", "error"),
      },
    );
  }

  const rows: [string, ReactNode][] = [
    ["วันที่ทำรายการ", formatBusinessDate(t.transactionDate)],
    ["สาขา", branch?.branchName ?? t.branchCode],
    ["ประเภททอง", productType?.productType ?? t.productTypeId],
    ["% ทอง", purity?.label ?? t.purityId],
    // Read off the movement ledger, not a column: known only once the gold has moved, so before
    // that there is genuinely no answer to show.
    [
      "ยี่ห้อ",
      data.brandSplit.length === 0
        ? config.splitPending
        : data.brandSplit
            .map((line) => `${brandName(line.brandId)} ${formatWeight(displayWeight(isKg, line))} ${weightUnitLabel(isKg)}`)
            .join(" · "),
    ],
    ["น้ำหนัก", weightText],
    ["ราคา/บาททอง", formatNumber(t.pricePerGb)],
    // labelled so the relationship is on screen rather than assumed — this is the figure every
    // report averages, and the fee below is deliberately not part of it
    ["ยอดรวม (มูลค่าทอง)", formatNumber(t.totalAmount)],
    [
      "ค่าดำเนินการ",
      t.operationFee === null ? "—" : formatNumber(t.operationFee),
    ],
  ];

  if (t.operationFee !== null) {
    rows.push(["รวมทั้งสิ้น (รวมค่าดำเนินการ)", formatNumber(t.totalAmount + t.operationFee)]);
  }

  rows.push(
    ["งวด", t.settlementPeriod],
    [
      "บันทึกโดย",
      <>
        {t.recordedBy} · {new Date(t.recordedAt).toLocaleString("th-TH")}
        {backdated && (
          <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 1 }}>
            (บันทึกย้อนหลัง)
          </Typography>
        )}
      </>,
    ],
  );

  if (t.notes) rows.push(["หมายเหตุ", t.notes]);

  const nextStatuses = config.nextStatuses(t.currentStatus);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 3, gap: 2 }}>
        <Typography variant="h2" sx={{ flexGrow: 1 }}>
          {config.detailTitle}
        </Typography>
        <Chip label={config.statusLabel(t.currentStatus)} color={statusColor(t.currentStatus)} />
        <Button component={RouterLink} to={config.basePath} variant="text">
          กลับ
        </Button>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Table size="small">
            <TableBody>
              {rows.map(([label, value], i) => (
                <TableRow key={i}>
                  <TableCell sx={{ width: 220, color: "text.secondary" }}>{label}</TableCell>
                  <TableCell>{value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Buttons come from the shared transition map, so the UI cannot offer a move the API
              will refuse. On a confirmed write-up that is two: moving the gold, or voiding. */}
          {nextStatuses.length > 0 && (
            <Box sx={{ display: "flex", gap: 1, mt: 3, flexWrap: "wrap" }}>
              {nextStatuses.map((s) => (
                <Button key={s} variant="outlined" onClick={() => setPendingStatus(s)}>
                  {config.statusLabel(s)}
                </Button>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3" sx={{ mb: 2 }}>
            ประวัติสถานะ
          </Typography>
          <Table size="small">
            <TableBody>
              {data.statuses.map((s) => (
                <TableRow key={s.id}>
                  <TableCell sx={{ width: 160 }}>
                    <Chip size="small" label={config.statusLabel(s.status)} color={statusColor(s.status)} />
                  </TableCell>
                  <TableCell>{s.note ?? "—"}</TableCell>
                  <TableCell sx={{ width: 220, color: "text.secondary" }}>
                    {s.createdBy} · {new Date(s.createdAt).toLocaleString("th-TH")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={pendingStatus !== null} onClose={closeDialog} maxWidth="xs" fullWidth>
        <DialogTitle>
          {pendingStatus ? config.statusLabel(pendingStatus) : ""}
        </DialogTitle>
        <DialogContent>
          {/* The only place a retail trade records brand. The stamps divide the transaction weight
              and the residual falls to อื่นๆ, so this cannot change how much moves — 20 baht can be
              10 + 10 or 5 + 15, never 21. 99.9% renders nothing: its pools are keyed by origin. */}
          {collectsBrandSplit && !isKg && (
            <Box sx={{ pt: 1, mb: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {config.splitHelper}
              </Typography>
              <BrandSplitFields
                totalWeight={t.weightGb}
                unitLabel="บาท"
                applicable
                value={brandSplit}
                onChange={setBrandSplit}
              />
              <Divider sx={{ mt: 2 }} />
            </Box>
          )}
          {noteRequired && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              รายการนี้ถูกนับในยอดของงวดไปแล้ว — ต้องระบุเหตุผลในการยกเลิก
            </Alert>
          )}
          <TextField
            label={noteRequired ? "เหตุผล (จำเป็น)" : "หมายเหตุ"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={closeDialog}>
            ยกเลิก
          </Button>
          {/* the API rejects a blank note on a void; disabling here saves the round trip and says
              why before the operator hits it */}
          <Button
            onClick={handleAdvance}
            disabled={advance.isPending || (noteRequired && !note.trim())}
          >
            {advance.isPending ? "กำลังบันทึก…" : "ยืนยัน"}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

// Distinct component types per route — see the note in retailUi.ts on why this matters.
export const RetailBuyDetailPage = () => <RetailDetailPage config={RETAIL_BUY_UI} />;
export const RetailSellDetailPage = () => <RetailDetailPage config={RETAIL_SELL_UI} />;
