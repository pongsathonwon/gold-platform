import { useState } from "react";
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, TextField,
  Typography,
} from "@mui/material";
import type { BrandSplit } from "@gold-platform/types";
import { BrandSplitFields, toBrandSplit, type BrandSplitDraft } from "./BrandSplitFields";

/**
 * The quick-advance modal for the one step on each list that moves stock.
 *
 * Every other happy-path step is a single click on the row: confirming, recording a payment,
 * shipping — the row already holds everything the server needs. The stock-moving step does not.
 * Gold entering or leaving a pool is the moment its stamp is known, so this is where the brand
 * split is collected — on all four lists, the same fields the detail dialogs show, because the
 * server reads the split on exactly this move (§9d). It is also the one step that changes the
 * balance, so it is worth a confirm even on 99.9%, where there is no split to type and the modal
 * is only "move this much".
 *
 * The parent mounts it keyed by the row's id, so the draft resets per row rather than carrying a
 * half-typed split from one trade into the next.
 *
 * A refusal — a pool short of stock on a sell, a brand the server does not recognise — stays in
 * the dialog rather than closing it, so the split can be corrected in place.
 */
export interface QuickStockMoveInput {
  note?: string;
  brandSplit?: BrandSplit;
}

interface Props {
  title: string;
  /** the row being moved — counterparty, weight, unit — since the list is still behind the modal */
  summary: string;
  /** what this move does, in the domain's own words — shown on 99.9% too, where there is no split */
  helper?: string;
  /** the transaction weight in gold baht, which is the unit a split is entered in */
  totalWeightGb: number;
  /** false on 99.9%: those pools are keyed by origin, so no split is asked for */
  brandApplicable: boolean;
  /** the counterparty whose registered brands are the lines; omit for retail, where every active brand is */
  supplierId?: string;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: QuickStockMoveInput) => void;
}

export function QuickStockMoveDialog({
  title, summary, helper, totalWeightGb, brandApplicable, supplierId,
  isPending, error, onClose, onSubmit,
}: Props) {
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<BrandSplitDraft>({});

  function submit() {
    // only the named lines travel — the fungible residual is the server's subtraction, so nothing
    // on the wire can disagree with the transaction weight
    const split = toBrandSplit(draft);
    onSubmit({
      note: note.trim() || undefined,
      ...(brandApplicable && split.length > 0 ? { brandSplit: split } : {}),
    });
  }

  return (
    <Dialog open onClose={isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <Alert severity="info">{summary}</Alert>
          {helper && (
            <Typography variant="body2" color="text.secondary">
              {helper}
            </Typography>
          )}
          {brandApplicable && (
            <>
              <BrandSplitFields
                supplierId={supplierId}
                totalWeight={totalWeightGb}
                unitLabel="บาท"
                applicable
                value={draft}
                onChange={setDraft}
              />
              <Divider />
            </>
          )}
          <TextField
            label="หมายเหตุ"
            multiline
            minRows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose} disabled={isPending}>
          ยกเลิก
        </Button>
        <Button onClick={submit} disabled={isPending}>
          {isPending ? "กำลังบันทึก…" : "ยืนยัน"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
