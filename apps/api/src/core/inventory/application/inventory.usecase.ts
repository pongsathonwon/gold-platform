import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import { roundMoney, StockGainReq, StockLossReq, todayBusinessDate } from "@gold-platform/types";
import {
    DecrementReq, IncrementReq, InventoriesRepository, InventoryVolume, MovementEntry,
    MovementFilter, ProductSwitchReq, ProtectedOriginError, ReverseDecrementReq, SplitMovementReq,
} from "../port/inventories.port.js";
import { makeInventoryRepository } from "../adapter/inventory.repository.js";
import { resolveQuantity } from "../../../infrastructure/quantity.js";

const inventoryLive = Layer.effect(InventoriesRepository, makeInventoryRepository);

/**
 * Manual adjustments may only ever touch the foreign pool.
 *
 * Domestic stock is what the shop smelted itself — `smelting` creates it, `convert_out` consumes
 * it, and nothing else may write to it, or the pool stops meaning what it says. The gain and loss
 * forms used to offer the choice for 99.9%, so a stock count could silently drain gold the
 * business never smelted.
 */
const assertNotProtectedOrigin = (origin: 'domestic' | 'foreign') =>
    origin === 'domestic'
        ? Effect.fail(new ProtectedOriginError({ origin }))
        : Effect.void;

// --- Public usecases (HTTP) ---

export const getInventoryVolume = () =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const rows = yield* repo.listBalances();
        return rows.map((b): InventoryVolume => ({
            purityId: b.purityId,
            brandId: b.brandId,
            origin: b.origin,
            productTypeId: b.productTypeId,
            totalWeightGb: b.totalWeightGb,
            totalWeightGm: b.totalWeightGm,
            totalCost: b.totalCost,
        }));
    }).pipe(Effect.provide(inventoryLive))

/**
 * A manual gain, recorded against the day it belongs to.
 *
 * `transactionDate` is the day the operator says the discrepancy arose — today unless they pick
 * otherwise, since a correction is routinely written up after the count that found it. It dates
 * the adjustment record and the movement, so the ledger reads on the day the gold really turned up.
 *
 * **The balance still moves now.** Backdating documents an event, it does not replay one: cost is
 * averaged into the pool at today's balance whatever date the form carries, because that is when
 * the weight became available to sell. Retroactively re-averaging every WAC computed since would
 * mean rewriting movements that have already been costed and reported on.
 */
export const stockGain = (req: StockGainReq, auditedBy: string) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        yield* assertNotProtectedOrigin(req.origin);
        const adjustmentId = randomUUID();
        const brandId = req.brandId ?? 'NA';
        const transactionDate = req.transactionDate ?? todayBusinessDate();
        const { weightGb, weightGm, conversionFactor } = yield* resolveQuantity(req.productTypeId, req.purityId, req.weight);
        // operator enters price per gold baht (บาททอง); total cost is derived from the resolved GB weight
        const totalCost = roundMoney(req.pricePerGb * weightGb);

        // record, balance and ledger entry are three descriptions of one event, so they are
        // applied as one transaction — see `applyStockGain` in the repository
        yield* repo.applyStockGain({
            adjustment: {
                id: adjustmentId,
                purityId: req.purityId,
                brandId: req.brandId ?? null,
                origin: req.origin,
                productTypeId: req.productTypeId,
                weightGb,
                weightGm,
                conversionFactor,
                pricePerGb: req.pricePerGb,
                totalCost,
                referenceType: req.referenceType,
                notes: req.notes ?? null,
                transactionDate,
                auditedBy,
                // the insert instant, always the server's own clock — never the picked date
                auditedAt: new Date(),
            },
            balance: {
                purityId: req.purityId,
                brandId,
                origin: req.origin,
                productTypeId: req.productTypeId,
                totalWeightGb: weightGb,
                totalWeightGm: weightGm,
                totalCost,
            },
            movement: {
                id: randomUUID(),
                purityId: req.purityId,
                brandId,
                origin: req.origin,
                productTypeId: req.productTypeId,
                referenceType: req.referenceType,
                referenceId: adjustmentId,
                weightGbDelta: weightGb,
                weightGmDelta: weightGm,
                costDelta: totalCost,
                notes: req.notes ?? null,
                // the ledger carries the same business day as the adjustment, so the movement
                // report shows it under the day it happened rather than the day it was typed
                movementDate: transactionDate,
                movedAt: new Date(),
                movedBy: auditedBy,
            },
        });

        return { id: adjustmentId };
    }).pipe(Effect.provide(inventoryLive))

