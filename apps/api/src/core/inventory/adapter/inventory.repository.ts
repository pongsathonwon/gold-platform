import { Effect } from "effect";
import { and, desc, eq, sql } from "drizzle-orm";
import { Database, DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import {
    inventoryBalance, inventoryMovements,
    stockGainAdjustments, stockLossAdjustments, productSwitchAdjustments,
    CreateMovement, CreateProductSwitch, CreateStockGain, CreateStockLoss, UpsertBalance,
} from "../../../infrastructure/db/schema/inventory.schema.js";
import { BalanceKey, ForInventoriesRepository, InsufficientStockError, MovementFilter } from "../port/inventories.port.js";

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

    // Cost is derived from the current balance's live weighted-average cost (WAC) inside the same
    // locked transaction that reads it — so a pool refilled after hitting zero always decrements at
    // the correct rate, with no dependency on a daily snapshot. Returns the cost removed.
    decrementBalance(key: BalanceKey, weightGb: number, weightGm: number) {
        return Effect.tryPromise({
            try: async () => {
                return await this.db.transaction(async (tx) => {
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

                    // live WAC — safe from divide-by-zero: available >= weightGb > 0 here
                    const rate = balance.totalWeightGb > 0 ? balance.totalCost / balance.totalWeightGb : 0;
                    const costDelta = weightGb * rate;

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

                    return costDelta;
                });
            },
            catch: (e) => {
                if (e && typeof e === 'object' && INSUFFICIENT in (e as object)) {
                    return new InsufficientStockError({ requested: weightGb, available: (e as unknown as { available: number }).available });
                }
                return new RepositoryError({ message: "cannot decrement balance" });
            },
        });
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

    listMovements(filter: MovementFilter) {
        const conditions = [
            filter.purityId ? eq(inventoryMovements.purityId, filter.purityId) : undefined,
            filter.brandId ? eq(inventoryMovements.brandId, filter.brandId) : undefined,
            filter.origin ? eq(inventoryMovements.origin, filter.origin) : undefined,
            filter.productTypeId ? eq(inventoryMovements.productTypeId, filter.productTypeId) : undefined,
            filter.referenceType ? eq(inventoryMovements.referenceType, filter.referenceType) : undefined,
        ].filter(Boolean) as ReturnType<typeof eq>[];

        return Effect.tryPromise({
            try: () => this.db.select().from(inventoryMovements)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .orderBy(desc(inventoryMovements.movedAt))
                .execute(),
            catch: () => new RepositoryError({ message: "cannot list movements" }),
        });
    }
}

export const makeInventoryRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new InventoryRepository(db);
});
