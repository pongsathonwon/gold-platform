import { describe, expect, it } from "vitest";
import { apportionCost, brandSplitHttpError, divideWeight, type DivideWeightReq } from "./brand-split.js";

/**
 * `divideWeight` is the whole brand rule with the database lifted out of it, so these tests are
 * about the one property the rule exists to guarantee: **the lines always add back up to the
 * transaction.** Brand decides which pools move. It can never decide how much does.
 */

// a 12 GB order, the same figures the wholesale fakes use
const base: DivideWeightReq = {
    supplierId: "supplier-1",
    purityId: "965",
    conversionFactor: 15.2,
    weightGb: 12,
    weightGm: 182.4,
    requested: [],
    keyedByOrigin: false,
    brandLock: false,
    registered: ["HUA_GOLD"],
};

const divide = (overrides: Partial<DivideWeightReq> = {}) => divideWeight({ ...base, ...overrides });

/** The invariant, asserted the same way everywhere: the split reconstructs the transaction. */
function expectReconstructs(req: DivideWeightReq) {
    const result = divide(req);
    if (!result.ok) throw new Error(`expected a split, got ${result.error._tag}`);
    expect(result.split.reduce((sum, s) => sum + s.weightGb, 0)).toBeCloseTo(req.weightGb, 6);
    expect(result.split.reduce((sum, s) => sum + s.weightGm, 0)).toBeCloseTo(req.weightGm, 6);
    return result.split;
}

describe("the fungible pool takes whatever is left", () => {
    it("sends the whole weight to NA when nothing is named", () => {
        expect(expectReconstructs(base)).toEqual([{ brandId: "NA", weightGb: 12, weightGm: 182.4 }]);
    });

    it("splits a named portion off and leaves the rest to NA", () => {
        const split = expectReconstructs({ ...base, requested: [{ brandId: "HUA_GOLD", weight: 8 }] });
        expect(split).toEqual([
            { brandId: "HUA_GOLD", weightGb: 8, weightGm: 121.6 },
            { brandId: "NA", weightGb: 4, weightGm: 60.8 },
        ]);
    });

    it("books no residual line when the named portion is the whole order", () => {
        // a zero-weight movement is noise in the ledger, not information
        const split = expectReconstructs({ ...base, requested: [{ brandId: "HUA_GOLD", weight: 12 }] });
        expect(split).toEqual([{ brandId: "HUA_GOLD", weightGb: 12, weightGm: 182.4 }]);
    });

    it("merges two lines naming the same brand rather than rejecting them", () => {
        const split = expectReconstructs({
            ...base,
            requested: [{ brandId: "HUA_GOLD", weight: 5 }, { brandId: "HUA_GOLD", weight: 3 }],
        });
        expect(split[0]).toEqual({ brandId: "HUA_GOLD", weightGb: 8, weightGm: 121.6 });
    });

    it("reconstructs the stored grams exactly even when the factor does not divide evenly", () => {
        // the residual is taken by subtraction, not by reconverting — reconversion would leave the
        // pools a fraction of a gram off the weight the transaction actually recorded
        const split = expectReconstructs({
            ...base,
            conversionFactor: 15.244,
            weightGb: 7,
            weightGm: 106.708,
            requested: [{ brandId: "HUA_GOLD", weight: 2.5 }],
        });
        expect(split.reduce((sum, s) => sum + s.weightGm, 0)).toBe(106.708);
    });
});

describe("what cannot be expressed", () => {
    it("refuses a split that comes to more than the transaction weight", () => {
        const result = divide({ requested: [{ brandId: "HUA_GOLD", weight: 13 }] });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatchObject({ _tag: "BrandSplitExceedsWeightError", named: 13, total: 12 });
    });

    it("refuses a brand the supplier does not deal in", () => {
        const result = divide({ requested: [{ brandId: "SOME_OTHER", weight: 4 }] });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatchObject({ _tag: "BrandNotSuppliedError", brandId: "SOME_OTHER" });
    });
});

describe("a brand-locked supplier", () => {
    it("gives its single registered brand the whole weight", () => {
        const split = expectReconstructs({ ...base, brandLock: true });
        expect(split).toEqual([{ brandId: "HUA_GOLD", weightGb: 12, weightGm: 182.4 }]);
    });

    it("refuses a split rather than accepting one it cannot ship", () => {
        const result = divide({ brandLock: true, requested: [{ brandId: "HUA_GOLD", weight: 4 }] });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatchObject({ _tag: "BrandSplitNotApplicableError", reason: "brand-locked" });
    });

    it("refuses to guess when its registered brands are not exactly one", () => {
        for (const registered of [[], ["HUA_GOLD", "OTHER"]]) {
            const result = divide({ brandLock: true, registered });
            expect(result.ok).toBe(false);
            if (result.ok) continue;
            expect(result.error._tag).toBe("BrandLockMisconfiguredError");
        }
    });
});

describe("99.9%, whose pools are keyed by origin", () => {
    it("puts everything in the sentinel pool", () => {
        const split = expectReconstructs({ ...base, keyedByOrigin: true, purityId: "999" });
        expect(split).toEqual([{ brandId: "NA", weightGb: 12, weightGm: 182.4 }]);
    });

    it("refuses a split, because brand is not a dimension of those pools", () => {
        const result = divide({ keyedByOrigin: true, requested: [{ brandId: "HUA_GOLD", weight: 4 }] });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatchObject({ reason: "purity-keyed-by-origin" });
    });
});

