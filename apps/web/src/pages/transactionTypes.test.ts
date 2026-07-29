import { describe, it, expect } from "vitest";
import { GAIN_TRANSACTION_TYPES, LOSS_TRANSACTION_TYPES, TRANSACTION_TYPES } from "@gold-platform/types";

describe("GAIN_TRANSACTION_TYPES", () => {
  it("only includes types directioned 'gain' or 'both'", () => {
    for (const t of GAIN_TRANSACTION_TYPES) {
      expect(["gain", "both"]).toContain(t.direction);
    }
  });

  it("excludes loss-only and direction-less types", () => {
    const values = GAIN_TRANSACTION_TYPES.map((t) => t.value);
    expect(values).not.toContain("WHOLESALE_SELL");
    expect(values).not.toContain("RETAIL_SELL");
    expect(values).not.toContain("CONVERT_OUT");
    expect(values).not.toContain("DAMAGE");
    expect(values).not.toContain("LOST");
    expect(values).not.toContain("PRODUCT_SWITCH");
  });

  it("includes gain-direction and shared types", () => {
    const values = GAIN_TRANSACTION_TYPES.map((t) => t.value);
    expect(values).toEqual(
      expect.arrayContaining([
        "WHOLESALE_BUY",
        "RETAIL_BUY",
        "RECEIVED",
        "SMELTING",
        "STOCK_COUNT",
        "MANUAL_CORRECTION",
      ])
    );
  });
});

describe("LOSS_TRANSACTION_TYPES", () => {
  it("only includes types directioned 'loss' or 'both'", () => {
    for (const t of LOSS_TRANSACTION_TYPES) {
      expect(["loss", "both"]).toContain(t.direction);
    }
  });

  it("excludes gain-only and direction-less types", () => {
    const values = LOSS_TRANSACTION_TYPES.map((t) => t.value);
    expect(values).not.toContain("WHOLESALE_BUY");
    expect(values).not.toContain("RETAIL_BUY");
    expect(values).not.toContain("RECEIVED");
    expect(values).not.toContain("SMELTING");
    expect(values).not.toContain("PRODUCT_SWITCH");
  });

  it("includes loss-direction and shared types", () => {
    const values = LOSS_TRANSACTION_TYPES.map((t) => t.value);
    expect(values).toEqual(
      expect.arrayContaining([
        "WHOLESALE_SELL",
        "RETAIL_SELL",
        "CONVERT_OUT",
        "DAMAGE",
        "LOST",
        "STOCK_COUNT",
        "MANUAL_CORRECTION",
      ])
    );
  });
});

describe("GAIN_TRANSACTION_TYPES / LOSS_TRANSACTION_TYPES coverage", () => {
  it("together cover every directioned transaction type exactly once per direction", () => {
    const both = TRANSACTION_TYPES.filter((t) => t.direction === "both").map((t) => t.value);
    const gainValues: string[] = GAIN_TRANSACTION_TYPES.map((t) => t.value);
    const lossValues: string[] = LOSS_TRANSACTION_TYPES.map((t) => t.value);

    for (const value of both) {
      expect(gainValues).toContain(value);
      expect(lossValues).toContain(value);
    }

    // PRODUCT_SWITCH is the only type with no direction — it must appear in neither dropdown.
    expect(gainValues).not.toContain("PRODUCT_SWITCH");
    expect(lossValues).not.toContain("PRODUCT_SWITCH");
  });
});
