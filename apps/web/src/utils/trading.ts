import type { WholeBuyTransaction } from "../hooks/useWholesaleBuy";
import type { WholeSellTransaction } from "../hooks/useWholesaleSell";
import type { RetailTransaction } from "../hooks/useRetail";
import { countsTowardTotal as buyCounts, statusLabel as buyLabel } from "./wholeBuyStatus";
import { countsTowardTotal as sellCounts, statusLabel as sellLabel } from "./wholeSellStatus";
import {
  buyCountsTowardTotal as retailBuyCounts, buyStatusLabel as retailBuyLabel,
  sellCountsTowardTotal as retailSellCounts, sellStatusLabel as retailSellLabel,
} from "./retailStatus";

/**
 * The four transaction domains, flattened into one row so a single window can be read across all of
 * them.
 *
 * **Every domain rule is applied here and nowhere downstream.** Which weight counts, which amount
 * counts, and whether a row counts at all differ per domain — a wholesale buy reports what was
 * delivered, a wholesale sell what was agreed, retail what was measured. Normalising once is what
 * lets the three trading views be genuinely comparable: they read the same rows, so they cannot
 * disagree with each other, and because the rules come from each domain's own `countsTowardTotal`
 * and weight choice, they cannot disagree with that domain's list page or export either.
 */

export type TradingDomain = "RETAIL_BUY" | "RETAIL_SELL" | "WHOLESALE_BUY" | "WHOLESALE_SELL";

/** Which way the metal moved. Cash moves the other way, always. */
export type TradingDirection = "in" | "out";

/** Who was on the other side. The two channels are the two halves of the business model. */
export type TradingChannel = "retail" | "wholesale";

export interface TradingRow {
  domain: TradingDomain;
  direction: TradingDirection;
  channel: TradingChannel;
  id: string;
  transactionDate: string;
  settlementPeriod: string;
  /** Branch on retail, supplier on wholesale — resolved by the caller, which holds master data. */
  counterparty: string;
  purityId: string;
  productTypeId: string;
  /** The weight that counts for this domain, in gold baht. */
  weightGb: number;
  weightGm: number;
  /** Per gold baht, at this row's own purity. */
  pricePerGb: number;
  /** Gold value in THB. Retail's operating fee is deliberately excluded — see `feeAmount`. */
  amount: number;
  /**
   * Retail's ค่าบล็อค and the like. Kept out of `amount` so price-per-gold-baht averages read spread
   * rather than fee, and reported separately where all-in cash is what is wanted. Always 0 on
   * wholesale, which has no fees.
   */
  feeAmount: number;
  status: string;
  statusLabel: string;
  countsTowardTotal: boolean;
}

const DOMAIN_META: Record<TradingDomain, { direction: TradingDirection; channel: TradingChannel; label: string }> = {
  RETAIL_BUY: { direction: "in", channel: "retail", label: "ซื้อปลีก" },
  RETAIL_SELL: { direction: "out", channel: "retail", label: "ขายปลีก" },
  WHOLESALE_BUY: { direction: "in", channel: "wholesale", label: "ซื้อส่ง" },
  WHOLESALE_SELL: { direction: "out", channel: "wholesale", label: "ขายส่ง" },
};

export const domainLabel = (domain: TradingDomain) => DOMAIN_META[domain].label;
export const domainDirection = (domain: TradingDomain) => DOMAIN_META[domain].direction;
export const domainChannel = (domain: TradingDomain) => DOMAIN_META[domain].channel;

/** Resolves a counterparty id to a name; the caller owns the master-data lookups. */
type NameOf = (id: string) => string;

/**
 * A wholesale buy reports the **delivered** weight and amount, falling back to the ordered ones
 * before a delivery is checked — the same `actualX ?? x` choice its list page and export make.
 *
 * Its price is per-purity: 99.9% orders are driven by the derived 999 quote. Both are already stored,
 * so this picks rather than recomputes.
 */
