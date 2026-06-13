import { Effect, Layer } from "effect";
import { randomUUID } from "crypto";
import { StockGainReq, StockLossReq } from "@gold-platform/types";
import { DecrementReq, IncrementReq, InventoriesRepository, InsufficientStockError, ReverseDecrementReq } from "../port/inventories.port.js";
import { LotShape } from "../../../infrastructure/db/schema/inventory.schema.js";
import { makeInventoryRepository } from "../adapter/inventory.repository.js";

const inventoryLive = Layer.effect(InventoriesRepository, makeInventoryRepository);

// --- Public usecases (HTTP) ---

export const listLots = (req: Partial<LotShape>) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        return yield* repo.listLots(req);
    }).pipe(Effect.provide(inventoryLive))

export const getInventoryVolume = () =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const lots = yield* repo.listLots({});
        // group by brand + purity + productType and sum remaining
        const map = new Map<string, { brandId: string; purityId: string; productTypeId: string; totalWeightGb: number; totalWeightGm: number; totalCost: number }>();
        for (const lot of lots) {
            const key = `${lot.brandId}:${lot.purityId}:${lot.productTypeId}`;
            const existing = map.get(key) ?? { brandId: lot.brandId, purityId: lot.purityId, productTypeId: lot.productTypeId, totalWeightGb: 0, totalWeightGm: 0, totalCost: 0 };
            existing.totalWeightGb += lot.remainingWeightGb;
            existing.totalWeightGm += lot.remainingWeightGb * lot.conversionFactor;
            existing.totalCost += lot.remainingCost;
            map.set(key, existing);
        }
        return Array.from(map.values());
    }).pipe(Effect.provide(inventoryLive))

export const stockGain = (req: StockGainReq) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const adjustmentId = randomUUID();
        const lotId = randomUUID();

        yield* repo.createStockGainAdjustment({
            id: adjustmentId,
            purityId: req.purityId,
            brandId: req.brandId,
            productTypeId: req.productTypeId,
            weightGb: req.weightGb,
            weightGm: req.weightGm,
            conversionFactor: req.conversionFactor,
            totalCost: req.totalCost,
            reason: req.reason,
            notes: req.notes ?? null,
            auditedBy: req.auditedBy,
            auditedAt: new Date(),
        });

        const lot = yield* repo.createLot({
            id: lotId,
            sourceType: 'STOCK_GAIN',
            sourceId: adjustmentId,
            purityId: req.purityId,
            brandId: req.brandId,
            productTypeId: req.productTypeId,
            weightGb: req.weightGb,
            weightGm: req.weightGm,
            conversionFactor: req.conversionFactor,
            totalCost: req.totalCost,
            remainingWeightGb: req.weightGb,
            remainingCost: req.totalCost,
            status: 'active',
            createdBy: req.auditedBy,
            createdAt: new Date(),
        });

        yield* repo.createMovement({
            id: randomUUID(),
            lotId,
            referenceType: 'STOCK_GAIN',
            referenceId: adjustmentId,
            weightGbDelta: req.weightGb,
            weightGmDelta: req.weightGm,
            costDelta: req.totalCost,
            movedAt: new Date(),
            movedBy: req.auditedBy,
        });

        return lot;
    }).pipe(Effect.provide(inventoryLive))

export const stockLoss = (req: StockLossReq) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const adjustmentId = randomUUID();

        yield* repo.createStockLossAdjustment({
            id: adjustmentId,
            purityId: req.purityId,
            brandId: req.brandId,
            productTypeId: req.productTypeId,
            weightGb: req.weightGb,
            weightGm: req.weightGm,
            reason: req.reason,
            notes: req.notes ?? null,
            auditedBy: req.auditedBy,
            auditedAt: new Date(),
        });

        yield* runFifo({
            purityId: req.purityId,
            brandId: req.brandId,
            productTypeId: req.productTypeId,
            weightGb: req.weightGb,
            weightGm: req.weightGm,
            referenceType: 'STOCK_LOSS',
            referenceId: adjustmentId,
            movedBy: req.auditedBy,
        });
    }).pipe(Effect.provide(inventoryLive))

