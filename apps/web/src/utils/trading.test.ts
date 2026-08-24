import { describe, it, expect } from "vitest";
import {
  byDomain, byPeriod, netPosition, spread, splitPurity, summarise,
  type TradingRow,
} from "./trading";

/**
 * The normalisation layer is where every domain rule lands, and where all three trading views read
 * from — so these tests are about the properties the views depend on: that an average is weighted,
 * that a missing side gives no answer rather than a zero, and that cash and gold move opposite ways.
 */

const row = (overrides: Partial<TradingRow> = {}): TradingRow => ({
  domain: "RETAIL_BUY",
  direction: "in",
  channel: "retail",
  id: "r1",
  transactionDate: "2026-08-24",
  settlementPeriod: "2026-W34",
  counterparty: "G000-สำนักงานใหญ่",
  purityId: "965",
  productTypeId: "BAR",
  weightGb: 10,
  weightGm: 152.44,
  pricePerGb: 48000,
  amount: 480_000,
  feeAmount: 0,
  status: "CONFIRMED",
  statusLabel: "ยืนยันแล้ว",
  countsTowardTotal: true,
  ...overrides,
});

describe("summarise", () => {
  it("weights the average by weight rather than averaging the row prices", () => {
    // 1 baht at 60,000 and 9 baht at 70,000. A plain mean says 65,000, which lets the 1-baht trade
    // pull as hard as the 9-baht one. The gold actually cost 69,000 a baht.
    const s = summarise([
      row({ weightGb: 1, amount: 60_000, pricePerGb: 60_000 }),
      row({ weightGb: 9, amount: 630_000, pricePerGb: 70_000 }),
    ]);
    expect(s.avgPricePerGb).toBe(69_000);
  });

  it("divides by gold baht even for a kilogram pool", () => {
    // 1 kg is 65.6 gold baht of mass. The average has to come back per gold baht to sit beside the
    // 96.5% figure; dividing by kilograms would print a number ~65× larger under the same heading.
    const s = summarise([
      row({ purityId: "999", weightGb: 65.5996, weightGm: 1000, amount: 4_263_974, pricePerGb: 65_000 }),
    ]);
    expect(s.avgPricePerGb).toBeCloseTo(65_000, 0);
  });

  it("has no average when nothing counted", () => {
    // not zero: a 0.00 in a price column claims the gold was free
    expect(summarise([row({ countsTowardTotal: false })]).avgPricePerGb).toBeNull();
    expect(summarise([]).avgPricePerGb).toBeNull();
  });

  it("counts excluded rows without letting them into the figures", () => {
    const s = summarise([
      row({ weightGb: 5, amount: 240_000 }),
      row({ weightGb: 4, amount: 200_000, countsTowardTotal: false }),
    ]);
    expect(s.count).toBe(1);
    expect(s.excluded).toBe(1);
    expect(s.weightGb).toBe(5);
    expect(s.amount).toBe(240_000);
  });

  it("keeps the fee out of the amount and the average", () => {
    const s = summarise([row({ weightGb: 10, amount: 480_000, feeAmount: 900 })]);
    expect(s.amount).toBe(480_000);
    expect(s.feeAmount).toBe(900);
    // 48,000 exactly — a fee folded in would read as 48,090 and overstate what the gold fetched
    expect(s.avgPricePerGb).toBe(48_000);
  });
});

describe("spread", () => {
  it("is the difference between what a gold baht cost and what it fetched", () => {
    const bought = summarise([row({ weightGb: 10, amount: 481_200, pricePerGb: 48_120 })]);
    const sold = summarise([row({ direction: "out", weightGb: 10, amount: 504_100, pricePerGb: 50_410 })]);
    expect(spread(bought, sold)).toBeCloseTo(2_290, 6);
  });

  it("is null when either side did not trade", () => {
    const traded = summarise([row()]);
    const idle = summarise([]);
    // "no spread" is the honest answer — 0 would read as breaking even, which is a claim about a
    // week in which one side of the business did nothing
    expect(spread(idle, traded)).toBeNull();
    expect(spread(traded, idle)).toBeNull();
    expect(spread(idle, idle)).toBeNull();
  });
});

describe("netPosition", () => {
  it("nets gold in against gold out", () => {
    const net = netPosition([
      row({ direction: "in", weightGb: 20 }),
      row({ direction: "out", weightGb: 15 }),
    ]);
    expect(net.inWeightGb).toBe(20);
    expect(net.outWeightGb).toBe(15);
    expect(net.netWeightGb).toBe(5);
  });

  it("moves cash the opposite way to gold", () => {
    // buying gold spends cash: gold up, cash down. Both true at once — they are independent
    // figures, not two views of one.
    const net = netPosition([row({ direction: "in", weightGb: 10, amount: 480_000 })]);
    expect(net.netWeightGb).toBe(10);
    expect(net.netCash).toBe(-480_000);
  });

  it("includes fees in net cash even though they are out of the averages", () => {
    // a fee is real money that changed hands; this is the one figure that wants the all-in number,
    // which is why the fee is stored beside the amount rather than inside it
    const net = netPosition([row({ direction: "out", amount: 500_000, feeAmount: 900 })]);
    expect(net.netCash).toBe(500_900);
  });

  it("ignores rows that do not count", () => {
    const net = netPosition([
      row({ direction: "in", weightGb: 10, amount: 480_000 }),
      row({ direction: "in", weightGb: 99, amount: 999_999, countsTowardTotal: false }),
    ]);
    expect(net.netWeightGb).toBe(10);
    expect(net.netCash).toBe(-480_000);
  });
});