export function fromWholesaleBuy(
  transactions: WholeBuyTransaction[],
  supplierName: NameOf,
  isNineNineNine: (purityId: string) => boolean,
): TradingRow[] {
  return transactions.map((t) => ({
    domain: "WHOLESALE_BUY" as const,
    ...DOMAIN_META.WHOLESALE_BUY,
    id: t.id,
    transactionDate: t.transactionDate,
    settlementPeriod: t.settlementPeriod,
    counterparty: supplierName(t.supplierId),
    purityId: t.purityId,
    productTypeId: t.productTypeId,
    weightGb: t.actualWeightGb ?? t.weightGb,
    weightGm: t.actualWeightGm ?? t.weightGm,
    pricePerGb: isNineNineNine(t.purityId) ? t.pricePerGb999 : t.pricePerGb965,
    amount: t.actualAmount ?? t.totalAmount,
    feeAmount: 0,
    status: t.currentStatus,
    statusLabel: buyLabel(t.currentStatus),
    countsTowardTotal: buyCounts(t.currentStatus),
  }));
}

/**
 * A wholesale sell reports the **agreed** weight: the API refuses to pack anything else, so the
 * contested figure on a dispute is a claim about the delivery rather than what left the vault.
 */
export function fromWholesaleSell(
  transactions: WholeSellTransaction[],
  supplierName: NameOf,
  isNineNineNine: (purityId: string) => boolean,
): TradingRow[] {
  return transactions.map((t) => ({
    domain: "WHOLESALE_SELL" as const,
    ...DOMAIN_META.WHOLESALE_SELL,
    id: t.id,
    transactionDate: t.transactionDate,
    settlementPeriod: t.settlementPeriod,
    counterparty: supplierName(t.supplierId),
    purityId: t.purityId,
    productTypeId: t.productTypeId,
    weightGb: t.weightGb,
    weightGm: t.weightGm,
    pricePerGb: isNineNineNine(t.purityId) ? t.pricePerGb999 : t.pricePerGb965,
    amount: t.totalAmount,
    feeAmount: 0,
    status: t.currentStatus,
    statusLabel: sellLabel(t.currentStatus),
    countsTowardTotal: sellCounts(t.currentStatus),
  }));
}

/**
 * Retail carries one weight, one price at both purities, and a fee that stays out of the amount.
 * The `direction` is the only thing separating a retail buy from a retail sell.
 */
export function fromRetail(
  transactions: RetailTransaction[],
  domain: "RETAIL_BUY" | "RETAIL_SELL",
  branchName: NameOf,
): TradingRow[] {
  const counts = domain === "RETAIL_BUY" ? retailBuyCounts : retailSellCounts;
  const label = domain === "RETAIL_BUY" ? retailBuyLabel : retailSellLabel;
  return transactions.map((t) => ({
    domain,
    ...DOMAIN_META[domain],
    id: t.id,
    transactionDate: t.transactionDate,
    settlementPeriod: t.settlementPeriod,
    counterparty: branchName(t.branchCode),
    purityId: t.purityId,
    productTypeId: t.productTypeId,
    weightGb: t.weightGb,
    weightGm: t.weightGm,
    pricePerGb: t.pricePerGb,
    amount: t.totalAmount,
    feeAmount: t.operationFee ?? 0,
    status: t.currentStatus,
    statusLabel: label(t.currentStatus),
    countsTowardTotal: counts(t.currentStatus),
  }));
}

// --- aggregates ---

export interface TradingSummary {
  count: number;
  excluded: number;
  weightGb: number;
  weightGm: number;
  amount: number;
  feeAmount: number;
  /**
   * THB per gold baht. Null when there is no volume to divide by — an empty window, or one where
   * every row was cancelled. Not zero: a 0.00 in a price column claims the gold was free, where an
   * absent average is the truth.
   */
  avgPricePerGb: number | null;
}

/**
 * **The denominator is gold baht at every purity**, including the kilogram pools — the same rule the
 * exports use, and for the same reason. The business prices per gold baht, and one gold baht of
 * 99.9% is worth more than one of 96.5%; the kg→GB conversion is pure mass, so the purity difference
 * arrives through the price. Dividing a 99.9% pool by kilograms would print a THB/kg figure under a
 * THB/บาททอง heading.
 *
 * It is a weighted average, never a mean of the row prices — that would let a 1-baht trade pull as
 * hard as a 50-baht one.
 */
