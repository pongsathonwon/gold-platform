import { WHOLE_BUY_STATUSES, WHOLE_BUY_TRANSITIONS, type WholeBuyStatusValue } from "@gold-platform/types";

type ChipColor = "default" | "info" | "success" | "warning" | "error";

// Happy-path progress reads cool→green; every failure branch reads warning (recoverable) or
// error (terminal), so a list scan surfaces the transactions that need attention.
const STATUS_COLORS: Record<WholeBuyStatusValue, ChipColor> = {
  CREATED: "default",
  CONFIRMED: "info",
  PAID: "info",
  RECEIVED: "info",
  CHECKED: "success",
  PAYMENT_FAILED: "warning",
  DELIVERY_FAILED: "warning",
  DISPUTED: "warning",
  CANCELLED: "error",
  REJECTED: "error",
  RETURNED: "error",
  WRITTEN_OFF: "error",
};

export const statusColor = (status: string): ChipColor =>
  STATUS_COLORS[status as WholeBuyStatusValue] ?? "default";

export const statusMeta = (status: string) =>
  WHOLE_BUY_STATUSES.find((s) => s.value === status);

export const statusLabel = (status: string) => statusMeta(status)?.label ?? status;

export const isTerminal = (status: string) => statusMeta(status)?.terminal ?? false;

/** Moves the API will accept from `status` — drives which action buttons are rendered. */
export const nextStatuses = (status: string): WholeBuyStatusValue[] =>
  WHOLE_BUY_TRANSITIONS[status as WholeBuyStatusValue] ?? [];

/** A failure-branch move: the API rejects it without a note, so the UI must collect one. */
export const requiresNote = (status: string) => statusMeta(status)?.kind === "bad";

/**
 * Whether a transaction belongs in a list total. Cancelled, rejected and returned orders never
 * delivered gold and never settled money — summing them would overstate both columns. Everything
 * still in flight does count: it is gold the company is committed to.
 *
 * That includes `DELIVERY_FAILED`, which is not terminal — the shipment is late, not dead, and it
 * can still arrive. `WRITTEN_OFF` is where that commitment is finally given up on, so it drops out
 * like the other terminal failures.
 *
 * These columns are gold-centric, which is why the rule reads inverted on the sell side: there
 * `WRITTEN_OFF` means the gold left and the money never came, so it keeps counting. Here it means
 * our money left and the gold never came, so it stops.
 */
export const countsTowardTotal = (status: string) => {
  const meta = statusMeta(status);
  if (!meta) return false;
  return !(meta.kind === "bad" && meta.terminal);
};

// Both formatters are domain-agnostic and shared with wholesale-sell; re-exported here so the
// existing call sites keep importing them from the util they already use.
export { formatNumber, formatWeight } from "./format";
