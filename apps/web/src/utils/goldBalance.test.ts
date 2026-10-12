import { describe, it, expect } from "vitest";
import {
  BALANCE_BUCKETS, DOMAIN_STATUSES, SETTLED, bucketFor, buildGoldBalance,
} from "./goldBalance";
import type { TradingDomain, TradingRow } from "./trading";
import type { VolumeRow } from "./inventoryVolume";

const row = (overrides: Partial<TradingRow> = {}): TradingRow => ({
  domain: "WHOLESALE_BUY",
  direction: "in",
  channel: "wholesale",
  id: "t1",
  transactionDate: "2026-10-12",
  settlementPeriod: "2026-W41",
  counterparty: "ผู้ค้า",
  purityId: "965",
  productTypeId: "BAR",
  weightGb: 10,
  weightGm: 152.44,
  pricePerGb: 48_000,
  amount: 480_000,
  feeAmount: 0,
  status: "PAID",
  statusLabel: "ชำระเงินแล้ว",
  countsTowardTotal: true,
  ...overrides,
});

const pool = (overrides: Partial<VolumeRow> = {}): VolumeRow => ({
  purityId: "965",
  brandId: "NA",
  origin: "foreign",
  productTypeId: "BAR",
  totalWeightGb: 100,
  totalWeightGm: 1524.4,
  totalCost: 4_700_000,
  ...overrides,
});

describe("status placement", () => {
  it("places every status of every domain exactly once", () => {
    // A new status must be put on a side of the sheet on purpose. Inferring it from `terminal` or
    // `kind` would silently file it somewhere, and the wrong side of a balance sheet is not a
    // cosmetic bug.
    for (const domain of Object.keys(DOMAIN_STATUSES) as TradingDomain[]) {
      for (const status of DOMAIN_STATUSES[domain]) {
        const inBuckets = BALANCE_BUCKETS.filter((b) => b.domain === domain && b.statuses.includes(status));
        const settled = SETTLED[domain].includes(status) ? 1 : 0;
        expect(inBuckets.length + settled, `${domain}:${status}`).toBe(1);
      }
    }
  });

  it("drops a deal from the sheet once its stock move has run", () => {
    // after STOCKED / PACKED the gold is in (or out of) the on-hand figure already
    expect(bucketFor({ domain: "WHOLESALE_BUY", status: "STOCKED" })).toBeNull();
    expect(bucketFor({ domain: "RETAIL_BUY", status: "STOCKED" })).toBeNull();
    expect(bucketFor({ domain: "RETAIL_SELL", status: "PACKED" })).toBeNull();
    expect(bucketFor({ domain: "WHOLESALE_SELL", status: "PACKED" })?.side).toBe("memo");
  });

  it("treats a sell as owed gold only until it is packed", () => {
    expect(bucketFor({ domain: "WHOLESALE_SELL", status: "CONFIRMED" })?.side).toBe("outgoing");
    expect(bucketFor({ domain: "WHOLESALE_SELL", status: "SHIPPED" })?.side).toBe("memo");
  });
});

describe("buildGoldBalance", () => {
  it("nets on hand plus incoming minus owed out", () => {
    const balance = buildGoldBalance(
      [
        row({ id: "a", domain: "WHOLESALE_BUY", status: "PAID", weightGb: 20 }),
        row({ id: "b", domain: "RETAIL_BUY", status: "CONFIRMED", weightGb: 3 }),
        row({ id: "c", domain: "WHOLESALE_SELL", status: "CONFIRMED", weightGb: 15 }),
      ],
      [pool({ totalWeightGb: 100 })],
    );
    expect(balance.physicalTotal.weightGb).toBe(100);
    expect(balance.incomingTotal.weightGb).toBe(23);
    expect(balance.outgoingTotal.weightGb).toBe(15);
    expect(balance.net.weightGb).toBe(108);
  });

  it("never lets a memo item into the net", () => {
    // 10 baht packed and shipped is already out of the 100 on hand; subtracting it again would
    // report 90 for a vault that holds 100 with nothing else owed
    const balance = buildGoldBalance(
      [row({ domain: "WHOLESALE_SELL", status: "SHIPPED", weightGb: 10 })],
      [pool({ totalWeightGb: 100 })],
    );
    expect(balance.memo.find((g) => g.key === "WS_AWAIT_CASH")?.weightGb).toBe(10);
    expect(balance.net.weightGb).toBe(100);
  });

  it("ignores settled deals entirely", () => {
    const balance = buildGoldBalance(
      [
        row({ domain: "WHOLESALE_BUY", status: "STOCKED" }),
        row({ domain: "WHOLESALE_BUY", status: "CANCELLED" }),
        row({ domain: "WHOLESALE_SELL", status: "PAID" }),
      ],
      [],
    );
    expect(balance.incomingTotal.count).toBe(0);
    expect(balance.outgoingTotal.count).toBe(0);
    expect(balance.memo.every((g) => g.count === 0)).toBe(true);
  });

  it("groups a bucket's deals by status, in the bucket's own order", () => {
    const balance = buildGoldBalance(
      [
        row({ id: "1", status: "PAYMENT_FAILED", statusLabel: "ชำระเงินไม่สำเร็จ", weightGb: 5 }),
        row({ id: "2", status: "CONFIRMED", statusLabel: "ยืนยันแล้ว", weightGb: 10 }),
        row({ id: "3", status: "CONFIRMED", statusLabel: "ยืนยันแล้ว", weightGb: 10 }),
      ],
      [],
    );
    const group = balance.incoming.find((g) => g.key === "WB_AWAIT_PAYMENT")!;
    expect(group.lines.map((l) => [l.status, l.count, l.weightGb])).toEqual([
      ["CONFIRMED", 2, 20],
      ["PAYMENT_FAILED", 1, 5],
    ]);
    expect(group.weightGb).toBe(25);
    expect(group.label).toBe("ซื้อส่ง · รอชำระเงิน");
  });

  it("returns every bucket even when nothing is waiting", () => {
    // "0 owed out" is an answer; a line item that disappears reads as a broken sheet
    const balance = buildGoldBalance([], []);
    expect(balance.incoming.length + balance.outgoing.length + balance.memo.length).toBe(BALANCE_BUCKETS.length);
    expect(balance.net.weightGb).toBe(0);
  });

  it("sums the on-hand pools by product type, across brands", () => {
    const balance = buildGoldBalance([], [
      pool({ brandId: "HSH", productTypeId: "BAR", totalWeightGb: 30, totalCost: 1_400_000 }),
      pool({ brandId: "NA", productTypeId: "BAR", totalWeightGb: 20, totalCost: 950_000 }),
      pool({ brandId: "NA", productTypeId: "SHEET", totalWeightGb: 5, totalCost: 240_000 }),
    ]);
    expect(balance.physical).toEqual([
      expect.objectContaining({ productTypeId: "BAR", weightGb: 50, cost: 2_350_000 }),
      expect.objectContaining({ productTypeId: "SHEET", weightGb: 5, cost: 240_000 }),
    ]);
    expect(balance.physicalTotal.weightGb).toBe(55);
  });
});
