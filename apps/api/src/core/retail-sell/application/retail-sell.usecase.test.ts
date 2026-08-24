import { beforeEach, describe, expect, it, vi } from "vitest";
import { todayBusinessDate } from "@gold-platform/types";
import {
    expectFailure, expectSuccess, loggedStatuses, makeFakeRetailSellRepo, retailSellTransaction,
} from "../../../test/fakes.js";
import { resolveSettlementPeriodOn } from "../../../infrastructure/settlement.js";
import type { RetailSellTransactionShape } from "../../../infrastructure/db/schema/retail-sell.schema.js";

// See retail-buy.usecase.test.ts for why the repository holder must be `vi.hoisted` and read
// through `Effect.sync` rather than `Effect.succeed`.
const holder = vi.hoisted(() => ({ repo: undefined as unknown }));

vi.mock("../adapter/retail-sell.repository.js", async () => {
    const { Effect } = await import("effect");
    return { makeRetailSellRepository: Effect.sync(() => holder.repo) };
});

// Mocked so the suite can assert retail calls *none* of it. This domain used to decrement stock on
// CONFIRMED → SHIPPED; that transition and its decrement are both gone, and these tests are what
// keep them gone.
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

let repoState: ReturnType<typeof makeFakeRetailSellRepo>["state"];

const inventory = await import("../../inventory/application/inventory.usecase.js");
const { resolveMeasuredQuantity, resolveQuantity } = await import("../../../infrastructure/quantity.js");
const { advanceStatus, createTransaction } = await import("./retail-sell.usecase.js");

function given(overrides: Partial<RetailSellTransactionShape> = {}) {
    const transaction = retailSellTransaction(overrides);
    const fake = makeFakeRetailSellRepo(transaction);
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
        pricePerGb: 51000,
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

        expect(loggedStatuses(repoState.statuses)).toEqual(["CONFIRMED"]);
    });

    it("prices the gold only, leaving ค่าบล็อค outside the total", async () => {
        const created = await expectSuccess(create({ weight: 5, pricePerGb: 51000, operationFee: 500 }));

        // 5 × 51,000. Folding the fee in would make a ทองแผ่น sale look like it fetched a better
        // price per gold baht than it did, which is the one figure this domain exists to report.
        expect(created.totalAmount).toBe(255_000);
        expect(created.operationFee).toBe(500);
    });

    it("takes the weight as measured, not as an orderable quantity", async () => {
        const created = await expectSuccess(create({ weight: 3.7 }));

        expect(created.weightGb).toBe(3.7);
        expect(resolveMeasuredQuantity).toHaveBeenCalled();
        expect(resolveQuantity).not.toHaveBeenCalled();
    });

    it("records no brand", async () => {
        const created = await expectSuccess(create());

        expect(created.brandId).toBeNull();
    });
});

describe("the picked business date and the insert timestamp", () => {
    it("defaults the business date to today when the operator does not pick one", async () => {
        const created = await expectSuccess(create());

        expect(created.transactionDate).toBe(todayBusinessDate());
    });

    it("derives the settlement period from the picked date, not from the insert time", async () => {
        const created = await expectSuccess(create({ transactionDate: "2026-06-11" }));

        expect(created.settlementPeriod).toBe(resolveSettlementPeriodOn("2026-06-11"));
        expect(created.settlementPeriod).not.toBe(resolveSettlementPeriodOn(todayBusinessDate()));
    });
});

describe("transitions", () => {
    it("voids a confirmed write-up when a reason is given", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        const result = await expectSuccess(move(t.id, { toStatus: "CANCELLED", note: "ลูกค้าคืนของ" }));

        expect(result.currentStatus).toBe("CANCELLED");
        expect(repoState.transaction.currentStatus).toBe("CANCELLED");
    });

    it("refuses to void without a reason", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        const error = await expectFailure(move(t.id, { toStatus: "CANCELLED" }));

        expect(error).toMatchObject({ _tag: "RetailSellNoteRequiredError" });
        expect(repoState.statuses).toHaveLength(0);
    });

    it("refuses to ship, because shipping is not built", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        const error = await expectFailure(move(t.id, { toStatus: "SHIPPED" }));

        // SHIPPED survives in the database enum so restoring it later needs no migration, but it is
        // reachable from nothing. This is the test that fails loudly if someone re-adds the
        // transition without also restoring the inventory decrement it used to carry.
        expect(error).toMatchObject({ _tag: "RetailSellInvalidTransitionError" });
        expect(repoState.transaction.currentStatus).toBe("CONFIRMED");
    });

    it("refuses to reopen a cancelled write-up", async () => {
        const t = given({ currentStatus: "CANCELLED" });

        const error = await expectFailure(move(t.id, { toStatus: "CONFIRMED" }));

        expect(error).toMatchObject({ _tag: "RetailSellInvalidTransitionError" });
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

        for (const fn of Object.values(inventory)) expect(fn).not.toHaveBeenCalled();
    });
});
