import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    buyTransaction, expectFailure, expectSuccess, loggedStatuses, makeFakeBuyRepo,
} from "../../../test/fakes.js";
import type { WholeBuyTransactionShape } from "../../../infrastructure/db/schema/wholesale-buy.schema.js";

// The three seams between this usecase and the outside world. Mocking them leaves the domain
// logic — the transition guards, which effect a move owns, the ordering between them — running
// exactly as it does in production, with no database anywhere.
//
// The repository holder has to be `vi.hoisted` and read **lazily**: `wholeBuyLive` is built once
// at module load, so a factory returning `Effect.succeed(holder.repo)` would capture whatever the
// holder held then — undefined — for every test. `Effect.sync` defers the read to run time.
const holder = vi.hoisted(() => ({ repo: undefined as unknown }));

vi.mock("../adapter/wholesale-buy.repository.js", async () => {
    const { Effect } = await import("effect");
    return { makeWholeBuyRepository: Effect.sync(() => holder.repo) };
});

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

// The brand split resolver reads supplier, purity and supplier-brand rows. Its own rules are
// tested directly against the pure `divideWeight` in infrastructure/brand-split.test.ts; here it
// stands in as a plain pass-through so the transition logic is what's under test.
vi.mock("../../../infrastructure/brand-split.js", async () => {
    const actual = await import("../../../infrastructure/brand-split.js");
    const { Effect } = await import("effect");
    return {
        ...actual,
        resolveBrandSplit: vi.fn((req: { weightGb: number; weightGm: number }) =>
            Effect.succeed([{ brandId: "NA", weightGb: req.weightGb, weightGm: req.weightGm }])),
    };
});

// the weight resolvers hit the DB for the product-type/purity rule; the numbers they return are
// not what these tests are about, so they are fixed
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

let repoState: ReturnType<typeof makeFakeBuyRepo>["state"];

const { incrementSplit } = await import("../../inventory/application/inventory.usecase.js");
const { advanceStatus, receiveAndStock } = await import("./wholesale-buy.usecase.js");

/** Puts a transaction in the fake repo and returns it, so each test starts from a known status. */
function given(overrides: Partial<WholeBuyTransactionShape> = {}) {
    const transaction = buyTransaction(overrides);
    const fake = makeFakeBuyRepo(transaction);
    holder.repo = fake.repo;
    repoState = fake.state;
    return transaction;
}

const move = (id: string, req: Record<string, unknown>) =>
    advanceStatus({ transactionId: id, updatedBy: "tester", ...req } as never);

beforeEach(() => {
    vi.mocked(incrementSplit).mockClear();
});

describe("transition guards", () => {
    it("refuses a move the transition map does not allow", async () => {
        const t = given({ currentStatus: "CREATED" });
        const error = await expectFailure(move(t.id, { toStatus: "STOCKED" }));
        expect(error).toMatchObject({ _tag: "WholeBuyInvalidTransitionError", from: "CREATED", to: "STOCKED" });
        // nothing is written when the guard rejects — the log must not record an attempt
        expect(repoState.statuses).toHaveLength(0);
        expect(repoState.transaction.currentStatus).toBe("CREATED");
    });

    it("refuses every failure branch without a note", async () => {
        for (const [from, to] of [
            ["CREATED", "CANCELLED"], ["CONFIRMED", "REJECTED"], ["CONFIRMED", "PAYMENT_FAILED"],
            ["PAID", "DELIVERY_FAILED"], ["RECEIVED", "DISPUTED"], ["RETURNED", "WRITTEN_OFF"],
            ["RETURNED", "REFUNDED"],
        ] as const) {
            const t = given({ currentStatus: from });
            const error = await expectFailure(move(t.id, { toStatus: to, returnReason: "WEIGHT" }));
            expect(error).toMatchObject({ _tag: "WholeBuyNoteRequiredError", status: to });
        }
    });

    it("treats a whitespace-only note as no note at all", async () => {
        const t = given({ currentStatus: "CREATED" });
        const error = await expectFailure(move(t.id, { toStatus: "CANCELLED", note: "   " }));
        expect(error).toMatchObject({ _tag: "WholeBuyNoteRequiredError" });
    });

    it("refuses a return with no reason, even when the note is there", async () => {
        // the note explains in prose; the reason is what makes supplier reliability countable,
        // which is the entire justification for keeping REJECTED separate from CANCELLED
        const t = given({ currentStatus: "PAID" });
        const error = await expectFailure(move(t.id, { toStatus: "RETURNED", note: "ยี่ห้อไม่ตรง" }));
        expect(error).toMatchObject({ _tag: "WholeBuyReturnReasonRequiredError", id: t.id });
        expect(repoState.statuses).toHaveLength(0);
    });

    it("reports an unknown transaction as not found", async () => {
        given();
        const error = await expectFailure(move("00000000-0000-0000-0000-000000000000", { toStatus: "CONFIRMED" }));
        expect(error).toMatchObject({ _tag: "WholeBuyTransactionNotFoundError" });
    });
});

