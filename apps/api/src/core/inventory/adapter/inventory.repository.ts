import { Effect } from "effect";
import { and, eq, sql } from "drizzle-orm";
import { Database, DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import {
    inventoryBalance, inventoryMovements, inventoryDailySnapshots,
    stockGainAdjustments, stockLossAdjustments, productSwitchAdjustments,
    CreateMovement, CreateProductSwitch, CreateSnapshot, CreateStockGain, CreateStockLoss, UpsertBalance,
} from "../../../infrastructure/db/schema/inventory.schema.js";
import { BalanceKey, ForInventoriesRepository, InsufficientStockError, SnapshotKey } from "../port/inventories.port.js";

const INSUFFICIENT = Symbol('InsufficientStockError')

class InventoryRepository implements ForInventoriesRepository {
    constructor(private readonly db: Database) {}

    listBalances() {
        return Effect.tryPromise({
            try: () => this.db.select().from(inventoryBalance).execute(),
            catch: () => new RepositoryError({ message: "cannot list balances" }),
        });
    }

    getBalance(key: BalanceKey) {
        return Effect.tryPromise({
            try: () => this.db.select().from(inventoryBalance).where(and(
                eq(inventoryBalance.purityId, key.purityId),
                eq(inventoryBalance.brandId, key.brandId),
                eq(inventoryBalance.origin, key.origin),
                eq(inventoryBalance.productTypeId, key.productTypeId),
            )).execute(),
            catch: () => new RepositoryError({ message: "cannot get balance" }),
        }).pipe(Effect.map((rows) => rows[0] ?? null));
    }

    upsertBalance(req: UpsertBalance) {
        return Effect.tryPromise({
            try: () => this.db.insert(inventoryBalance)
                .values(req)
                .onConflictDoUpdate({
                    target: [
                        inventoryBalance.purityId,
                        inventoryBalance.brandId,
                        inventoryBalance.origin,
                        inventoryBalance.productTypeId,
                    ],
                    set: {
                        totalWeightGb: sql`inventory_balance.total_weight_gb + EXCLUDED.total_weight_gb`,
                        totalWeightGm: sql`inventory_balance.total_weight_gm + EXCLUDED.total_weight_gm`,
                        totalCost: sql`inventory_balance.total_cost + EXCLUDED.total_cost`,
                    },
                })
                .execute(),
            catch: () => new RepositoryError({ message: "cannot upsert balance" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    decrementBalance(key: BalanceKey, weightGb: number, weightGm: number, costDelta: number) {
        return Effect.tryPromise({
            try: async () => {
                await this.db.transaction(async (tx) => {
                    const rows = await tx.select().from(inventoryBalance)
                        .where(and(
                            eq(inventoryBalance.purityId, key.purityId),
                            eq(inventoryBalance.brandId, key.brandId),
                            eq(inventoryBalance.origin, key.origin),
                            eq(inventoryBalance.productTypeId, key.productTypeId),
                        ))
                        .for('update')
                        .execute();

                    const balance = rows[0];
                    const available = balance?.totalWeightGb ?? 0;
                    if (!balance || available < weightGb) {
                        throw { [INSUFFICIENT]: true, available }
                    }

                    await tx.update(inventoryBalance)
                        .set({
                            totalWeightGb: sql`${inventoryBalance.totalWeightGb} - ${weightGb}`,
                            totalWeightGm: sql`${inventoryBalance.totalWeightGm} - ${weightGm}`,
                            totalCost: sql`${inventoryBalance.totalCost} - ${costDelta}`,
                        })
                        .where(and(
                            eq(inventoryBalance.purityId, key.purityId),
                            eq(inventoryBalance.brandId, key.brandId),
                            eq(inventoryBalance.origin, key.origin),
                            eq(inventoryBalance.productTypeId, key.productTypeId),
                        ))
                        .execute();
                });
            },
            catch: (e) => {
                if (e && typeof e === 'object' && INSUFFICIENT in (e as object)) {
                    return new InsufficientStockError({ requested: weightGb, available: (e as unknown as { available: number }).available });
                }
                return new RepositoryError({ message: "cannot decrement balance" });
            },
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

    getDailySnapshot(key: SnapshotKey, date: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(inventoryDailySnapshots).where(and(
                eq(inventoryDailySnapshots.purityId, key.purityId),
                eq(inventoryDailySnapshots.brandId, key.brandId),
                eq(inventoryDailySnapshots.origin, key.origin),
                eq(inventoryDailySnapshots.productTypeId, key.productTypeId),
                eq(inventoryDailySnapshots.snapshotDate, date),
            )).execute(),
            catch: () => new RepositoryError({ message: "cannot get daily snapshot" }),
        }).pipe(Effect.map((rows) => rows[0] ?? null));
    }

    listSnapshotsByDate(date: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(inventoryDailySnapshots)
                .where(eq(inventoryDailySnapshots.snapshotDate, date))
                .execute(),
            catch: () => new RepositoryError({ message: "cannot list snapshots" }),
        });
    }

    upsertDailySnapshotOnce(req: CreateSnapshot) {
        return Effect.tryPromise({
            try: () => this.db.insert(inventoryDailySnapshots)
                .values(req)
                .onConflictDoNothing()
                .execute(),
            catch: () => new RepositoryError({ message: "cannot upsert daily snapshot" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    computeAllSnapshots(date: string) {
        return Effect.tryPromise({
            try: async () => {
                const balances = await this.db.select().from(inventoryBalance).execute();
                if (balances.length === 0) return [];

                const snapshotRows: CreateSnapshot[] = balances.map((b) => ({
                    purityId: b.purityId,
                    brandId: b.brandId,
                    origin: b.origin,
                    productTypeId: b.productTypeId,
                    snapshotDate: date,
                    weightGb: b.totalWeightGb,
                    weightGm: b.totalWeightGm,
                    totalCost: b.totalCost,
                }));

                await this.db.insert(inventoryDailySnapshots)
                    .values(snapshotRows)
                    .onConflictDoNothing()
                    .execute();

                // return what exists for this date (includes previously written snapshots)
                return this.db.select().from(inventoryDailySnapshots)
                    .where(eq(inventoryDailySnapshots.snapshotDate, date))
                    .execute();
            },
            catch: () => new RepositoryError({ message: "cannot compute snapshots" }),
        });
    }

    createProductSwitchAdjustment(req: CreateProductSwitch) {
        return Effect.tryPromise({
            try: () => this.db.insert(productSwitchAdjustments).values(req).returning().execute(),
            catch: () => new RepositoryError({ message: "cannot create product switch adjustment" }),
        }).pipe(Effect.map((rows) => rows[0]));
    }

    findMovementsByReference(referenceType: string, referenceId: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(inventoryMovements).where(and(
                eq(inventoryMovements.referenceType, referenceType),
                eq(inventoryMovements.referenceId, referenceId),
            )).execute(),
            catch: () => new RepositoryError({ message: `cannot find movements for ${referenceType}:${referenceId}` }),
        });
    }
}

export const makeInventoryRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new InventoryRepository(db);
});
