import {
  RETAIL_BUY_STATUSES, RETAIL_SELL_STATUSES, WHOLE_BUY_STATUSES, WHOLE_SELL_STATUSES,
} from "@gold-platform/types";
import { domainLabel, type TradingDomain, type TradingRow } from "./trading";
import type { VolumeRow } from "./inventoryVolume";

/**
 * The gold balance: what gold the shop holds and is owed **right now**, laid out like a balance
 * sheet in metal rather than money.
 *
 *   ทองในคลัง (on hand)        the inventory ledger — the physical gold, the "cash" of this sheet
 *   + ทองรอรับเข้า (incoming)   deals that will put gold in the vault and have not yet
 *   − ทองค้างส่งมอบ (owed out)  deals that will take gold out of the vault and have not yet
 *   = ฐานะทองสุทธิ (net)        the gold the business is actually long, once everything open settles
 *
 * **The inventory ledger is the boundary, and nothing is on both sides of it.** A transaction counts
 * here only while its stock-moving step has not run: a buy until `STOCKED`, a sell until `PACKED`.
 * After that its gold is already in the on-hand figure (or already out of it), and listing it again
 * would count it twice. That is why a packed-but-unshipped sell is *not* a liability — its gold left
 * the books at `PACKED`, and the sale is now owed money, not metal. It is shown below the line as a
 * memo, as is a returned buy whose refund has not arrived: real open items, but cash, not gold.
 *
 * Every status of every domain is placed explicitly — in a bucket or in `SETTLED` — and the test
 * suite fails if a status is added without being placed. Inferring placement from `terminal` or
 * `kind` would quietly put a new state on the wrong side of the sheet.
 */

/** Which side of the sheet a bucket sits on. `memo` is shown but never enters the net. */
export type BalanceSide = "incoming" | "outgoing" | "memo";

export interface BalanceBucketDef {
  key: string;
  side: BalanceSide;
  domain: TradingDomain;
  /** What the deals in this bucket are waiting for. */
  label: string;
  statuses: readonly string[];
}

export const BALANCE_BUCKETS: readonly BalanceBucketDef[] = [
  // --- incoming: gold we will receive ---
  // CREATED counts: it auto-confirms at the midnight sweep, so it is an edit window on a deal
  // already struck, not an unagreed one. PAYMENT_FAILED is retried, not abandoned.
  { key: "WB_AWAIT_PAYMENT", side: "incoming", domain: "WHOLESALE_BUY", label: "รอชำระเงิน", statuses: ["CREATED", "CONFIRMED", "PAYMENT_FAILED"] },
  // our money has gone; the supplier owes the gold. DELIVERY_FAILED is late, not dead.
  { key: "WB_AWAIT_DELIVERY", side: "incoming", domain: "WHOLESALE_BUY", label: "ชำระแล้ว รอรับของ", statuses: ["PAID", "DELIVERY_FAILED"] },
  // the gold is on the premises but not on the books yet
  { key: "WB_AWAIT_STOCK", side: "incoming", domain: "WHOLESALE_BUY", label: "รับของแล้ว รอเข้าสต๊อก", statuses: ["RECEIVED", "DISPUTED"] },
  { key: "RB_AWAIT_STOCK", side: "incoming", domain: "RETAIL_BUY", label: "รอเข้าสต๊อก", statuses: ["DRAFT", "CONFIRMED"] },

  // --- outgoing: gold we owe ---
  { key: "WS_AWAIT_PACK", side: "outgoing", domain: "WHOLESALE_SELL", label: "รอเบิกทองแพ็ค", statuses: ["CREATED", "CONFIRMED"] },
  { key: "RS_AWAIT_PACK", side: "outgoing", domain: "RETAIL_SELL", label: "รอเบิกทอง", statuses: ["DRAFT", "CONFIRMED"] },

  // --- memo: open, but no longer a gold item ---
  // Gold already off the books at PACKED; what is outstanding is the buyer's payment.
  { key: "WS_AWAIT_CASH", side: "memo", domain: "WHOLESALE_SELL", label: "ตัดสต๊อกแล้ว รอรับเงิน", statuses: ["PACKED", "SHIPPED", "DISPUTED", "PAYMENT_FAILED"] },
  // The gold went back to the supplier and our money has not come with it.
  { key: "WB_AWAIT_REFUND", side: "memo", domain: "WHOLESALE_BUY", label: "ตีกลับผู้ขายแล้ว รอเงินคืน", statuses: ["RETURNED"] },
];

/**
 * Statuses with nothing open in gold: the stock move has run and the deal is closed, or the deal
 * died before anything moved. Kept as an explicit list so the completeness test can tell "placed
 * here on purpose" from "forgotten".
 */
export const SETTLED: Record<TradingDomain, readonly string[]> = {
  WHOLESALE_BUY: ["STOCKED", "CANCELLED", "REJECTED", "REFUNDED", "WRITTEN_OFF"],
  // WRITTEN_OFF: the gold left and the money never will — closed, and already off the books
  WHOLESALE_SELL: ["PAID", "CANCELLED", "REJECTED", "RETURNED", "WRITTEN_OFF"],
  RETAIL_BUY: ["STOCKED", "CANCELLED"],
  // PACKED is not terminal (hand-over states are not built) but its gold has already left
  RETAIL_SELL: ["PACKED", "SHIPPED", "CANCELLED"],
};

