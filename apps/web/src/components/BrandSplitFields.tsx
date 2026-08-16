import { Alert, Box, Stack, TextField, Typography } from "@mui/material";
import { NA_BRAND, brandSplitRemainder, type BrandSplit } from "@gold-platform/types";
import { useSupplierBrands, useSuppliers } from "../hooks/useMasterData";
import { formatWeight } from "../utils/format";

/**
 * Where brand is recorded: on the transition that moves stock, not on the order.
 *
 * The operator names how much carried each stamp the supplier deals in. Everything they do not
 * name falls to the fungible pool, shown as a read-only residual. There is no total field and no
 * residual field — the only editable numbers are the named ones, and each is clamped to what is
 * still unaccounted for. **A split that comes to anything other than the transaction weight
 * cannot be typed here**, which is the point: brand decides which pools move, never how much.
 *
 * A brandLock supplier ships one stamp, so there is nothing to enter and the component says so
 * rather than offering a field whose only legal value is already known.
 */

// brandId → weight as typed, so a half-entered "1." stays on screen while the operator types
export type BrandSplitDraft = Record<string, string>;

/** The named lines, dropped down to the ones actually carrying weight. */
export function toBrandSplit(draft: BrandSplitDraft): BrandSplit {
  return Object.entries(draft)
    .map(([brandId, raw]) => ({ brandId, weight: Number(raw) }))
    .filter((e) => Number.isFinite(e.weight) && e.weight > 0);
}

interface Props {
  supplierId: string;
  /** the transaction weight, in the unit it was entered in */
  totalWeight: number;
  unitLabel: string;
  /** 99.9% pools are keyed by origin — brand is not a dimension of them, so nothing is shown */
  applicable: boolean;
  value: BrandSplitDraft;
  onChange: (next: BrandSplitDraft) => void;
}

export function BrandSplitFields({
  supplierId, totalWeight, unitLabel, applicable, value, onChange,
}: Props) {
  const { data: suppliersRes } = useSuppliers();
  const { data: brandsRes, isPending } = useSupplierBrands(applicable ? supplierId : "");

  if (!applicable) return null;

  const supplier = suppliersRes?.data.find((s) => s.id === supplierId);
  const brands = (brandsRes?.data ?? []).filter((b) => b.id !== NA_BRAND);

  if (supplier?.brandLock) {
    const only = brands[0];
    return (
      <Alert severity="info">
        {only
          ? `ทองทั้งหมด ${formatWeight(totalWeight)} ${unitLabel} เป็นยี่ห้อ ${only.brand} — ผู้ขายรายนี้ส่งยี่ห้อเดียว`
          : "ผู้ขายรายนี้ตั้งค่าเป็นยี่ห้อเดียว แต่ยังไม่ได้ระบุว่ายี่ห้อใด — ติดต่อผู้ดูแลระบบ"}
      </Alert>
    );
  }

  if (isPending) return null;
  // nothing registered means nothing to divide: it all lands in the fungible pool
  if (brands.length === 0) return null;

  const named = toBrandSplit(value);
  const remainder = brandSplitRemainder(totalWeight, named);

  function handleChange(brandId: string, raw: string) {
    // Clamp to what is left over from the *other* brands. Typing 20 into a 12 baht order can only
    // ever produce 12 — the split has no way to exceed the transaction, so it has no way to move
    // an amount the transaction did not agree to.
    const others = toBrandSplit({ ...value, [brandId]: "" });
    const headroom = brandSplitRemainder(totalWeight, others);
    const typed = Number(raw);
    const next = raw === "" || !Number.isFinite(typed)
      ? raw
      : String(Math.max(0, Math.min(typed, headroom)));
    onChange({ ...value, [brandId]: next });
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        แยกตามยี่ห้อ (รวม {formatWeight(totalWeight)} {unitLabel})
      </Typography>
      <Stack spacing={2}>
        {brands.map((brand) => (
          <TextField
            key={brand.id}
            label={`${brand.brand} (${unitLabel})`}
            type="number"
            value={value[brand.id] ?? ""}
            onChange={(e) => handleChange(brand.id, e.target.value)}
            slotProps={{ htmlInput: { min: 0, max: totalWeight, step: "any" } }}
          />
        ))}
        {/* Derived, never entered. Showing it as a field would invite an operator to make the
            two halves disagree; showing it as an answer is what keeps the sum exact. */}
        <TextField
          label="อื่นๆ (ที่เหลือ)"
          value={`${formatWeight(remainder)} ${unitLabel}`}
          disabled
          helperText="คำนวณอัตโนมัติจากส่วนที่เหลือ — ไม่ต้องกรอก"
        />
      </Stack>
    </Box>
  );
}
