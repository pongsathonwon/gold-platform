import { describe, it, expect } from "vitest";
import { InvalidQuantityError, isValidQuantity, quantityErrorMessage } from "./quantity.js";

/**
 * The orderable-quantity rule, with no database anywhere near it — the same split as
 * `brand-split.test.ts`, where the rule is pure and only the lookups are an Effect.
 */

// what the seed defines for 96.5% gold bar: bars are 5/10/20/50 GB, so quantities step by 5
const goldBar965 = { minQuantity: 5, allowedValues: null, stepQuantity: 5 };
// ทองแผ่น is a sub-5-GB product, so it takes no step
const plate965 = { minQuantity: 1, allowedValues: null, stepQuantity: null };
// 99.9% bar is a closed list of kilogram sizes
const goldBar999 = { minQuantity: 1, allowedValues: [1, 2, 3, 4, 5], stepQuantity: null };

describe("isValidQuantity — 96.5% gold bar steps by 5", () => {
  it("accepts the multiples of 5 from the minimum up", () => {
    for (const w of [5, 10, 15, 20, 50, 500]) {
      expect(isValidQuantity(goldBar965, w)).toBe(true);
    }
  });

  it("rejects anything off the step", () => {
    for (const w of [6, 7, 11, 13, 21, 99]) {
      expect(isValidQuantity(goldBar965, w)).toBe(false);
    }
  });

  // A multiple of 5 that is still under the minimum is not rescued by being on the step.
  it("rejects zero and negatives even though both are multiples of 5", () => {
    expect(isValidQuantity(goldBar965, 0)).toBe(false);
    expect(isValidQuantity(goldBar965, -5)).toBe(false);
  });

  it("rejects fractions — these units are counted, not measured", () => {
    expect(isValidQuantity(goldBar965, 7.5)).toBe(false);
    expect(isValidQuantity(goldBar965, 5.0001)).toBe(false);
  });
});

describe("isValidQuantity — pairings with no step", () => {
  it("accepts any whole number at or above the minimum", () => {
    for (const w of [1, 2, 3, 4, 7, 13]) {
      expect(isValidQuantity(plate965, w)).toBe(true);
    }
  });

  it("still enforces the minimum", () => {
    expect(isValidQuantity(plate965, 0)).toBe(false);
  });
});

describe("isValidQuantity — allowedValues is the whole answer", () => {
  it("accepts only the listed values", () => {
    expect(isValidQuantity(goldBar999, 3)).toBe(true);
    expect(isValidQuantity(goldBar999, 6)).toBe(false);
  });

  // The closed list already says everything; a step alongside it would be a second rule to
  // disagree with the first.
  it("ignores a step when a list is present", () => {
    const listed = { minQuantity: 1, allowedValues: [3, 7], stepQuantity: 5 };
    expect(isValidQuantity(listed, 3)).toBe(true);
    expect(isValidQuantity(listed, 7)).toBe(true);
    expect(isValidQuantity(listed, 5)).toBe(false);
  });
});

describe("quantityErrorMessage", () => {
  const error = (over: Partial<ConstructorParameters<typeof InvalidQuantityError>[0]>) =>
    new InvalidQuantityError({
      weight: 7, minQuantity: 5, allowedValues: null, stepQuantity: null, inputUnit: "gb", ...over,
    });

  // The point of the step existing in the message: "at least 5" does not explain why 7 failed.
  it("names the step when there is one", () => {
    expect(quantityErrorMessage(error({ stepQuantity: 5 }))).toContain("เท่าของ 5");
  });

  it("names only the minimum when there is no step", () => {
    const msg = quantityErrorMessage(error({}));
    expect(msg).toContain("5");
    expect(msg).not.toContain("เท่าของ");
  });

  it("lists the allowed values when the pairing has a closed list", () => {
    expect(quantityErrorMessage(error({ allowedValues: [1, 2, 3] }))).toContain("1, 2, 3");
  });

  it("uses each pairing's own input unit", () => {
    expect(quantityErrorMessage(error({ inputUnit: "kg" }))).toContain("กก.");
    expect(quantityErrorMessage(error({ inputUnit: "gb" }))).toContain("บาททอง");
  });
});
