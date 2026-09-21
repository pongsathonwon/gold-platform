import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { todayBusinessDate } from "@gold-platform/types";
import {
    expectFailure, expectSuccess, loggedStatuses, makeFakeRetailBuyRepo, retailBuyTransaction,
} from "../../../test/fakes.js";
import { resolveSettlementPeriodOn } from "../../../infrastructure/settlement.js";
import type { RetailBuyTransactionShape } from "../../../infrastructure/db/schema/retail-buy.schema.js";

// Three seams, the same three wholesale needs: the repository, the inventory usecases, and the
// brand-split resolver (which reads purity and brand rows).
//
// The repository holder has to be `vi.hoisted` and read **lazily**: `retailBuyLive` is built once
// at module load, so a factory returning `Effect.succeed(holder.repo)` would capture whatever the
// holder held then — undefined — for every test. `Effect.sync` defers the read to run time.
const holder = vi.hoisted(() => ({ repo: undefined as unknown }));

vi.mock("../adapter/retail-buy.repository.js", async () => {
    const { Effect } = await import("effect");
    return { makeRetailBuyRepository: Effect.sync(() => holder.repo) };
});

// Spies, so the suite can assert exactly one move touches stock — STOCKED — and nothing else does.
vi.mock("../../inventory/application/inventory.usecase.js", async () => {
    const { Effect } = await import("effect");
    return {
        increment: vi.fn(() => Effect.void),
        incrementSplit: vi.fn(() => Effect.void),
        decrement: vi.fn(() => Effect.void),
        decrementSplit: vi.fn(() => Effect.void),
        reverseDecrement: vi.fn(() => Effect.void),
        findBrandSplitByReference: vi.fn(() => Effect.succeed([])),
    };
});

// The retail split resolver reads purity and brand rows. Its own rules live in
// infrastructure/brand-split.test.ts; here it is a pass-through so the transitions are what's
// under test.
vi.mock("../../../infrastructure/brand-split.js", async () => {
    const actual = await import("../../../infrastructure/brand-split.js");
    const { Effect } = await import("effect");
    return {
        ...actual,
        resolveRetailBrandSplit: vi.fn((req: { weightGb: number; weightGm: number }) =>
            Effect.succeed([{ brandId: "NA", weightGb: req.weightGb, weightGm: req.weightGm }])),
    };
});

// The weight resolver hits the DB for the product-type/purity pairing. `resolveMeasuredQuantity`
// echoes the weight back rather than returning a fixture, so a test can assert that what the
// operator typed is what got stored — the whole point of using the *measured* resolver here.
vi.mock("../../../infrastructure/quantity.js", async () => {
    const { Effect } = await import("effect");
    return {
        findQuantityRule: vi.fn(() =>
            Effect.succeed({ inputUnit: "gb", minQuantity: 1, allowedValues: null })),
        resolveQuantity: vi.fn(() =>
            Effect.succeed({ weightGb: 5, weightGm: 76, conversionFactor: 15.2, unitOfMeasure: "gb" })),
        resolveMeasuredQuantity: vi.fn((_p: string, _q: string, weight: number) =>
            Effect.succeed({ weightGb: weight, weightGm: weight * 15.2, conversionFactor: 15.2, unitOfMeasure: "gb" })),
        ProductTypePurityNotFoundError: class {},
        InvalidQuantityError: class {},
    };
});

let repoState: ReturnType<typeof makeFakeRetailBuyRepo>["state"];

const inventory = await import("../../inventory/application/inventory.usecase.js");
const { incrementSplit } = inventory;
const { resolveRetailBrandSplit } = await import("../../../infrastructure/brand-split.js");
const { resolveMeasuredQuantity, resolveQuantity } = await import("../../../infrastructure/quantity.js");
const { advanceStatus, createTransaction, getTransaction } = await import("./retail-buy.usecase.js");

function given(overrides: Partial<RetailBuyTransactionShape> = {}) {
    const transaction = retailBuyTransaction(overrides);
    const fake = makeFakeRetailBuyRepo(transaction);
    holder.repo = fake.repo;
    repoState = fake.state;
    return transaction;
}

