import { WHOLE_SELL_STATUSES, WHOLE_SELL_TRANSITIONS, type WholeSellStatusValue } from "@gold-platform/types";

type ChipColor = "default" | "info" | "success" | "warning" | "error";

// Same reading as the buy side: happy-path progress runs cool→green, every failure branch reads
// warning (recoverable) or error (terminal), so a list scan surfaces what needs attention.
const STATUS_COLORS: Record<WholeSellStatusValue, ChipColor> = {
  CREATED: "default",
  CONFIRMED: "info",
  PACKED: "info",
  SHIPPED: "info",
  PAID: "success",
  DISPUTED: "warning",
  PAYMENT_FAILED: "warning",
  CANCELLED: "error",
  REJECTED: "error",
  RETURNED: "error",
  WRITTEN_OFF: "error",
};

export const statusColor = (status: string): ChipColor =>
  STATUS_COLORS[status as WholeSellStatusValue] ?? "default";

export const statusMeta = (status: string) =>
  WHOLE_SELL_STATUSES.find((s) => s.value === status);

export const statusLabel = (status: string) => statusMeta(status)?.label ?? status;

export const isTerminal = (status: string) => statusMeta(status)?.terminal ?? false;

/** Moves the API will accept from `status` — drives which action buttons are rendered. */
export const nextStatuses = (status: string): WholeSellStatusValue[] =>
  WHOLE_SELL_TRANSITIONS[status as WholeSellStatusValue] ?? [];

/** A failure-branch move: the API rejects it without a note, so the UI must collect one. */
export const requiresNote = (status: string) => statusMeta(status)?.kind === "bad";

/**
 * Whether a transaction belongs in a list total. The test is simply **did the gold end up gone**.
 *
 * Cancelled and rejected deals never moved any. A returned one moved gold out at `PACKED` and
 * moved it straight back in on `RETURNED`, so its net effect on stock is zero and counting it
 * would double-report gold the company still holds.
 *
 * `WRITTEN_OFF` is the exception among the terminal failures: it is the one bad-terminal state
 * with no reversal, so the gold really is gone and the weight column must keep counting it.
 * Excluding it would make the totals disagree with the inventory ledger — the money never
 * arriving is what the status itself records.
 */
export const countsTowardTotal = (status: string) => {
  const meta = statusMeta(status);
  if (!meta) return false;
  if (status === "WRITTEN_OFF") return true;
  return !(meta.kind === "bad" && meta.terminal);
};

export { formatNumber, formatWeight } from "./format";
