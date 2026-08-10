import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    expectFailure, expectSuccess, loggedStatuses, makeFakeSellRepo, sellTransaction,
} from "../../../test/fakes.js";
import type { WholeSellTransactionShape } from "../../../infrastructure/db/schema/wholesale-sell.schema.js";

// Same three seams as the buy suite, and the same lazy-read requirement on the repository holder:
// `wholeSellLive` is built once at module load, so the factory must defer reading it.
const holder = vi.hoisted(() => ({ repo: undefined as unknown }));

vi.mock("../adapter/wholesale-sell.repository.js", async () => {
    const { Effect } = await import("effect");
    return { makeWholeSellRepository: Effect.sync(() => holder.repo) };
});

vi.mock("../../inventory/application/inventory.usecase.js", async () => {
    const { Effect } = await import("effect");
    return {
        increment: vi.fn(() => Effect.void),
        decrement: vi.fn(() => Effect.void),
        reverseDecrement: vi.fn(() => Effect.void),
    };
});

vi.mock("../../../infrastructure/quantity.js", async () => {
    const { Effect } = await import("effect");
    return {
        findQuantityRule: vi.fn(() =>
            Effect.succeed({ inputUnit: "gb", minQuantity: 1, allowedValues: null })),
        resolveQuantity: vi.fn(() =>
            Effect.succeed({ weightGb: 12, weightGm: 182.4, conversionFactor: 15.2, unitOfMeasure: "gb" })),
        resolveMeasuredQuantity: vi.fn((_p: string, _q: string, weight: number) =>
            Effect.succeed({ weightGb: weight, weightGm: weight * 15.2, conversionFactor: 15.2, unitOfMeasure: "gb" })),
        ProductTypePurityNotFoundError: class {},
        InvalidQuantityError: class {},
    };
});

let repoState: ReturnType<typeof makeFakeSellRepo>["state"];

const { decrement, reverseDecrement } = await import("../../inventory/application/inventory.usecase.js");
const { advanceStatus } = await import("./wholesale-sell.usecase.js");

function given(overrides: Partial<WholeSellTransactionShape> = {}) {
    const transaction = sellTransaction(overrides);
    const fake = makeFakeSellRepo(transaction);
    holder.repo = fake.repo;
    repoState = fake.state;
    return transaction;
}

const move = (id: string, req: Record<string, unknown>) =>
    advanceStatus({ transactionId: id, updatedBy: "tester", ...req } as never);

beforeEach(() => {
    vi.mocked(decrement).mockClear();
    vi.mocked(reverseDecrement).mockClear();
});

describe("transition guards", () => {
    it("refuses a move the transition map does not allow", async () => {
        const t = given({ currentStatus: "CREATED" });
        const error = await expectFailure(move(t.id, { toStatus: "SHIPPED" }));
        expect(error).toMatchObject({ _tag: "WholeSellInvalidTransitionError", from: "CREATED", to: "SHIPPED" });
        expect(repoState.statuses).toHaveLength(0);
        expect(decrement).not.toHaveBeenCalled();
    });

    it("refuses every failure branch without a note", async () => {
        for (const [from, to] of [
            ["CREATED", "CANCELLED"], ["CONFIRMED", "REJECTED"], ["SHIPPED", "DISPUTED"],
            ["SHIPPED", "PAYMENT_FAILED"], ["PAYMENT_FAILED", "WRITTEN_OFF"],
        ] as const) {
            const t = given({ currentStatus: from });
            const error = await expectFailure(move(t.id, { toStatus: to }));
            expect(error).toMatchObject({ _tag: "WholeSellNoteRequiredError", status: to });
        }
    });

    it("refuses a return with no reason", async () => {
        const t = given({ currentStatus: "SHIPPED" });
        const error = await expectFailure(move(t.id, { toStatus: "RETURNED", note: "ผู้ซื้อตีกลับ" }));
        expect(error).toMatchObject({ _tag: "WholeSellReturnReasonRequiredError", id: t.id });
        expect(reverseDecrement).not.toHaveBeenCalled();
    });

    it("allows cancelling after confirmation, before gold leaves the vault", async () => {
        // matches the buy side: nothing has moved yet, so our own mistake exits as CANCELLED
        // rather than being misreported as the buyer walking away
        for (const from of ["CREATED", "CONFIRMED"] as const) {
            const t = given({ currentStatus: from });
            const result = await expectSuccess(move(t.id, { toStatus: "CANCELLED", note: "คีย์ผิด" }));
            expect(result).toEqual({ status: "CANCELLED" });
        }
    });

    it("offers no route home once the buyer has kept the gold and not paid", async () => {
        const t = given({ currentStatus: "PAYMENT_FAILED" });
        const error = await expectFailure(
            move(t.id, { toStatus: "RETURNED", note: "x", returnReason: "OTHER" }),
        );
        expect(error).toMatchObject({ _tag: "WholeSellInvalidTransitionError", from: "PAYMENT_FAILED" });
    });
});