const create = (req: Partial<Parameters<typeof createTransaction>[0]> = {}) =>
    createTransaction({
        branchCode: "HQ",
        purityId: "965",
        productTypeId: "BAR",
        weight: 5,
        pricePerGb: 49000,
        recordedBy: "tester",
        ...req,
    } as never);

const move = (
    id: string,
    req: { toStatus: string; note?: string; brandSplit?: { brandId: string; weight: number }[] },
) => advanceStatus({ transactionId: id, updatedBy: "tester", ...req } as never);

beforeEach(() => {
    vi.clearAllMocks();
    given();
});

describe("creating a write-up", () => {
    it("lands directly on CONFIRMED", async () => {
        const created = await expectSuccess(create());

        expect(created.currentStatus).toBe("CONFIRMED");
    });

    it("logs exactly one status row, and it is not a draft", async () => {
        await expectSuccess(create());

        // A DRAFT row would claim someone performed a step nobody performed. The trade was already
        // done before the form was opened.
        expect(loggedStatuses(repoState.statuses)).toEqual(["CONFIRMED"]);
    });

    it("prices the gold only, leaving the operating fee outside the total", async () => {
        const created = await expectSuccess(create({ weight: 5, pricePerGb: 49000, operationFee: 500 }));

        // 5 × 49,000 — the fee is stored beside it, never folded in, so this stays comparable
        // against wholesale (which has no fees) and the price-per-gold-baht average reads spread.
        expect(created.totalAmount).toBe(245_000);
        expect(created.operationFee).toBe(500);
    });

    it("stores no fee when none was charged", async () => {
        const created = await expectSuccess(create());

        expect(created.operationFee).toBeNull();
    });

    it("takes the weight as measured, not as an orderable quantity", async () => {
        // 3.7 GB is not a multiple of 5, so the BAR/965 step rule would refuse it. A customer's
        // gold weighs what it weighs.
        const created = await expectSuccess(create({ weight: 3.7 }));

        expect(created.weightGb).toBe(3.7);
        expect(resolveMeasuredQuantity).toHaveBeenCalled();
        expect(resolveQuantity).not.toHaveBeenCalled();
    });

    it("records no brand on the row", async () => {
        const created = await expectSuccess(create());

        // Brand is entered when the gold is put away, as a split across pools that lives in the
        // movement ledger — a single column could not hold "10 ฮั่วเซ่งเฮง + 10 อื่นๆ" anyway.
        expect(created.brandId).toBeNull();
    });

    it("marks the row as manually entered", async () => {
        const created = await expectSuccess(create());

        expect(created.source).toBe("MANUAL");
    });
});

describe("the picked business date and the insert timestamp", () => {
    it("defaults the business date to today when the operator does not pick one", async () => {
        const created = await expectSuccess(create());

        expect(created.transactionDate).toBe(todayBusinessDate());
    });

    it("derives the settlement period from the picked date, not from the insert time", async () => {
        // Thursday 11 June 2026 closes the period that Friday 5 June opened; the following day
        // opens a new one. A write-up entered today for last Thursday belongs to last week.
        const created = await expectSuccess(create({ transactionDate: "2026-06-11" }));

        expect(created.settlementPeriod).toBe(resolveSettlementPeriodOn("2026-06-11"));
        expect(created.settlementPeriod).not.toBe(resolveSettlementPeriodOn(todayBusinessDate()));
    });

    it("stamps recordedAt from the server clock regardless of the picked date", async () => {
        const created = await expectSuccess(create({ transactionDate: "2026-06-11" }));

        expect(created.recordedAt).toBeInstanceOf(Date);
        // the day it happened and the day it was written up are different facts
        expect(created.recordedAt.toISOString().slice(0, 10)).not.toBe("2026-06-11");
    });
});