/** Every status each domain defines — what the completeness test checks the placement against. */
export const DOMAIN_STATUSES: Record<TradingDomain, readonly string[]> = {
  WHOLESALE_BUY: WHOLE_BUY_STATUSES.map((s) => s.value),
  WHOLESALE_SELL: WHOLE_SELL_STATUSES.map((s) => s.value),
  RETAIL_BUY: RETAIL_BUY_STATUSES.map((s) => s.value),
  RETAIL_SELL: RETAIL_SELL_STATUSES.map((s) => s.value),
};

const bucketOf = new Map(
  BALANCE_BUCKETS.flatMap((b) => b.statuses.map((status) => [`${b.domain}:${status}`, b] as const)),
);

/** The bucket a transaction sits in, or null when it has nothing open in gold. */
export const bucketFor = (row: Pick<TradingRow, "domain" | "status">) =>
  bucketOf.get(`${row.domain}:${row.status}`) ?? null;

export interface Weighed {
  count: number;
  weightGb: number;
  weightGm: number;
  /** THB at the deal's own price — what the open items are worth as agreed. */
  amount: number;
}

const ZERO: Weighed = { count: 0, weightGb: 0, weightGm: 0, amount: 0 };

const add = (a: Weighed, b: Weighed): Weighed => ({
  count: a.count + b.count,
  weightGb: a.weightGb + b.weightGb,
  weightGm: a.weightGm + b.weightGm,
  amount: a.amount + b.amount,
});

const sumAll = (items: Weighed[]) => items.reduce(add, ZERO);

/** One status within a bucket — the "group by transaction status" grain. */
export interface BalanceLine extends Weighed {
  status: string;
  statusLabel: string;
}

export interface BalanceGroup extends Weighed {
  key: string;
  side: BalanceSide;
  domain: TradingDomain;
  /** Domain and what it waits for, e.g. "ซื้อส่ง · ชำระแล้ว รอรับของ". */
  label: string;
  /** In the bucket's own status order; only statuses that have rows. */
  lines: BalanceLine[];
}

export interface PhysicalLine {
  productTypeId: string;
  weightGb: number;
  weightGm: number;
  /** Book cost at WAC, from the inventory ledger. */
  cost: number;
}

export interface GoldBalance {
  physical: PhysicalLine[];
  physicalTotal: { weightGb: number; weightGm: number; cost: number };
  incoming: BalanceGroup[];
  outgoing: BalanceGroup[];
  memo: BalanceGroup[];
  incomingTotal: Weighed;
  outgoingTotal: Weighed;
  /** On hand + incoming − outgoing. Memo items never enter it. */
  net: { weightGb: number; weightGm: number };
}

/**
 * Lays one purity pool out as a balance. **The caller splits by purity first** — 96.5% and 99.9%
 * are different grades of gold, and a net spanning them would add two different things.
 *
 * Every bucket is returned even when empty: a sheet whose line items come and go is harder to read
 * than one that says 0 where nothing is waiting, and "nothing owed out" is itself an answer.
 */
export function buildGoldBalance(rows: TradingRow[], inventory: VolumeRow[]): GoldBalance {
  const byProductType = new Map<string, PhysicalLine>();
  for (const pool of inventory) {
    const line = byProductType.get(pool.productTypeId)
      ?? { productTypeId: pool.productTypeId, weightGb: 0, weightGm: 0, cost: 0 };
    line.weightGb += pool.totalWeightGb;
    line.weightGm += pool.totalWeightGm;
    line.cost += pool.totalCost;
    byProductType.set(pool.productTypeId, line);
  }
  const physical = [...byProductType.values()];
  const physicalTotal = {
    weightGb: physical.reduce((s, l) => s + l.weightGb, 0),
    weightGm: physical.reduce((s, l) => s + l.weightGm, 0),
    cost: physical.reduce((s, l) => s + l.cost, 0),
  };

  const groups = BALANCE_BUCKETS.map((def): BalanceGroup => {
    const inBucket = rows.filter((r) => bucketFor(r) === def);
    const lines = def.statuses
      .map((status): BalanceLine | null => {
        const atStatus = inBucket.filter((r) => r.status === status);
        if (atStatus.length === 0) return null;
        return {
          status,
          statusLabel: atStatus[0]!.statusLabel,
          ...sumAll(atStatus.map((r) => ({ count: 1, weightGb: r.weightGb, weightGm: r.weightGm, amount: r.amount }))),
        };
      })
      .filter((l): l is BalanceLine => l !== null);
    return {
      key: def.key,
      side: def.side,
      domain: def.domain,
      label: `${domainLabel(def.domain)} · ${def.label}`,
      lines,
      ...sumAll(lines),
    };
  });

  const incoming = groups.filter((g) => g.side === "incoming");
  const outgoing = groups.filter((g) => g.side === "outgoing");
  const incomingTotal = sumAll(incoming);
  const outgoingTotal = sumAll(outgoing);

  return {
    physical,
    physicalTotal,
    incoming,
    outgoing,
    memo: groups.filter((g) => g.side === "memo"),
    incomingTotal,
    outgoingTotal,
    net: {
      weightGb: physicalTotal.weightGb + incomingTotal.weightGb - outgoingTotal.weightGb,
      weightGm: physicalTotal.weightGm + incomingTotal.weightGm - outgoingTotal.weightGm,
    },
  };
}
