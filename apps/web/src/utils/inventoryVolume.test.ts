import { describe, it, expect } from "vitest";
import { poolKey, weightOf, splitByPurity, wacRate, type VolumeRow } from "./inventoryVolume";

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
