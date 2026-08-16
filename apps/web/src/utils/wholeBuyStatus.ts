import {
  WHOLE_BUY_EXCLUDED_FROM_TOTALS, WHOLE_BUY_STATUSES,
  WHOLE_BUY_TRANSITIONS, type WholeBuyStatusValue,
} from "@gold-platform/types";

type ChipColor = "default" | "info" | "success" | "warning" | "error";

// Happy-path progress reads cool→green; every failure branch reads warning (still needs someone's
// attention) or error (dead), so a list scan surfaces what is waiting on a human.
const STATUS_COLORS: Record<WholeBuyStatusValue, ChipColor> = {
  CREATED: "default",
  CONFIRMED: "info",
  PAID: "info",
  RECEIVED: "info",
  STOCKED: "success",
  PAYMENT_FAILED: "warning",
  DELIVERY_FAILED: "warning",
  DISPUTED: "warning",
  CANCELLED: "error",
  REJECTED: "error",
  // warning rather than error: our money is still sitting with the supplier and somebody has to
  // chase it to REFUNDED or give up on it. It stopped being a dead end when it stopped being terminal.
  RETURNED: "warning",
  // closed clean — nothing was gained and nothing was lost, so it reads as out of play
  REFUNDED: "default",
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
 * Whether a transaction belongs in a list total. Cancelled, rejected, returned and refunded
 * orders never put gold in the vault — summing them would overstate the column. Everything still
 * in flight does count: it is gold the company is committed to.
 *
 * That includes `DELIVERY_FAILED`, which is not terminal — the shipment is late, not dead, and it
 * can still arrive. `WRITTEN_OFF` is where that commitment is finally given up on, so it drops out.
 *
 * The set is explicit rather than inferred from `bad && terminal`. That shorthand held only while
 * every dead end was also terminal; `RETURNED` now has onward moves, and inferring "counts toward
 * stock" from "can still move" would start counting gold that went back to the supplier.
 *
 * These columns are gold-centric, which is why the rule reads inverted on the sell side: there
 * `WRITTEN_OFF` means the gold left and the money never came, so it keeps counting. Here it means
 * our money left and the gold never came, so it stops.
 */
export const countsTowardTotal = (status: string) => {
  if (!statusMeta(status)) return false;
  return !WHOLE_BUY_EXCLUDED_FROM_TOTALS.includes(status as WholeBuyStatusValue);
};

// The formatters are domain-agnostic and shared with wholesale-sell; re-exported here so the
// existing call sites keep importing them from the util they already use.
export { formatNumber, formatWeight, formatBusinessDate } from "./format";