describe("refusing a delivery at the door", () => {
    it("accepts PAID → RETURNED with a reason and records both", async () => {
        const t = given({ currentStatus: "PAID" });
        const result = await expectSuccess(
            move(t.id, { toStatus: "RETURNED", note: "ยี่ห้อไม่ตรงกับใบส่งของ", returnReason: "BRAND" }),
        );

        expect(result).toEqual({ status: "RETURNED" });
        expect(repoState.transaction.returnReason).toBe("BRAND");
        expect(loggedStatuses(repoState.statuses)).toEqual(["RETURNED"]);
        // refusing means never taking custody, so nothing can have entered stock
        expect(incrementSplit).not.toHaveBeenCalled();
    });

    it("keeps the return open until the money is accounted for", async () => {
        // RETURNED used to be terminal, which closed the transaction with our cash still at the
        // supplier and nothing in the record saying so
        for (const [to, extra] of [
            ["REFUNDED", {}], ["WRITTEN_OFF", {}], ["RECEIVED", {}],
        ] as const) {
            const t = given({ currentStatus: "RETURNED" });
            const result = await expectSuccess(move(t.id, { toStatus: to, note: "resolved", ...extra }));
            expect(result).toEqual({ status: to });
        }
    });
});

describe("accepting into stock", () => {
    it("increments once, with the ordered weight, always into the foreign pool", async () => {
        const t = given({ currentStatus: "RECEIVED" });
        await expectSuccess(move(t.id, { toStatus: "STOCKED" }));

        expect(incrementSplit).toHaveBeenCalledTimes(1);
        const call = vi.mocked(incrementSplit).mock.calls[0][0];
        expect(call).toMatchObject({
            origin: "foreign",
            referenceType: "WHOLESALE_BUY",
            referenceId: t.id,
        });
        // one call, however many pools it spans — the pools always reconstruct the order
        expect(call.brands.reduce((sum, b) => sum + b.weightGb, 0)).toBe(t.weightGb);
        expect(call.brands.reduce((sum, b) => sum + b.weightGm, 0)).toBe(t.weightGm);
        expect(call.brands.reduce((sum, b) => sum + b.totalCost, 0)).toBe(t.totalAmount);
    });

    it("takes no weight — a supplied one cannot change what enters stock", async () => {
        // the field used to exist here and could only ever hold the number already on the order,
        // so mistyping it diverted a good delivery into DISPUTED
        const t = given({ currentStatus: "RECEIVED" });
        await expectSuccess(move(t.id, { toStatus: "STOCKED", actualWeight: 11.95 }));

        const call = vi.mocked(incrementSplit).mock.calls[0][0];
        expect(call.brands.reduce((sum, b) => sum + b.weightGb, 0)).toBe(t.weightGb);
        expect(repoState.transaction.currentStatus).toBe("STOCKED");
        expect(repoState.transaction.actualWeightGb).toBeNull();
    });

    it("splits the order value across the pools it lands in, losing nothing", async () => {
        // brand decides which pools move, never how much does — a mixed delivery still books
        // exactly the ordered weight and exactly the order's value
        const { resolveBrandSplit } = await import("../../../infrastructure/brand-split.js");
        vi.mocked(resolveBrandSplit).mockReturnValueOnce(
            Effect.succeed([
                { brandId: "HUA_GOLD", weightGb: 8, weightGm: 121.6 },
                { brandId: "NA", weightGb: 4, weightGm: 60.8 },
            ]) as never,
        );

        const t = given({ currentStatus: "RECEIVED" });
        await expectSuccess(move(t.id, { toStatus: "STOCKED", brandSplit: [{ brandId: "HUA_GOLD", weight: 8 }] }));

        const { brands } = vi.mocked(incrementSplit).mock.calls[0][0];
        expect(brands.map((b) => b.brandId)).toEqual(["HUA_GOLD", "NA"]);
        expect(brands.reduce((sum, b) => sum + b.weightGb, 0)).toBe(t.weightGb);
        expect(brands.reduce((sum, b) => sum + b.totalCost, 0)).toBe(t.totalAmount);
    });

    it("clears a contested weight when a dispute is resolved by acceptance", async () => {
        // acceptance means the delivery matched, so a STOCKED transaction must never still show a
        // weight that disagrees with its order. The DISPUTED log entry keeps that history.
        const t = given({ currentStatus: "DISPUTED", actualWeightGb: 11.95, actualWeightGm: 181.64, actualAmount: 576587.5 });
        await expectSuccess(move(t.id, { toStatus: "STOCKED" }));

        expect(repoState.transaction.actualWeightGb).toBeNull();
        expect(repoState.transaction.actualWeightGm).toBeNull();
        expect(repoState.transaction.actualAmount).toBeNull();
    });
});