describe("packing", () => {
    it("decrements once, with the agreed weight, always out of the foreign pool", async () => {
        const t = given({ currentStatus: "CONFIRMED" });
        await expectSuccess(move(t.id, { toStatus: "PACKED" }));

        expect(decrement).toHaveBeenCalledTimes(1);
        expect(vi.mocked(decrement).mock.calls[0][0]).toMatchObject({
            weightGb: t.weightGb,
            weightGm: t.weightGm,
            origin: "foreign",
            referenceType: "WHOLESALE_SELL",
            referenceId: t.id,
        });
    });

    it("takes no weight — we packed our own gold, so the agreement is what left", async () => {
        const t = given({ currentStatus: "CONFIRMED" });
        await expectSuccess(move(t.id, { toStatus: "PACKED", actualWeight: 11.95 }));

        expect(vi.mocked(decrement).mock.calls[0][0]).toMatchObject({ weightGb: t.weightGb });
        expect(repoState.transaction.actualWeightGb).toBeNull();
    });

    it("is a separate step from shipping, and only one of them moves stock", async () => {
        // the two used to be fused behind /pack-ship. Splitting them is what makes PACKED an
        // observable "ready to ship" state; the decrement did not move.
        const t = given({ currentStatus: "CONFIRMED" });
        await expectSuccess(move(t.id, { toStatus: "PACKED" }));
        await expectSuccess(move(t.id, { toStatus: "SHIPPED" }));

        expect(loggedStatuses(repoState.statuses)).toEqual(["PACKED", "SHIPPED"]);
        expect(decrement).toHaveBeenCalledTimes(1);
    });

    it("records no status when the pool is short", async () => {
        vi.mocked(decrement).mockReturnValueOnce(
            Effect.fail({ _tag: "InsufficientStockError" }) as never,
        );
        const t = given({ currentStatus: "CONFIRMED" });

        await expectFailure(move(t.id, { toStatus: "PACKED" }));
        expect(repoState.statuses).toHaveLength(0);
        expect(repoState.transaction.currentStatus).toBe("CONFIRMED");
    });
});

describe("gold coming home", () => {
    it("reverses the decrement and records why, from every post-decrement state", async () => {
        for (const from of ["PACKED", "SHIPPED", "DISPUTED"] as const) {
            const t = given({ currentStatus: from });
            await expectSuccess(
                move(t.id, { toStatus: "RETURNED", note: "ผู้ซื้อปฏิเสธ", returnReason: "PURITY" }),
            );

            expect(repoState.transaction.returnReason).toBe("PURITY");
            expect(vi.mocked(reverseDecrement).mock.lastCall?.[0]).toMatchObject({
                originalReferenceType: "WHOLESALE_SELL",
                reverseReferenceType: "WHOLESALE_SELL_RETURN",
                originalReferenceId: t.id,
            });
        }
        expect(reverseDecrement).toHaveBeenCalledTimes(3);
    });
});

describe("the buyer's own figures", () => {
    it("records a contested weight on DISPUTED and moves no stock", async () => {
        const t = given({ currentStatus: "SHIPPED" });
        await expectSuccess(move(t.id, { toStatus: "DISPUTED", note: "ผู้ซื้อชั่งได้น้อยกว่า", actualWeight: 11.9 }));

        expect(repoState.transaction.actualWeightGb).toBe(11.9);
        expect(decrement).not.toHaveBeenCalled();
        expect(reverseDecrement).not.toHaveBeenCalled();
    });

    it("records a settlement that came up short and closed anyway", async () => {
        const t = given({ currentStatus: "SHIPPED" });
        await expectSuccess(move(t.id, { toStatus: "PAID", settledAmount: 578000 }));
        expect(repoState.transaction.settledAmount).toBe(578000);
    });

    it("clears a stale variance when a chased payment settles in full", async () => {
        const t = given({ currentStatus: "PAYMENT_FAILED", settledAmount: 100000 });
        await expectSuccess(move(t.id, { toStatus: "PAID" }));
        expect(repoState.transaction.settledAmount).toBeNull();
    });
});
