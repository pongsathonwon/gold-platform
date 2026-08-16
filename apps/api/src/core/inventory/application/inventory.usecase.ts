import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import { StockGainReq, StockLossReq } from "@gold-platform/types";
import {
    DecrementReq, IncrementReq, InventoriesRepository, InventoryVolume, MovementEntry,
    MovementFilter, ProductSwitchReq, ReverseDecrementReq, SplitMovementReq,
} from "../port/inventories.port.js";
import { makeInventoryRepository } from "../adapter/inventory.repository.js";
import { resolveQuantity } from "../../../infrastructure/quantity.js";

const inventoryLive = Layer.effect(InventoriesRepository, makeInventoryRepository);

const today = () => new Date().toISOString().slice(0, 10);

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

export const stockGain = (req: StockGainReq, auditedBy: string) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const adjustmentId = randomUUID();
        const brandId = req.brandId ?? 'NA';
        const { weightGb, weightGm, conversionFactor } = yield* resolveQuantity(req.productTypeId, req.purityId, req.weight);
        // operator enters price per gold baht (บาททอง); total cost is derived from the resolved GB weight
        const totalCost = req.pricePerGb * weightGb;

        yield* repo.createStockGainAdjustment({
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
            auditedBy,
            auditedAt: new Date(),
        });

        yield* repo.upsertBalance({
            purityId: req.purityId,
            brandId,
            origin: req.origin,
            productTypeId: req.productTypeId,
            totalWeightGb: weightGb,
            totalWeightGm: weightGm,
            totalCost,
        });

        yield* repo.createMovement({
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
            movedAt: new Date(),
            movedBy: auditedBy,
        });

        return { id: adjustmentId };
    }).pipe(Effect.provide(inventoryLive))

export const stockLoss = (req: StockLossReq, auditedBy: string) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const adjustmentId = randomUUID();
        const brandId = req.brandId ?? 'NA';
        const { weightGb, weightGm } = yield* resolveQuantity(req.productTypeId, req.purityId, req.weight);

        // decrement first so an insufficient-stock failure leaves no adjustment record;
        // cost removed is derived from the pool's live WAC inside the locked transaction
        const costDelta = yield* repo.decrementBalance(
            { purityId: req.purityId, brandId, origin: req.origin, productTypeId: req.productTypeId },
            weightGb, weightGm,
        );

        yield* repo.createStockLossAdjustment({
            id: adjustmentId,
            purityId: req.purityId,
            brandId: req.brandId ?? null,
            origin: req.origin,
            productTypeId: req.productTypeId,
            weightGb,
            weightGm,
            referenceType: req.referenceType,
            notes: req.notes ?? null,
            auditedBy,
            auditedAt: new Date(),
        });

        yield* repo.createMovement({
            id: randomUUID(),
            purityId: req.purityId,
            brandId,
            origin: req.origin,
            productTypeId: req.productTypeId,
            referenceType: req.referenceType,
            referenceId: adjustmentId,
            weightGbDelta: -weightGb,
            weightGmDelta: -weightGm,
            costDelta: -costDelta,
            notes: req.notes ?? null,
            movedAt: new Date(),
            movedBy: auditedBy,
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
        const { weightGb, weightGm } = yield* resolveQuantity(req.productTypeId, req.purityId, req.weight);

        // decrement non-fungible pool at its live WAC (returns the cost removed); the reclassification
        // conserves cost value, so the fungible pool is credited with the same amount
        const fromCostDelta = yield* repo.decrementBalance(
            { purityId: req.purityId, brandId: req.fromBrandId, origin, productTypeId: req.productTypeId },
            weightGb, weightGm,
        );
        const toCostDelta = fromCostDelta;

        // increment fungible (NA) pool
        yield* repo.upsertBalance({
            purityId: req.purityId,
            brandId: 'NA',
            origin,
            productTypeId: req.productTypeId,
            totalWeightGb: weightGb,
            totalWeightGm: weightGm,
            totalCost: toCostDelta,
        });

        const adjustment = yield* repo.createProductSwitchAdjustment({
            purityId: req.purityId,
            productTypeId: req.productTypeId,
            fromBrandId: req.fromBrandId,
            weightGb,
            weightGm,
            fromCostDelta,
            toCostDelta,
            notes: req.notes ?? null,
            switchedBy,
            switchedAt: new Date(),
        });

        const adjustmentId = adjustment.id;

        yield* repo.createMovement({
            id: randomUUID(),
            purityId: req.purityId,
            brandId: req.fromBrandId,
            origin,
            productTypeId: req.productTypeId,
            referenceType: 'PRODUCT_SWITCH',
            referenceId: adjustmentId,
            weightGbDelta: -weightGb,
            weightGmDelta: -weightGm,
            costDelta: -fromCostDelta,
            notes: req.notes ?? null,
            movedAt: new Date(),
            movedBy: switchedBy,
        });

        yield* repo.createMovement({
            id: randomUUID(),
            purityId: req.purityId,
            brandId: 'NA',
            origin,
            productTypeId: req.productTypeId,
            referenceType: 'PRODUCT_SWITCH',
            referenceId: adjustmentId,
            weightGbDelta: weightGb,
            weightGmDelta: weightGm,
            costDelta: toCostDelta,
            notes: req.notes ?? null,
            movedAt: new Date(),
            movedBy: switchedBy,
        });

        return adjustment;
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

        for (const movement of movements) {
            yield* repo.upsertBalance({
                purityId: movement.purityId,
                brandId: movement.brandId,
                origin: movement.origin,
                productTypeId: movement.productTypeId,
                totalWeightGb: Math.abs(movement.weightGbDelta),
                totalWeightGm: Math.abs(movement.weightGmDelta),
                totalCost: Math.abs(movement.costDelta),
            });

            yield* repo.createMovement({
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
                movedAt: new Date(),
                movedBy: req.movedBy,
            });
        }
    }).pipe(Effect.provide(inventoryLive))
