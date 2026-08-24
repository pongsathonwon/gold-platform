import { beforeEach, describe, expect, it, vi } from "vitest";
import { todayBusinessDate } from "@gold-platform/types";
import {
    expectFailure, expectSuccess, loggedStatuses, makeFakeRetailBuyRepo, retailBuyTransaction,
} from "../../../test/fakes.js";
import { resolveSettlementPeriodOn } from "../../../infrastructure/settlement.js";
import type { RetailBuyTransactionShape } from "../../../infrastructure/db/schema/retail-buy.schema.js";

// Two seams, one fewer than wholesale needs: retail has no brand split to stub out.
//
// The repository holder has to be `vi.hoisted` and read **lazily**: `retailBuyLive` is built once
// at module load, so a factory returning `Effect.succeed(holder.repo)` would capture whatever the
// holder held then — undefined — for every test. `Effect.sync` defers the read to run time.
const holder = vi.hoisted(() => ({ repo: undefined as unknown }));

vi.mock("../adapter/retail-buy.repository.js", async () => {
    const { Effect } = await import("effect");
    return { makeRetailBuyRepository: Effect.sync(() => holder.repo) };
});

// Mocked so the suite can assert retail calls *none* of it. That is the property that keeps the
// balance honest: stock is adjusted by hand, and a retail write-up must never move a pool.
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
const { resolveMeasuredQuantity, resolveQuantity } = await import("../../../infrastructure/quantity.js");
const { advanceStatus, createTransaction } = await import("./retail-buy.usecase.js");

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

const move = (id: string, req: { toStatus: string; note?: string }) =>
    advanceStatus({ transactionId: id, updatedBy: "tester", ...req } as never);

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

    it("records no brand", async () => {
        const created = await expectSuccess(create());

        // Brand keys an inventory pool and retail touches none, so there is nothing for it to mean.
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

    it("refuses to reopen a cancelled write-up", async () => {
        const t = given({ currentStatus: "CANCELLED" });

        const error = await expectFailure(move(t.id, { toStatus: "CONFIRMED" }));

        expect(error).toMatchObject({ _tag: "RetailBuyInvalidTransitionError" });
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

        // Nothing to unwind, because nothing was ever booked. Stock is corrected through
        // /inventory/gain|loss, where a human signs for it.
        for (const fn of Object.values(inventory)) expect(fn).not.toHaveBeenCalled();
    });
});