/**
 * A manual loss, recorded against the day it belongs to — the mirror of `stockGain`, including
 * the rule that matters: the picked date documents the event, the balance still moves now, and
 * the cost that leaves is the pool's live WAC at this moment, not at the backdated one.
 */
export const stockLoss = (req: StockLossReq, auditedBy: string) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        yield* assertNotProtectedOrigin(req.origin);
        const adjustmentId = randomUUID();
        const brandId = req.brandId ?? 'NA';
        const transactionDate = req.transactionDate ?? todayBusinessDate();
        const { weightGb, weightGm } = yield* resolveQuantity(req.productTypeId, req.purityId, req.weight);

        // The decrement runs first inside the transaction, so an insufficient-stock failure
        // aborts before any record is written. The cost removed comes from the pool's live WAC
        // under the lock, and is what the ledger entry carries.
        yield* repo.applyStockLoss({
            key: { purityId: req.purityId, brandId, origin: req.origin, productTypeId: req.productTypeId },
            weightGb,
            weightGm,
            adjustment: {
                id: adjustmentId,
                purityId: req.purityId,
                brandId: req.brandId ?? null,
                origin: req.origin,
                productTypeId: req.productTypeId,
                weightGb,
                weightGm,
                referenceType: req.referenceType,
                notes: req.notes ?? null,
                transactionDate,
                auditedBy,
                auditedAt: new Date(),
            },
            movement: {
                id: randomUUID(),
                purityId: req.purityId,
                brandId,
                origin: req.origin,
                productTypeId: req.productTypeId,
                referenceType: req.referenceType,
                referenceId: adjustmentId,
                weightGbDelta: -weightGb,
                weightGmDelta: -weightGm,
                notes: req.notes ?? null,
                movementDate: transactionDate,
                movedAt: new Date(),
                movedBy: auditedBy,
            },
        });

        return { id: adjustmentId };
    }).pipe(Effect.provide(inventoryLive))

export const getInventoryMovements = (filter: MovementFilter) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        // movements come back ascending by (movedAt, id); opening is the per-purity balance
        // strictly before filter.from — together they let the client run a forward cumulative
        const movements = yield* repo.listMovements(filter);
        const opening = yield* repo.sumMovementsBefore(filter);
        return { movements, opening };
    }).pipe(Effect.provide(inventoryLive))

export const productSwitch = (req: ProductSwitchReq, switchedBy: string) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const origin = 'foreign' as const;
        // no picked date on this form — a reclassification is done when it is done, and both
        // legs must obviously carry the same day
        const movementDate = todayBusinessDate();
        const { weightGb, weightGm } = yield* resolveQuantity(req.productTypeId, req.purityId, req.weight);

        const movedAt = new Date();
        // A shared movement shape — the two legs differ only in brand, sign, and the cost the
        // locked decrement decides. `referenceId` is filled in by the repository once the
        // adjustment row exists, since the pair is keyed to it.
        const leg = (brandId: string, sign: 1 | -1) => ({
            id: randomUUID(),
            purityId: req.purityId,
            brandId,
            origin,
            productTypeId: req.productTypeId,
            referenceType: 'PRODUCT_SWITCH',
            referenceId: '',
            weightGbDelta: sign * weightGb,
            weightGmDelta: sign * weightGm,
            notes: req.notes ?? null,
            movementDate,
            movedAt,
            movedBy: switchedBy,
        });

        // Source down, destination up, adjustment record and both ledger legs in one transaction.
        // The switch conserves value: what the source pool gives up at its live WAC is exactly
        // what the destination is credited with, so the repository derives both from one figure.
        return yield* repo.applyProductSwitch({
            from: { purityId: req.purityId, brandId: req.fromBrandId, origin, productTypeId: req.productTypeId },
            to: { purityId: req.purityId, brandId: req.toBrandId, origin, productTypeId: req.productTypeId },
            weightGb,
            weightGm,
            adjustment: {
                purityId: req.purityId,
                productTypeId: req.productTypeId,
                fromBrandId: req.fromBrandId,
                toBrandId: req.toBrandId,
                weightGb,
                weightGm,
                notes: req.notes ?? null,
                switchedBy,
                switchedAt: movedAt,
            },
            fromMovement: leg(req.fromBrandId, -1),
            toMovement: leg(req.toBrandId, 1),
        });
    }).pipe(Effect.provide(inventoryLive))

// --- Internal cross-domain commands ---