describe("transitions", () => {
    it("voids a confirmed write-up when a reason is given", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        const result = await expectSuccess(move(t.id, { toStatus: "CANCELLED", note: "ลูกค้ายกเลิก" }));

        expect(result.currentStatus).toBe("CANCELLED");
        expect(repoState.transaction.currentStatus).toBe("CANCELLED");
        expect(repoState.statuses.at(-1)?.note).toBe("ลูกค้ายกเลิก");
    });

    it("refuses to void without a reason", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        const error = await expectFailure(move(t.id, { toStatus: "CANCELLED" }));

        // the row already counted toward a week's figures; "why is this week different" has to be
        // answerable from the log
        expect(error).toMatchObject({ _tag: "RetailBuyNoteRequiredError" });
        expect(repoState.statuses).toHaveLength(0);
    });

    it("refuses a blank reason as firmly as a missing one", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        const error = await expectFailure(move(t.id, { toStatus: "CANCELLED", note: "   " }));

        expect(error).toMatchObject({ _tag: "RetailBuyNoteRequiredError" });
    });

    it("puts a confirmed write-up into stock", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        const result = await expectSuccess(move(t.id, { toStatus: "STOCKED" }));

        expect(result.currentStatus).toBe("STOCKED");
        expect(repoState.transaction.currentStatus).toBe("STOCKED");
        expect(loggedStatuses(repoState.statuses)).toEqual(["STOCKED"]);
    });

    it("refuses to void once the gold is on the books", async () => {
        // Nothing reverses an increment here. A stocked write-up that turns out wrong is corrected
        // through a manual stock loss, exactly as a checked wholesale delivery is.
        const t = given({ currentStatus: "STOCKED" });

        const error = await expectFailure(move(t.id, { toStatus: "CANCELLED", note: "คีย์ผิด" }));

        expect(error).toMatchObject({ _tag: "RetailBuyInvalidTransitionError" });
        expect(repoState.transaction.currentStatus).toBe("STOCKED");
    });

    it("refuses to reopen a cancelled write-up", async () => {
        const t = given({ currentStatus: "CANCELLED" });

        const error = await expectFailure(move(t.id, { toStatus: "CONFIRMED" }));

        expect(error).toMatchObject({ _tag: "RetailBuyInvalidTransitionError" });
    });

    it("refuses to stock a cancelled write-up", async () => {
        const t = given({ currentStatus: "CANCELLED" });

        const error = await expectFailure(move(t.id, { toStatus: "STOCKED" }));

        expect(error).toMatchObject({ _tag: "RetailBuyInvalidTransitionError" });
        expect(incrementSplit).not.toHaveBeenCalled();
    });

    it("refuses to re-confirm an already confirmed write-up", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        const error = await expectFailure(move(t.id, { toStatus: "CONFIRMED" }));

        expect(error).toMatchObject({ _tag: "RetailBuyInvalidTransitionError" });
    });

    it("leaves the status untouched when a move is refused", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        await expectFailure(move(t.id, { toStatus: "CONFIRMED" }));

        expect(repoState.transaction.currentStatus).toBe("CONFIRMED");
    });
});

