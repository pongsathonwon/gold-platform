import { describe, it, expect } from "vitest";
import { displayWeight, isInvestmentGrade, weightUnitLabel } from "./purityDisplay";

describe("isInvestmentGrade", () => {
  it("reads the percent from master data, not an id", () => {
    expect(isInvestmentGrade({ percent: 99.9 })).toBe(true);
    expect(isInvestmentGrade({ percent: 96.5 })).toBe(false);
  });

  // The detail pages used `purityId === "999"`. A purity the shop renames, or a third grade,
  // silently reclassified the whole page — so an absent row must not read as investment grade.
  it("treats an unresolved purity as not investment grade", () => {
    expect(isInvestmentGrade(undefined)).toBe(false);
  });
});

describe("weightUnitLabel", () => {
  it("is kilograms for 99.9% and gold baht for 96.5%", () => {
    expect(weightUnitLabel(true)).toBe("กก.");
    expect(weightUnitLabel(false)).toBe("บาท");
  });
});

describe("displayWeight", () => {
  it("shows 96.5% in gold baht, untouched", () => {
    expect(displayWeight(false, { weightGb: 12, weightGm: 182.928 })).toBe(12);
  });

  // 99.9% is ordered in kilograms. Grams is the storage unit — the detail pages showed "2000 กรัม"
  // in the summary and "2 kg" in a dialog on the same screen, for the same gold.
  it("shows 99.9% in kilograms, never grams or gold baht", () => {
    expect(displayWeight(true, { weightGb: 131.2, weightGm: 2000 })).toBe(2);
  });

  it("is consistent between a transaction and its brand-split lines", () => {
    const transaction = { weightGb: 20, weightGm: 304.88 };
    const split = [
      { weightGb: 12, weightGm: 182.928 },
      { weightGb: 8, weightGm: 121.952 },
    ];
    const total = split.reduce((sum, line) => sum + displayWeight(false, line), 0);
    expect(total).toBeCloseTo(displayWeight(false, transaction), 9);
  });

  it("keeps a variance in the same unit as the figure it compares", () => {
    const ordered = { weightGb: 131.2, weightGm: 2000 };
    const measured = { weightGb: 128.0, weightGm: 1950 };
    // both in kg — the bug was computing this leg in gold baht and labelling it บาท beside a
    // kilogram figure
    expect(displayWeight(true, measured) - displayWeight(true, ordered)).toBeCloseTo(-0.05, 9);
  });
});