// --- Internal usecases (cross-domain commands) ---

export const increment = (req: IncrementReq) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const lotId = randomUUID();

        const lot = yield* repo.createLot({
            id: lotId,
            sourceType: 'RECEIVED',
            sourceId: req.sourceId,
            purityId: req.purityId,
            brandId: req.brandId,
            productTypeId: req.productTypeId,
            weightGb: req.weightGb,
            weightGm: req.weightGm,
            conversionFactor: req.conversionFactor,
            totalCost: req.totalCost,
            remainingWeightGb: req.weightGb,
            remainingCost: req.totalCost,
            status: 'active',
            createdBy: req.createdBy,
            createdAt: new Date(),
        });

        yield* repo.createMovement({
            id: randomUUID(),
            lotId,
            referenceType: req.referenceType,
            referenceId: req.referenceId,
            weightGbDelta: req.weightGb,
            weightGmDelta: req.weightGm,
            costDelta: req.totalCost,
            movedAt: new Date(),
            movedBy: req.createdBy,
        });

        return lot;
    }).pipe(Effect.provide(inventoryLive))

export const decrement = (req: DecrementReq) => runFifo(req).pipe(Effect.provide(inventoryLive))

export const reverseDecrement = (req: ReverseDecrementReq) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const movements = yield* repo.findMovementsByReference(req.originalReferenceType, req.originalReferenceId);

        for (const movement of movements) {
            const lot = yield* repo.findLotById(movement.lotId);
            yield* repo.updateLotRemaining({
                id: lot.id,
                remainingWeightGb: lot.remainingWeightGb + Math.abs(movement.weightGbDelta),
                remainingCost: lot.remainingCost + Math.abs(movement.costDelta),
            });
            yield* repo.createMovement({
                id: randomUUID(),
                lotId: lot.id,
                referenceType: req.reverseReferenceType,
                referenceId: req.reverseReferenceId,
                weightGbDelta: Math.abs(movement.weightGbDelta),
                weightGmDelta: Math.abs(movement.weightGmDelta),
                costDelta: Math.abs(movement.costDelta),
                movedAt: new Date(),
                movedBy: req.movedBy,
            });
        }
    }).pipe(Effect.provide(inventoryLive))

// --- FIFO picking — shared by stockLoss and decrement ---

const runFifo = (req: DecrementReq) =>
    Effect.gen(function* () {
        const repo = yield* InventoriesRepository;
        const lots = yield* repo.findLotsByFifo({ brandId: req.brandId, purityId: req.purityId, productTypeId: req.productTypeId });

        const totalAvailable = lots.reduce((sum, l) => sum + l.remainingWeightGb, 0);
        if (totalAvailable < req.weightGb) {
            return yield* Effect.fail(new InsufficientStockError({ requested: req.weightGb, available: totalAvailable }));
        }

        let remaining = req.weightGb;
        for (const lot of lots) {
            if (remaining <= 0) break;
            const take = Math.min(lot.remainingWeightGb, remaining);
            const costTaken = (take / lot.weightGb) * lot.totalCost;
            const gmTaken = take * lot.conversionFactor;

            yield* repo.updateLotRemaining({
                id: lot.id,
                remainingWeightGb: lot.remainingWeightGb - take,
                remainingCost: lot.remainingCost - costTaken,
            });

            yield* repo.createMovement({
                id: randomUUID(),
                lotId: lot.id,
                referenceType: req.referenceType,
                referenceId: req.referenceId,
                weightGbDelta: -take,
                weightGmDelta: -gmTaken,
                costDelta: -costTaken,
                movedAt: new Date(),
                movedBy: req.movedBy,
            });

            remaining -= take;
        }
    })