describe("disputing after custody has transferred", () => {
    it("records the contested weight and moves no stock", async () => {
        const t = given({ currentStatus: "RECEIVED" });
        await expectSuccess(move(t.id, { toStatus: "DISPUTED", note: "ชั่งได้ไม่ตรง", actualWeight: 11.95 }));

        expect(repoState.transaction.actualWeightGb).toBe(11.95);
        expect(incrementSplit).not.toHaveBeenCalled();
    });
});

describe("settled amount", () => {
    it("records a payment that differed from the order", async () => {
        const t = given({ currentStatus: "CONFIRMED" });
        await expectSuccess(move(t.id, { toStatus: "PAID", settledAmount: 578000 }));
        expect(repoState.transaction.settledAmount).toBe(578000);
    });

    it("clears a stale variance when a retry settles exactly", async () => {
        // a PAYMENT_FAILED attempt may have recorded a short figure; paying in full afterwards
        // must not leave it showing
        const t = given({ currentStatus: "PAYMENT_FAILED", settledAmount: 500000 });
        await expectSuccess(move(t.id, { toStatus: "PAID" }));
        expect(repoState.transaction.settledAmount).toBeNull();
    });
});

describe("receive + stock as one action", () => {
    it("writes both status rows, so splitting the steps later needs no migration", async () => {
        const t = given({ currentStatus: "PAID" });
        const result = await expectSuccess(
            receiveAndStock({ transactionId: t.id, updatedBy: "tester" }),
        );

        expect(result).toEqual({ status: "STOCKED" });
        expect(loggedStatuses(repoState.statuses)).toEqual(["RECEIVED", "STOCKED"]);
        expect(incrementSplit).toHaveBeenCalledTimes(1);
    });

    it("refuses from a status that cannot reach RECEIVED", async () => {
        const t = given({ currentStatus: "CREATED" });
        const error = await expectFailure(receiveAndStock({ transactionId: t.id, updatedBy: "tester" }));
        expect(error).toMatchObject({ _tag: "WholeBuyInvalidTransitionError", from: "CREATED" });
        expect(repoState.statuses).toHaveLength(0);
        expect(incrementSplit).not.toHaveBeenCalled();
    });
});

describe("ordering between the inventory hook and the status log", () => {
    it("records no status when the increment fails", async () => {
        // a movement that did not happen must never leave a log row claiming it did
        vi.mocked(incrementSplit).mockReturnValueOnce(
            Effect.fail({ _tag: "InsufficientStockError" }) as never,
        );
        const t = given({ currentStatus: "RECEIVED" });

        await expectFailure(move(t.id, { toStatus: "STOCKED" }));
        expect(repoState.statuses).toHaveLength(0);
        expect(repoState.transaction.currentStatus).toBe("RECEIVED");
    });
});
