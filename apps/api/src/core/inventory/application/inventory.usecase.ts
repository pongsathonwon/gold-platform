import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import { StockGainReq, StockLossReq } from "@gold-platform/types";
import {
    DecrementReq, IncrementReq, InventoriesRepository, InventoryVolume,
    InsufficientStockError, NoSnapshotError, ProductSwitchReq, ReverseDecrementReq,
} from "../port/inventories.port.js";
import { makeInventoryRepository } from "../adapter/inventory.repository.js";

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

        yield* repo.createStockGainAdjustment({
            id: adjustmentId,
            purityId: req.purityId,
            brandId: req.brandId ?? null,
            origin: req.origin,
            productTypeId: req.productTypeId,
            weightGb: req.weightGb,
            weightGm: req.weightGm,
            conversionFactor: req.conversionFactor,
            totalCost: req.totalCost,
            reason: req.reason,
            notes: req.notes ?? null,
            auditedBy,
            auditedAt: new Date(),
        });

        yield* repo.upsertBalance({
            purityId: req.purityId,
            brandId,
            origin: req.origin,
            productTypeId: req.productTypeId,
            totalWeightGb: req.weightGb,
            totalWeightGm: req.weightGm,
            totalCost: req.totalCost,
        });

        yield* repo.createMovement({
            id: randomUUID(),
            purityId: req.purityId,
            brandId,
            origin: req.origin,
            productTypeId: req.productTypeId,
            referenceType: 'STOCK_GAIN',
            referenceId: adjustmentId,
            weightGbDelta: req.weightGb,
            weightGmDelta: req.weightGm,
            costDelta: req.totalCost,
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
        const date = today();

        const snapshot = yield* repo.getDailySnapshot(
            { purityId: req.purityId, brandId, origin: req.origin, productTypeId: req.productTypeId },
            date,
        );
        if (!snapshot) {
            return yield* Effect.fail(new NoSnapshotError({
                purityId: req.purityId, brandId, origin: req.origin, productTypeId: req.productTypeId, date,
            }));
        }

        const snapshotRate = snapshot.totalCost / snapshot.weightGb;
        const costDelta = req.weightGb * snapshotRate;

        yield* repo.createStockLossAdjustment({
            id: adjustmentId,
            purityId: req.purityId,
            brandId: req.brandId ?? null,
            origin: req.origin,
            productTypeId: req.productTypeId,
            weightGb: req.weightGb,
            weightGm: req.weightGm,
            reason: req.reason,
            notes: req.notes ?? null,
            auditedBy,
            auditedAt: new Date(),
        });

        yield* repo.decrementBalance(
            { purityId: req.purityId, brandId, origin: req.origin, productTypeId: req.productTypeId },
            req.weightGb, req.weightGm, costDelta,
        );

        yield* repo.createMovement({
            id: randomUUID(),
            purityId: req.purityId,
            brandId,
            origin: req.origin,
            productTypeId: req.productTypeId,
            referenceType: 'STOCK_LOSS',
            referenceId: adjustmentId,
            weightGbDelta: -req.weightGb,
            weightGmDelta: -req.weightGm,
            costDelta: -costDelta,
            notes: req.notes ?? null,
            movedAt: new Date(),
            movedBy: auditedBy,
        });

        return { id: adjustmentId };
    }).pipe(Effect.provide(inventoryLive))

export const computeSnapshots = () =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        return yield* repo.computeAllSnapshots(today());
    }).pipe(Effect.provide(inventoryLive))

export const getTodaySnapshots = () =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        return yield* repo.listSnapshotsByDate(today());
    }).pipe(Effect.provide(inventoryLive))

