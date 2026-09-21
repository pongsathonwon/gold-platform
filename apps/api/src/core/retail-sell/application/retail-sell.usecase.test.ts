import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
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

// Spies, so the suite can assert exactly one move touches stock — PACKED — and nothing else does.
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

vi.mock("../../../infrastructure/brand-split.js", async () => {
    const actual = await import("../../../infrastructure/brand-split.js");
    const { Effect } = await import("effect");
    return {
        ...actual,
        resolveRetailBrandSplit: vi.fn((req: { weightGb: number; weightGm: number }) =>
            Effect.succeed([{ brandId: "NA", weightGb: req.weightGb, weightGm: req.weightGm }])),
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
const { decrementSplit } = inventory;
const { resolveRetailBrandSplit } = await import("../../../infrastructure/brand-split.js");
const { resolveMeasuredQuantity, resolveQuantity } = await import("../../../infrastructure/quantity.js");
const { advanceStatus, createTransaction, getTransaction } = await import("./retail-sell.usecase.js");

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

const move = (
    id: string,
    req: { toStatus: string; note?: string; brandSplit?: { brandId: string; weight: number }[] },
) => advanceStatus({ transactionId: id, updatedBy: "tester", ...req } as never);

beforeEach(() => {
    vi.clearAllMocks();
    given();
});

describe("creating a write-up", () => {
    it("lands directly on CONFIRMED with one status row", async () => {
        const created = await expectSuccess(create());

        expect(created.currentStatus).toBe("CONFIRMED");
        expect(loggedStatuses(repoState.statuses)).toEqual(["CONFIRMED"]);
    });

    it("keeps ค่าบล็อค out of the total", async () => {
        const created = await expectSuccess(create({ weight: 2, pricePerGb: 51000, operationFee: 200 }));

        // 2 × 51,000. Folding the fee in would make a ทองแผ่น sale read as a better price per
        // gold baht than it achieved.
        expect(created.totalAmount).toBe(102_000);
        expect(created.operationFee).toBe(200);
    });

    it("takes the weight as measured, not as an orderable quantity", async () => {
        const created = await expectSuccess(create({ weight: 3.7 }));

        expect(created.weightGb).toBe(3.7);
        expect(resolveMeasuredQuantity).toHaveBeenCalled();
        expect(resolveQuantity).not.toHaveBeenCalled();
    });

    it("records no brand on the row", async () => {
        const created = await expectSuccess(create());

        // Brand is entered when the gold is pulled, as a split across pools in the ledger.
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

    it("packs a confirmed sale", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        const result = await expectSuccess(move(t.id, { toStatus: "PACKED" }));

        expect(result.currentStatus).toBe("PACKED");
        expect(repoState.transaction.currentStatus).toBe("PACKED");
        expect(loggedStatuses(repoState.statuses)).toEqual(["PACKED"]);
    });

    it("stops at PACKED for now — no ship, no void", async () => {
        // The hand-over states are not built, and neither is the return path that would put the
        // gold back. A mistaken pack is corrected through a manual stock gain until then.
        const t = given({ currentStatus: "PACKED" });

        expect(await expectFailure(move(t.id, { toStatus: "SHIPPED" })))
            .toMatchObject({ _tag: "RetailSellInvalidTransitionError" });
        expect(await expectFailure(move(t.id, { toStatus: "CANCELLED", note: "คีย์ผิด" })))
            .toMatchObject({ _tag: "RetailSellInvalidTransitionError" });
        expect(repoState.transaction.currentStatus).toBe("PACKED");
    });

    it("refuses to ship straight from CONFIRMED, because shipping is not built", async () => {
        const t = given({ currentStatus: "CONFIRMED" });

        const error = await expectFailure(move(t.id, { toStatus: "SHIPPED" }));

        // SHIPPED survives in the enum so building it later needs no migration, but it follows
        // PACKED when it comes — the decrement lives on PACKED, and SHIPPED must not move stock.
        expect(error).toMatchObject({ _tag: "RetailSellInvalidTransitionError" });
        expect(repoState.transaction.currentStatus).toBe("CONFIRMED");
        expect(decrementSplit).not.toHaveBeenCalled();
    });

    it("refuses to reopen a cancelled write-up", async () => {
        const t = given({ currentStatus: "CANCELLED" });

        const error = await expectFailure(move(t.id, { toStatus: "CONFIRMED" }));

        expect(error).toMatchObject({ _tag: "RetailSellInvalidTransitionError" });
    });

    it("refuses to pack a cancelled write-up", async () => {
        const t = given({ currentStatus: "CANCELLED" });

        const error = await expectFailure(move(t.id, { toStatus: "PACKED" }));

        expect(error).toMatchObject({ _tag: "RetailSellInvalidTransitionError" });
        expect(decrementSplit).not.toHaveBeenCalled();
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

    it("decrements the transaction's weight on PACKED, costed by the pool and not the sale", async () => {
        const t = given({ currentStatus: "CONFIRMED", weightGb: 5, weightGm: 76, totalAmount: 255_000 });

        await expectSuccess(move(t.id, { toStatus: "PACKED" }));

        expect(decrementSplit).toHaveBeenCalledTimes(1);
        const req = vi.mocked(decrementSplit).mock.calls[0][0];
        expect(req).toMatchObject({
            purityId: t.purityId,
            productTypeId: t.productTypeId,
            // a sale never draws on the domestic pool — only convert_out may
            origin: "foreign",
            referenceType: "RETAIL_SELL",
            referenceId: t.id,
            movedBy: "tester",
        });
        // totalAmount is revenue; the cost that leaves is the pool's own live WAC, decided inside
        // the inventory transaction, so nothing is sent from here
        expect(req.brands).toEqual([{ brandId: "NA", weightGb: 5, weightGm: 76, totalCost: 0 }]);
    });

    it("draws each named brand out of its own pool", async () => {
        vi.mocked(resolveRetailBrandSplit).mockReturnValueOnce(
            Effect.succeed([
                { brandId: "HUA_GOLD", weightGb: 10, weightGm: 152 },
                { brandId: "NA", weightGb: 10, weightGm: 152 },
            ]) as never,
        );
        const t = given({ currentStatus: "CONFIRMED", weightGb: 20, weightGm: 304 });

        await expectSuccess(move(t.id, { toStatus: "PACKED", brandSplit: [{ brandId: "HUA_GOLD", weight: 10 }] }));

        expect(resolveRetailBrandSplit).toHaveBeenCalledWith({
            purityId: t.purityId,
            conversionFactor: t.conversionFactor,
            weightGb: 20,
            weightGm: 304,
            requested: [{ brandId: "HUA_GOLD", weight: 10 }],
        });
        const { brands } = vi.mocked(decrementSplit).mock.calls[0][0];
        expect(brands).toEqual([
            { brandId: "HUA_GOLD", weightGb: 10, weightGm: 152, totalCost: 0 },
            { brandId: "NA", weightGb: 10, weightGm: 152, totalCost: 0 },
        ]);
    });

    it("leaves the sale CONFIRMED with nothing logged when a pool is short", async () => {
        const { InsufficientStockError } = await import("../../inventory/port/inventories.port.js");
        vi.mocked(decrementSplit).mockReturnValueOnce(
            Effect.fail(new InsufficientStockError({ requested: 5, available: 2 })) as never,
        );
        const t = given({ currentStatus: "CONFIRMED" });

        const error = await expectFailure(move(t.id, { toStatus: "PACKED" }));

        // the decrement runs before the status row for exactly this: a pack the vault could not
        // perform must not be logged as performed
        expect(error).toMatchObject({ _tag: "InsufficientStockError" });
        expect(repoState.transaction.currentStatus).toBe("CONFIRMED");
        expect(repoState.statuses).toHaveLength(0);
    });

    it("refuses a split that exceeds the sale before touching any pool", async () => {
        const { BrandSplitExceedsWeightError } = await import("../../../infrastructure/brand-split.js");
        vi.mocked(resolveRetailBrandSplit).mockReturnValueOnce(
            Effect.fail(new BrandSplitExceedsWeightError({ named: 6, total: 5 })) as never,
        );
        const t = given({ currentStatus: "CONFIRMED" });

        await expectFailure(move(t.id, { toStatus: "PACKED", brandSplit: [{ brandId: "HUA_GOLD", weight: 6 }] }));

        expect(decrementSplit).not.toHaveBeenCalled();
        expect(repoState.transaction.currentStatus).toBe("CONFIRMED");
    });

    it("reads the recorded split back off the ledger on the detail", async () => {
        const t = given({ currentStatus: "PACKED" });
        vi.mocked(inventory.findBrandSplitByReference).mockReturnValueOnce(
            Effect.succeed([{ brandId: "NA", weightGb: 5, weightGm: 76 }]) as never,
        );

        const detail = await expectSuccess(getTransaction(t.id));

        expect(inventory.findBrandSplitByReference).toHaveBeenCalledWith("RETAIL_SELL", t.id);
        expect(detail.brandSplit).toEqual([{ brandId: "NA", weightGb: 5, weightGm: 76 }]);
    });
});