describe("byPeriod", () => {
  it("groups by settlement period, newest first", () => {
    const grouped = byPeriod([
      row({ settlementPeriod: "2026-W33" }),
      row({ settlementPeriod: "2026-W34" }),
      row({ settlementPeriod: "2026-W33" }),
    ]);
    expect(grouped.map((g) => g.period)).toEqual(["2026-W34", "2026-W33"]);
    expect(grouped[1]?.rows).toHaveLength(2);
  });

  it("omits a period nothing fell into", () => {
    // the periods come from the rows, not a generated calendar. An empty row would claim the shop
    // was open and did nothing, which is not something this data knows.
    const grouped = byPeriod([row({ settlementPeriod: "2026-W34" }), row({ settlementPeriod: "2026-W32" })]);
    expect(grouped.map((g) => g.period)).toEqual(["2026-W34", "2026-W32"]);
  });

  it("returns nothing for an empty window", () => {
    expect(byPeriod([])).toEqual([]);
  });
});

describe("splitting and selecting", () => {
  const is999 = (purityId: string) => purityId === "999";

  it("never mixes the two pools", () => {
    const { nineSixFive, nineNineNine } = splitPurity(
      [row({ purityId: "965" }), row({ purityId: "999" }), row({ purityId: "965" })],
      is999,
    );
    expect(nineSixFive).toHaveLength(2);
    expect(nineNineNine).toHaveLength(1);
  });

  it("selects one domain out of the four", () => {
    const rows = [
      row({ domain: "RETAIL_BUY" }),
      row({ domain: "WHOLESALE_SELL", direction: "out", channel: "wholesale" }),
      row({ domain: "RETAIL_BUY" }),
    ];
    expect(byDomain(rows, "RETAIL_BUY")).toHaveLength(2);
    expect(byDomain(rows, "WHOLESALE_BUY")).toHaveLength(0);
  });
});

describe("the two pools are never mixed", () => {
  const is999 = (purityId: string) => purityId === "999";

  // The trading views summed gold baht across both purities during development, which reads as a
  // plausible weight and is not one: 45 baht of 96.5% metal plus 65.6 baht of 99.9% metal is 110.6
  // baht of nothing. Every weight and every average has to be scoped to one pool first.
  it("gives a different answer per pool than it does across both", () => {
    const rows = [
      row({ purityId: "965", weightGb: 45, amount: 3_195_000, pricePerGb: 71_000 }),
      row({ purityId: "999", weightGb: 65.6, weightGm: 1000, amount: 4_264_000, pricePerGb: 65_000 }),
    ];
    const { nineSixFive, nineNineNine } = splitPurity(rows, is999);

    expect(summarise(nineSixFive).weightGb).toBe(45);
    expect(summarise(nineNineNine).weightGm / 1000).toBeCloseTo(1, 6);

    // and the combined average is the number that must never reach a screen: it blends a 96.5%
    // quote with a 99.9% one, which are prices for two different grades of gold
    const blended = summarise(rows).avgPricePerGb!;
    expect(blended).not.toBeCloseTo(summarise(nineSixFive).avgPricePerGb!, 0);
    expect(blended).not.toBeCloseTo(summarise(nineNineNine).avgPricePerGb!, 0);
  });

  it("nets each pool independently", () => {
    const rows = [
      row({ purityId: "965", direction: "in", weightGb: 70 }),
      row({ purityId: "965", direction: "out", weightGb: 45 }),
      row({ purityId: "999", direction: "out", weightGb: 65.6, weightGm: 1000 }),
    ];
    const { nineSixFive, nineNineNine } = splitPurity(rows, is999);
    expect(netPosition(nineSixFive).netWeightGb).toBe(25);
    expect(netPosition(nineNineNine).netWeightGm / 1000).toBeCloseTo(-1, 6);
  });

  it("still combines cash across pools, which is the one figure that may be", () => {
    // money is money whatever grade of gold it bought — this is the model CONTEXT.md describes
    const rows = [
      row({ purityId: "965", direction: "in", amount: 4_940_000 }),
      row({ purityId: "999", direction: "out", amount: 4_264_000 }),
    ];
    expect(netPosition(rows).netCash).toBe(4_264_000 - 4_940_000);
  });
});
