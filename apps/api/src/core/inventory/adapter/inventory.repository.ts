import { Effect } from "effect";
import { and, asc, eq } from "drizzle-orm";
import { Database, DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import {
    inventoryLots, inventoryMovements,
    stockGainAdjustments, stockLossAdjustments,
    CreateLot, CreateMovement, CreateStockGain, CreateStockLoss, LotShape,
} from "../../../infrastructure/db/schema/inventory.schema.js";
import { ForInventoriesRepository } from "../port/inventories.port.js";

class InventoryRepository implements ForInventoriesRepository {
    constructor(private readonly db: Database) {}

    listLots(_req: Partial<LotShape>) {
        return Effect.tryPromise({
            try: () => this.db.select().from(inventoryLots).execute(),
            catch: () => new RepositoryError({ message: "cannot list lots" }),
        });
    }

    findLotById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(inventoryLots).where(eq(inventoryLots.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find lot id: ${id}` }),
        }).pipe(
            Effect.flatMap((res) =>
                res.length === 1
                    ? Effect.succeed(res[0])
                    : Effect.fail(new RepositoryError({ message: `lot not found: ${id}` }))
            )
        );
    }

    createLot(req: CreateLot) {
        return Effect.tryPromise({
            try: () => this.db.insert(inventoryLots).values(req).returning().execute(),
            catch: () => new RepositoryError({ message: "cannot create lot" }),
        }).pipe(Effect.map((res) => res[0]));
    }

    updateLotRemaining(req: Pick<LotShape, 'id' | 'remainingWeightGb' | 'remainingCost'>) {
        return Effect.tryPromise({
            try: () => this.db
                .update(inventoryLots)
                .set({ remainingWeightGb: req.remainingWeightGb, remainingCost: req.remainingCost })
                .where(eq(inventoryLots.id, req.id))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot update lot remaining: ${req.id}` }),
        }).pipe(Effect.map(() => undefined as void));
    }

    createMovement(req: CreateMovement) {
        return Effect.tryPromise({
            try: () => this.db.insert(inventoryMovements).values(req).execute(),
            catch: () => new RepositoryError({ message: "cannot create movement" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    createStockGainAdjustment(req: CreateStockGain) {
        return Effect.tryPromise({
            try: () => this.db.insert(stockGainAdjustments).values(req).execute(),
            catch: () => new RepositoryError({ message: "cannot create stock gain adjustment" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    createStockLossAdjustment(req: CreateStockLoss) {
        return Effect.tryPromise({
            try: () => this.db.insert(stockLossAdjustments).values(req).execute(),
            catch: () => new RepositoryError({ message: "cannot create stock loss adjustment" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    findLotsByFifo(req: Pick<LotShape, 'brandId' | 'purityId' | 'productTypeId'>) {
        return Effect.tryPromise({
            try: () => this.db
                .select()
                .from(inventoryLots)
                .where(and(
                    eq(inventoryLots.brandId, req.brandId),
                    eq(inventoryLots.purityId, req.purityId),
                    eq(inventoryLots.productTypeId, req.productTypeId),
                    eq(inventoryLots.status, 'active'),
                ))
                .orderBy(asc(inventoryLots.createdAt))
                .execute(),
            catch: () => new RepositoryError({ message: "cannot query lots for FIFO" }),
        });
    }

    findMovementsByReference(referenceType: string, referenceId: string) {
        return Effect.tryPromise({
            try: () => this.db
                .select()
                .from(inventoryMovements)
                .where(and(
                    eq(inventoryMovements.referenceType, referenceType),
                    eq(inventoryMovements.referenceId, referenceId),
                ))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot find movements for ${referenceType}:${referenceId}` }),
        });
    }
}

export const makeInventoryRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new InventoryRepository(db);
});