export function summarise(rows: TradingRow[]): TradingSummary {
  const counted = rows.filter((r) => r.countsTowardTotal);
  const weightGb = counted.reduce((sum, r) => sum + r.weightGb, 0);
  const amount = counted.reduce((sum, r) => sum + r.amount, 0);
  return {
    count: counted.length,
    excluded: rows.length - counted.length,
    weightGb,
    weightGm: counted.reduce((sum, r) => sum + r.weightGm, 0),
    amount,
    feeAmount: counted.reduce((sum, r) => sum + r.feeAmount, 0),
    avgPricePerGb: weightGb > 0 ? amount / weightGb : null,
  };
}

export const byDomain = (rows: TradingRow[], domain: TradingDomain) =>
  rows.filter((r) => r.domain === domain);

/**
 * What one gold baht gained between buying it on one side and selling it on the other.
 *
 * Null unless **both** sides traded — a spread against a side that did nothing is not a small
 * spread, it is no answer. Returning 0 there would read as "we broke even", which is a claim.
 */
export const spread = (buy: TradingSummary, sell: TradingSummary): number | null =>
  buy.avgPricePerGb === null || sell.avgPricePerGb === null
    ? null
    : sell.avgPricePerGb - buy.avgPricePerGb;

export interface NetPosition {
  /** Gold baht bought minus gold baht sold. Positive = the shop is holding more than it started. */
  netWeightGb: number;
  netWeightGm: number;
  /**
   * Cash in minus cash out, **including retail fees**: a fee is real money that changed hands, even
   * though it is excluded from the price averages. This is the one figure that wants the all-in
   * number, which is exactly why the fee is stored beside the amount rather than inside it.
   */
  netCash: number;
  inWeightGb: number;
  outWeightGb: number;
  /** The same two figures in grams, so a kilogram pool can show its own gross in and out. */
  inWeightGm: number;
  outWeightGm: number;
}

/**
 * Net gold and net cash move in opposite directions by construction: buying gold spends cash. A week
 * of heavy customer buying is negative cash and positive gold, and both are correct at once — they
 * are independent figures, not two views of one.
 */
export function netPosition(rows: TradingRow[]): NetPosition {
  const counted = rows.filter((r) => r.countsTowardTotal);
  const sum = (dir: TradingDirection, pick: (r: TradingRow) => number) =>
    counted.filter((r) => r.direction === dir).reduce((s, r) => s + pick(r), 0);

  const inWeightGb = sum("in", (r) => r.weightGb);
  const outWeightGb = sum("out", (r) => r.weightGb);
  const inWeightGm = sum("in", (r) => r.weightGm);
  const outWeightGm = sum("out", (r) => r.weightGm);

  return {
    inWeightGb,
    outWeightGb,
    inWeightGm,
    outWeightGm,
    netWeightGb: inWeightGb - outWeightGb,
    netWeightGm: inWeightGm - outWeightGm,
    // gold out brings cash in; gold in sends cash out
    netCash:
      sum("out", (r) => r.amount + r.feeAmount) - sum("in", (r) => r.amount + r.feeAmount),
  };
}

/**
 * Buckets rows by settlement period, newest first.
 *
 * The periods come from the rows themselves rather than from a generated calendar, so a week in
 * which nothing traded simply does not appear. That is the honest rendering: an empty row would
 * claim the shop was open and did nothing, which is not something this data knows.
 */
export function byPeriod(rows: TradingRow[]): { period: string; rows: TradingRow[] }[] {
  const groups = new Map<string, TradingRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.settlementPeriod);
    if (existing) existing.push(row);
    else groups.set(row.settlementPeriod, [row]);
  }
  return [...groups.entries()]
    .map(([period, periodRows]) => ({ period, rows: periodRows }))
    .sort((a, b) => b.period.localeCompare(a.period));
}

/** Splits a window's rows into the two pools, which are never mixed in any figure. */
export function splitPurity(rows: TradingRow[], isNineNineNine: (purityId: string) => boolean) {
  return {
    nineSixFive: rows.filter((r) => !isNineNineNine(r.purityId)),
    nineNineNine: rows.filter((r) => isNineNineNine(r.purityId)),
  };
}