export const productSwitch = (req: ProductSwitchReq, switchedBy: string) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const date = today();
        const origin = 'foreign' as const;

        // get non-fungible balance to compute its WAC
        const nonFungibleBalance = yield* repo.getBalance({
            purityId: req.purityId,
            brandId: req.fromBrandId,
            origin,
            productTypeId: req.productTypeId,
        });
        if (!nonFungibleBalance || nonFungibleBalance.totalWeightGb < req.weightGb) {
            const available = nonFungibleBalance?.totalWeightGb ?? 0;
            return yield* Effect.fail(new InsufficientStockError({ requested: req.weightGb, available }));
        }

        const nonFungibleWac = nonFungibleBalance.totalCost / nonFungibleBalance.totalWeightGb;
        const fromCostDelta = req.weightGb * nonFungibleWac;

        // get fungible (NA) snapshot for today's rate
        const fungibleSnapshot = yield* repo.getDailySnapshot(
            { purityId: req.purityId, brandId: 'NA', origin, productTypeId: req.productTypeId },
            date,
        );
        if (!fungibleSnapshot) {
            return yield* Effect.fail(new NoSnapshotError({
                purityId: req.purityId, brandId: 'NA', origin, productTypeId: req.productTypeId, date,
            }));
        }
        const fungibleRate = fungibleSnapshot.totalCost / fungibleSnapshot.weightGb;
        const toCostDelta = req.weightGb * fungibleRate;

        // decrement non-fungible pool
        yield* repo.decrementBalance(
            { purityId: req.purityId, brandId: req.fromBrandId, origin, productTypeId: req.productTypeId },
            req.weightGb, req.weightGm, fromCostDelta,
        );

        // increment fungible (NA) pool
        yield* repo.upsertBalance({
            purityId: req.purityId,
            brandId: 'NA',
            origin,
            productTypeId: req.productTypeId,
            totalWeightGb: req.weightGb,
            totalWeightGm: req.weightGm,
            totalCost: toCostDelta,
        });

        const adjustment = yield* repo.createProductSwitchAdjustment({
            purityId: req.purityId,
            productTypeId: req.productTypeId,
            fromBrandId: req.fromBrandId,
            weightGb: req.weightGb,
            weightGm: req.weightGm,
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
            weightGbDelta: -req.weightGb,
            weightGmDelta: -req.weightGm,
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
            weightGbDelta: req.weightGb,
            weightGmDelta: req.weightGm,
            costDelta: toCostDelta,
            notes: req.notes ?? null,
            movedAt: new Date(),
            movedBy: switchedBy,
        });

        return adjustment;
    }).pipe(Effect.provide(inventoryLive))

// --- Internal cross-domain commands ---

export const increment = (req: IncrementReq) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;

        yield* repo.upsertBalance({
            purityId: req.purityId,
            brandId: req.brandId,
            origin: req.origin,
            productTypeId: req.productTypeId,
            totalWeightGb: req.weightGb,
            totalWeightGm: req.weightGm,
            totalCost: req.totalCost,
        });

        yield* repo.createMovement({
            id: randomUUID(),
            purityId: req.purityId,
            brandId: req.brandId,
            origin: req.origin,
            productTypeId: req.productTypeId,
            referenceType: req.referenceType,
            referenceId: req.referenceId,
            weightGbDelta: req.weightGb,
            weightGmDelta: req.weightGm,
            costDelta: req.totalCost,
            notes: null,
            movedAt: new Date(),
            movedBy: req.createdBy,
        });
    }).pipe(Effect.provide(inventoryLive))

export const decrement = (req: DecrementReq) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const date = today();

        const snapshot = yield* repo.getDailySnapshot(
            { purityId: req.purityId, brandId: req.brandId, origin: req.origin, productTypeId: req.productTypeId },
            date,
        );
        if (!snapshot) {
            return yield* Effect.fail(new NoSnapshotError({
                purityId: req.purityId, brandId: req.brandId, origin: req.origin, productTypeId: req.productTypeId, date,
            }));
        }

        const snapshotRate = snapshot.totalCost / snapshot.weightGb;
        const costDelta = req.weightGb * snapshotRate;

        yield* repo.decrementBalance(
            { purityId: req.purityId, brandId: req.brandId, origin: req.origin, productTypeId: req.productTypeId },
            req.weightGb, req.weightGm, costDelta,
        );

        yield* repo.createMovement({
            id: randomUUID(),
            purityId: req.purityId,
            brandId: req.brandId,
            origin: req.origin,
            productTypeId: req.productTypeId,
            referenceType: req.referenceType,
            referenceId: req.referenceId,
            weightGbDelta: -req.weightGb,
            weightGmDelta: -req.weightGm,
            costDelta: -costDelta,
            notes: null,
            movedAt: new Date(),
            movedBy: req.movedBy,
        });
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
