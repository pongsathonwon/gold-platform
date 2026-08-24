import {
  RETAIL_BUY_EXCLUDED_FROM_TOTALS, RETAIL_BUY_STATUSES, RETAIL_BUY_TRANSITIONS,
  RETAIL_SELL_EXCLUDED_FROM_TOTALS, RETAIL_SELL_STATUSES, RETAIL_SELL_TRANSITIONS,
  type RetailBuyStatusValue, type RetailSellStatusValue,
} from "@gold-platform/types";

/**
 * Status helpers for both retail domains.
 *
 * One file rather than the `wholeBuyStatus.ts` / `wholeSellStatus.ts` pair, because unlike wholesale
 * the two retail domains have nothing to disagree about. Their status sets differ by one unreachable
 * value, both exclude exactly `CANCELLED` from totals, and neither has a failure branch to colour
 * differently. Two files here would be one file typed twice.
 */

type ChipColor = "default" | "info" | "success" | "warning" | "error";

/**
 * A confirmed write-up is `success`, not `info`: it is the finished state, not a step on the way to
 * one. Wholesale reserves green for gold that reached the vault, but a retail record has no later
 * milestone to save it for — the trade was over before the form was opened.
 */
const STATUS_COLORS: Record<string, ChipColor> = {
  DRAFT: "default",
  CONFIRMED: "success",
  SHIPPED: "info",
  CANCELLED: "error",
};

export const statusColor = (status: string): ChipColor => STATUS_COLORS[status] ?? "default";

// --- retail-buy ---

export const buyStatusMeta = (status: string) =>
  RETAIL_BUY_STATUSES.find((s) => s.value === status);

export const buyStatusLabel = (status: string) => buyStatusMeta(status)?.label ?? status;

export const buyIsTerminal = (status: string) => buyStatusMeta(status)?.terminal ?? false;

/** Moves the API will accept from `status` — drives which action buttons are rendered. */
export const buyNextStatuses = (status: string): RetailBuyStatusValue[] =>
  RETAIL_BUY_TRANSITIONS[status as RetailBuyStatusValue] ?? [];

/** The API rejects a void without a note, so the UI must collect one. */
export const buyRequiresNote = (status: string) => buyStatusMeta(status)?.kind === "bad";

/**
 * Whether a write-up belongs in a list total.
 *
 * The test is simply *did the trade happen*. A cancelled row did not, so it cannot inform what gold
 * cost or fetched — but it stays visible in the table and the export, with the exclusion stated in
 * the footer. A total that quietly drops rows is not auditable.
 *
 * Retail needs none of the care the wholesale version documents: there is one excluded status, no
 * reversal to reason about, and no direction-dependent reading of a written-off balance.
 */
export const buyCountsTowardTotal = (status: string) => {
  if (!buyStatusMeta(status)) return false;
  return !RETAIL_BUY_EXCLUDED_FROM_TOTALS.includes(status as RetailBuyStatusValue);
};

// --- retail-sell ---

export const sellStatusMeta = (status: string) =>
  RETAIL_SELL_STATUSES.find((s) => s.value === status);

export const sellStatusLabel = (status: string) => sellStatusMeta(status)?.label ?? status;

export const sellIsTerminal = (status: string) => sellStatusMeta(status)?.terminal ?? false;

export const sellNextStatuses = (status: string): RetailSellStatusValue[] =>
  RETAIL_SELL_TRANSITIONS[status as RetailSellStatusValue] ?? [];

export const sellRequiresNote = (status: string) => sellStatusMeta(status)?.kind === "bad";

export const sellCountsTowardTotal = (status: string) => {
  if (!sellStatusMeta(status)) return false;
  return !RETAIL_SELL_EXCLUDED_FROM_TOTALS.includes(status as RetailSellStatusValue);
};

// Re-exported so retail call sites import their formatters from the util they already use, matching
// how both wholesale status files do it.
export { formatNumber, formatWeight, formatBusinessDate } from "./format";
