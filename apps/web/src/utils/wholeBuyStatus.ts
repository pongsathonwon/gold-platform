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
  DISPUTED: "warning",
  CANCELLED: "error",
  REJECTED: "error",
  RETURNED: "error",
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
 */
export const countsTowardTotal = (status: string) => {
  const meta = statusMeta(status);
  if (!meta) return false;
  return !(meta.kind === "bad" && meta.terminal);
};

/** Money — always two decimals, thousands separated. */
export const formatNumber = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Weights render as entered: 2 kg is "2", not "2.000". The only cleanup is stripping binary
 * floating-point residue (a summed 0.1 + 0.2 would otherwise print 17 digits) — toPrecision(12)
 * is well inside a double's ~15 significant digits, so it never touches a real value.
 */
export const formatWeight = (n: number) => String(Number(n.toPrecision(12)));