describe("apportioning the money across the split", () => {
    it("hands each pool its share and the last one the rounding", () => {
        const costed = apportionCost(
            [
                { brandId: "HUA_GOLD", weightGb: 8, weightGm: 121.6 },
                { brandId: "NA", weightGb: 4, weightGm: 60.8 },
            ],
            579000, 12,
        );
        expect(costed.map((c) => c.totalCost)).toEqual([386000, 193000]);
    });

    it("reconciles to the transaction total even when the share does not divide cleanly", () => {
        // three pools out of an amount that thirds badly — the sum still has to be the total,
        // because inventory cost is reconciled against the transaction, not re-derived from it
        const costed = apportionCost(
            [
                { brandId: "A", weightGb: 1, weightGm: 15.2 },
                { brandId: "B", weightGb: 1, weightGm: 15.2 },
                { brandId: "NA", weightGb: 1, weightGm: 15.2 },
            ],
            1000, 3,
        );
        expect(costed.reduce((sum, c) => sum + c.totalCost, 0)).toBe(1000);
    });
});

describe("one pool, one line", () => {
    /**
     * `inventory_movements` carries a unique index on (reference, pool), so a split that names the
     * same pool twice is no longer a cosmetic oddity — it is a booking the database refuses.
     *
     * NA is ordinarily the residual's home and nothing else, which is why this went unnoticed. But
     * registering NA in `suppler_brands` is a data change rather than a code change, and once it is
     * registered an operator can name it *and* leave a remainder.
     */
    it("folds the residual into an explicitly named NA line rather than adding a second", () => {
        const split = expectReconstructs({
            ...base,
            registered: ["HUA_GOLD", "NA"],
            requested: [{ brandId: "HUA_GOLD", weight: 5 }, { brandId: "NA", weight: 3 }],
        });
        // 5 named to HUA, 3 named to NA, 4 left over — the 4 joins the NA line, it does not open one
        expect(split).toHaveLength(2);
        expect(split.find((s) => s.brandId === "NA")?.weightGb).toBeCloseTo(7, 6);
        expect(split.find((s) => s.brandId === "HUA_GOLD")?.weightGb).toBeCloseTo(5, 6);
    });

    it("never emits a duplicate pool, whatever is named", () => {
        for (const requested of [
            [],
            [{ brandId: "HUA_GOLD", weight: 12 }],
            [{ brandId: "NA", weight: 12 }],
            [{ brandId: "NA", weight: 4 }],
            [{ brandId: "HUA_GOLD", weight: 4 }, { brandId: "NA", weight: 4 }],
            [{ brandId: "NA", weight: 2 }, { brandId: "NA", weight: 3 }],
        ]) {
            const split = expectReconstructs({ ...base, registered: ["HUA_GOLD", "NA"], requested });
            const brands = split.map((s) => s.brandId);
            expect(new Set(brands).size).toBe(brands.length);
        }
    });
});

/**
 * Retail runs the same rule with no counterparty: `supplierId` is null, `brandLock` is never set,
 * and `registered` is every active brand in the master data rather than a supplier's list. What has
 * to hold is unchanged — the lines reconstruct the transaction — plus one thing of its own: a
 * rejection must not blame a supplier that does not exist.
 */
describe("a retail split, which has no supplier", () => {
    const retail: DivideWeightReq = { ...base, supplierId: null, weightGb: 20, weightGm: 304 };

    it("books 20 baht as 10 of the stamped brand and 10 to the fungible pool", () => {
        const split = expectReconstructs({ ...retail, requested: [{ brandId: "HUA_GOLD", weight: 10 }] });
        expect(split).toEqual([
            { brandId: "HUA_GOLD", weightGb: 10, weightGm: 152 },
            { brandId: "NA", weightGb: 10, weightGm: 152 },
        ]);
    });

    it("sends everything to the fungible pool when nothing is named", () => {
        expect(expectReconstructs(retail)).toEqual([{ brandId: "NA", weightGb: 20, weightGm: 304 }]);
    });

    it("refuses 21 out of 20 rather than clamping it", () => {
        const result = divideWeight({ ...retail, requested: [{ brandId: "HUA_GOLD", weight: 21 }] });
        expect(result).toMatchObject({ ok: false, error: { _tag: "BrandSplitExceedsWeightError", named: 21, total: 20 } });
    });

    it("refuses a brand the master data does not carry, without naming a supplier", () => {
        const result = divideWeight({ ...retail, requested: [{ brandId: "AURORA", weight: 5 }] });
        if (result.ok) throw new Error("expected a refusal");
        expect(result.error).toMatchObject({ _tag: "BrandNotSuppliedError", supplierId: null, brandId: "AURORA" });
        expect(brandSplitHttpError(result.error)).toEqual(["brand AURORA is not an active brand", 422]);
    });

    it("still refuses any split on 99.9%", () => {
        const result = divideWeight({
            ...retail, keyedByOrigin: true, requested: [{ brandId: "HUA_GOLD", weight: 10 }],
        });
        expect(result).toMatchObject({ ok: false, error: { _tag: "BrandSplitNotApplicableError" } });
    });
});