describe("inventory", () => {
    it("moves no stock when a write-up is created", async () => {
        await expectSuccess(create());

        for (const fn of Object.values(inventory)) expect(fn).not.toHaveBeenCalled();
    });

    it("moves no stock when a write-up is voided", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        await expectSuccess(move(t.id, { toStatus: "CANCELLED", note: "คีย์ผิด" }));

        // Nothing to unwind, because nothing was ever booked — the gold enters on STOCKED, and a
        // void is only reachable before it.
        for (const fn of Object.values(inventory)) expect(fn).not.toHaveBeenCalled();
    });

    it("increments the transaction's weight at the transaction's cost on STOCKED", async () => {
        const t = given({
            currentStatus: "CONFIRMED", weightGb: 20, weightGm: 304, totalAmount: 980_000, operationFee: 500,
        });

        await expectSuccess(move(t.id, { toStatus: "STOCKED" }));

        expect(incrementSplit).toHaveBeenCalledTimes(1);
        const req = vi.mocked(incrementSplit).mock.calls[0][0];
        expect(req).toMatchObject({
            purityId: t.purityId,
            productTypeId: t.productTypeId,
            // a customer's gold never enters the domestic pool — only smelting makes domestic stock
            origin: "foreign",
            referenceType: "RETAIL_BUY",
            referenceId: t.id,
            movedBy: "tester",
        });
        // what was paid for the gold follows it into the pool — and only that: the fee is not
        // part of the cost of the metal and stays out of the average
        expect(req.brands).toEqual([{ brandId: "NA", weightGb: 20, weightGm: 304, totalCost: 980_000 }]);
    });

    it("books one movement per brand, with the cost apportioned by weight", async () => {
        // 20 baht as 10 ฮั่วเซ่งเฮง + 10 อื่นๆ — the case the whole feature was asked for
        vi.mocked(resolveRetailBrandSplit).mockReturnValueOnce(
            Effect.succeed([
                { brandId: "HUA_GOLD", weightGb: 10, weightGm: 152 },
                { brandId: "NA", weightGb: 10, weightGm: 152 },
            ]) as never,
        );
        const t = given({ currentStatus: "CONFIRMED", weightGb: 20, weightGm: 304, totalAmount: 980_000 });

        await expectSuccess(move(t.id, { toStatus: "STOCKED", brandSplit: [{ brandId: "HUA_GOLD", weight: 10 }] }));

        // the split resolver is handed the transaction's own figures and the operator's lines
        expect(resolveRetailBrandSplit).toHaveBeenCalledWith({
            purityId: t.purityId,
            conversionFactor: t.conversionFactor,
            weightGb: 20,
            weightGm: 304,
            requested: [{ brandId: "HUA_GOLD", weight: 10 }],
        });
        const { brands } = vi.mocked(incrementSplit).mock.calls[0][0];
        expect(brands).toEqual([
            { brandId: "HUA_GOLD", weightGb: 10, weightGm: 152, totalCost: 490_000 },
            { brandId: "NA", weightGb: 10, weightGm: 152, totalCost: 490_000 },
        ]);
        // the pools reconstruct the write-up exactly
        expect(brands.reduce((sum, b) => sum + b.weightGb, 0)).toBe(20);
        expect(brands.reduce((sum, b) => sum + b.totalCost, 0)).toBe(980_000);
    });

    it("hands the whole weight to the fungible pool when no split is given", async () => {
        const t = given({ currentStatus: "CONFIRMED", weightGb: 5, weightGm: 76 });

        await expectSuccess(move(t.id, { toStatus: "STOCKED" }));

        expect(resolveRetailBrandSplit).toHaveBeenCalledWith(expect.objectContaining({ requested: [] }));
    });

    it("runs the increment before the status row, so a refused split logs nothing", async () => {
        const { BrandSplitExceedsWeightError } = await import("../../../infrastructure/brand-split.js");
        vi.mocked(resolveRetailBrandSplit).mockReturnValueOnce(
            Effect.fail(new BrandSplitExceedsWeightError({ named: 21, total: 20 })) as never,
        );
        const t = given({ currentStatus: "CONFIRMED", weightGb: 20, weightGm: 304 });

        const error = await expectFailure(move(t.id, { toStatus: "STOCKED", brandSplit: [{ brandId: "HUA_GOLD", weight: 21 }] }));

        expect(error).toMatchObject({ _tag: "BrandSplitExceedsWeightError" });
        expect(incrementSplit).not.toHaveBeenCalled();
        expect(repoState.transaction.currentStatus).toBe("CONFIRMED");
        expect(repoState.statuses).toHaveLength(0);
    });

    it("leaves the write-up CONFIRMED when the increment itself fails", async () => {
        const { RepositoryError } = await import("../../../infrastructure/db/client.js");
        vi.mocked(incrementSplit).mockReturnValueOnce(
            Effect.fail(new RepositoryError({ message: "db down" })) as never,
        );
        const t = given({ currentStatus: "CONFIRMED" });

        await expectFailure(move(t.id, { toStatus: "STOCKED" }));

        expect(repoState.transaction.currentStatus).toBe("CONFIRMED");
        expect(repoState.statuses).toHaveLength(0);
    });

    it("reads the recorded split back off the ledger on the detail", async () => {
        const t = given({ currentStatus: "STOCKED" });
        vi.mocked(inventory.findBrandSplitByReference).mockReturnValueOnce(
            Effect.succeed([{ brandId: "HUA_GOLD", weightGb: 10, weightGm: 152 }]) as never,
        );

        const detail = await expectSuccess(getTransaction(t.id));

        expect(inventory.findBrandSplitByReference).toHaveBeenCalledWith("RETAIL_BUY", t.id);
        expect(detail.brandSplit).toEqual([{ brandId: "HUA_GOLD", weightGb: 10, weightGm: 152 }]);
    });
});