// flattens a split into the per-pool rows the repository moves atomically
const toEntries = (req: SplitMovementReq): MovementEntry[] =>
    req.brands.map((brand) => ({
        purityId: req.purityId,
        brandId: brand.brandId,
        origin: req.origin,
        productTypeId: req.productTypeId,
        weightGb: brand.weightGb,
        weightGm: brand.weightGm,
        totalCost: brand.totalCost,
        referenceType: req.referenceType,
        referenceId: req.referenceId,
        movedBy: req.movedBy,
    }))

/**
 * Books a delivery into every branded pool it landed in, in one transaction.
 *
 * The split is resolved upstream (`infrastructure/brand-split.ts`) and always sums to the
 * transaction's weight, so this never has to check that it does — it books what it is given.
 */
export const incrementSplit = (req: SplitMovementReq) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        yield* repo.incrementMany(toEntries(req));
    }).pipe(Effect.provide(inventoryLive))

/**
 * Takes a shipment out of every pool it was drawn from, in one transaction. Each pool is costed
 * at its own live WAC, and one short pool fails the whole move with nothing decremented.
 */
export const decrementSplit = (req: SplitMovementReq) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        yield* repo.decrementMany(toEntries(req));
    }).pipe(Effect.provide(inventoryLive))

// The single-brand case, expressed through the split path so every movement in the system takes
// the same all-or-nothing route. Callers that deal in one pool (receive, retail-sell) keep the
// simpler shape rather than building a one-element array at every call site.
export const increment = (req: IncrementReq) =>
    incrementSplit({
        purityId: req.purityId,
        origin: req.origin,
        productTypeId: req.productTypeId,
        brands: [{
            brandId: req.brandId, weightGb: req.weightGb, weightGm: req.weightGm, totalCost: req.totalCost,
        }],
        referenceType: req.referenceType,
        referenceId: req.referenceId,
        movedBy: req.createdBy,
    })

export const decrement = (req: DecrementReq) =>
    decrementSplit({
        purityId: req.purityId,
        origin: req.origin,
        productTypeId: req.productTypeId,
        // cost removed comes from the pool's live WAC, not from here
        brands: [{ brandId: req.brandId, weightGb: req.weightGb, weightGm: req.weightGm, totalCost: 0 }],
        referenceType: req.referenceType,
        referenceId: req.referenceId,
        movedBy: req.movedBy,
    })

/**
 * The brand split a transaction actually moved, read back off the movement ledger.
 *
 * There is no separate allocation table, and deliberately so: the movements booked under a
 * transaction's reference *are* its split, so the figures a detail page shows are the same rows
 * the balances were built from and cannot drift from them. Weights come back positive whichever
 * direction the movement went — the caller already knows whether it bought or sold.
 */
export const findBrandSplitByReference = (referenceType: string, referenceId: string) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const movements = yield* repo.findMovementsByReference(referenceType, referenceId);
        return movements.map((m) => ({
            brandId: m.brandId,
            weightGb: Math.abs(m.weightGbDelta),
            weightGm: Math.abs(m.weightGmDelta),
        }));
    }).pipe(Effect.provide(inventoryLive))

export const reverseDecrement = (req: ReverseDecrementReq) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const movements = yield* repo.findMovementsByReference(req.originalReferenceType, req.originalReferenceId);

        // the reversal happens today; it does not inherit the original's day, because the gold
        // coming back is its own event on its own date
        const movementDate = todayBusinessDate();
        const movedAt = new Date();

        // Every pool the original drew from is restored in one transaction, for the same reason
        // the outbound move was one: a mixed shipment coming home half-restored leaves the
        // balances claiming gold that is physically back on the shelf is not.
        yield* repo.applyReversal({
            restore: movements.map((movement) => ({
                purityId: movement.purityId,
                brandId: movement.brandId,
                origin: movement.origin,
                productTypeId: movement.productTypeId,
                totalWeightGb: Math.abs(movement.weightGbDelta),
                totalWeightGm: Math.abs(movement.weightGmDelta),
                totalCost: Math.abs(movement.costDelta),
            })),
            movements: movements.map((movement) => ({
                id: randomUUID(),
                purityId: movement.purityId,
                brandId: movement.brandId,
                origin: movement.origin,
                productTypeId: movement.productTypeId,
                referenceType: req.reverseReferenceType,
                referenceId: req.reverseReferenceId,
                weightGbDelta: Math.abs(movement.weightGbDelta),
                weightGmDelta: Math.abs(movement.weightGmDelta),
                costDelta: Math.abs(movement.costDelta),
                notes: null,
                movementDate,
                movedAt,
                movedBy: req.movedBy,
            })),
        });
    }).pipe(Effect.provide(inventoryLive))
