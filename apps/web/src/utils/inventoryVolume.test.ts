import { describe, it, expect } from "vitest";
import {
  poolKey, weightOf, splitByPurity, wacRate, withCumulative,
  type VolumeRow, type MovementOpening,
} from "./inventoryVolume";

function row(overrides: Partial<VolumeRow> = {}): VolumeRow {
  return {
    purityId: "965",
    brandId: "brand-1",
    origin: "domestic",
    productTypeId: "BAR",
    totalWeightGb: 10,
    totalWeightGm: 152.4,
    totalCost: 62750,
    ...overrides,
  };
}

describe("poolKey", () => {
  it("joins the pool dimensions", () => {
    expect(poolKey(row())).toBe("965-brand-1-domestic-BAR");
  });
});

describe("weightOf", () => {
  it("returns totalWeightGb for the gb unit", () => {
    expect(weightOf(row({ totalWeightGb: 5 }), "gb")).toBe(5);
  });

  it("converts totalWeightGm to kg for the kg unit", () => {
    expect(weightOf(row({ totalWeightGm: 2000 }), "kg")).toBe(2);
  });
});

describe("wacRate", () => {
  it("divides totalCost by totalWeightGb", () => {
    expect(wacRate(row({ totalWeightGb: 10, totalCost: 62750 }))).toBe(6275);
  });

  it("returns 0 when totalWeightGb is 0 to avoid dividing by zero", () => {
    expect(wacRate(row({ totalWeightGb: 0, totalCost: 62750 }))).toBe(0);
  });
});

describe("withCumulative", () => {
  const mv = (purityId: string, gb: number, gm = 0) => ({ purityId, weightGbDelta: gb, weightGmDelta: gm });

  it("seeds the first row's balance from the purity opening", () => {
    const opening: MovementOpening[] = [{ purityId: "965", weightGb: 100, weightGm: 0 }];
    const [first] = withCumulative([mv("965", 5)], opening);
    expect(first.cumulativeWeightGb).toBe(105);
  });

  it("treats a missing opening as zero", () => {
    const [first] = withCumulative([mv("965", 5)], []);
    expect(first.cumulativeWeightGb).toBe(5);
  });

  it("runs a forward cumulative across mixed brands of one purity", () => {
    const rows = [mv("965", 5), mv("965", -2), mv("965", 3)];
    const result = withCumulative(rows, [{ purityId: "965", weightGb: 10, weightGm: 0 }]);
    expect(result.map((r) => r.cumulativeWeightGb)).toEqual([15, 13, 16]);
  });

  it("accumulates each purity independently", () => {
    const rows = [mv("965", 5, 0), mv("999", 0, 1000), mv("965", 1, 0), mv("999", 0, 500)];
    const opening: MovementOpening[] = [
      { purityId: "965", weightGb: 10, weightGm: 0 },
      { purityId: "999", weightGb: 0, weightGm: 2000 },
    ];
    const result = withCumulative(rows, opening);
    expect(result.map((r) => r.cumulativeWeightGb)).toEqual([15, 0, 16, 0]);
    expect(result.map((r) => r.cumulativeWeightGm)).toEqual([0, 3000, 0, 3500]);
  });

  it("returns no rows for an empty window (opening is the closing balance)", () => {
    expect(withCumulative([], [{ purityId: "965", weightGb: 10, weightGm: 0 }])).toEqual([]);
  });
});

describe("splitByPurity", () => {
  it("partitions rows into 96.5% and 99.9% buckets", () => {
    const rows = [
      row({ purityId: "965" }),
      row({ purityId: "999" }),
      row({ purityId: "965" }),
    ];

    const { nineSixFive, nineNineNine } = splitByPurity(rows, (r) => r.purityId === "999");

    expect(nineSixFive).toHaveLength(2);
    expect(nineNineNine).toHaveLength(1);
    expect(nineNineNine[0].purityId).toBe("999");
  });
});
