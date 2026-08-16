import { Effect } from "effect";
import { randomUUID } from "crypto";
import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { todayBusinessDate } from "@gold-platform/types";
import { Database, DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import {
    inventoryBalance, inventoryMovements,
    stockGainAdjustments, stockLossAdjustments, productSwitchAdjustments,
    CreateMovement, CreateProductSwitch, CreateStockGain, CreateStockLoss, UpsertBalance,
} from "../../../infrastructure/db/schema/inventory.schema.js";
import {
    BalanceKey, ForInventoriesRepository, InsufficientStockError, MovementEntry, MovementFilter,
} from "../port/inventories.port.js";

// non-date movement filters, shared by listMovements and sumMovementsBefore so the opening
// balance is summed over the same pools the window shows
function nonDateConditions(filter: MovementFilter) {
    return [
        filter.purityId ? eq(inventoryMovements.purityId, filter.purityId) : undefined,
        filter.brandId ? eq(inventoryMovements.brandId, filter.brandId) : undefined,
        filter.origin ? eq(inventoryMovements.origin, filter.origin) : undefined,
        filter.productTypeId ? eq(inventoryMovements.productTypeId, filter.productTypeId) : undefined,
        filter.referenceType ? eq(inventoryMovements.referenceType, filter.referenceType) : undefined,
    ].filter(Boolean) as ReturnType<typeof eq>[];
}

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

    // Every pool of a split lands in one transaction. A delivery stamped 8 GB HUA + 4 GB NA is one
    // physical event; booking half of it because the second upsert failed would leave inventory
    // claiming a delivery arrived lighter than it did, with no record of the missing half.
    incrementMany(entries: MovementEntry[]) {
        if (entries.length === 0) return Effect.succeed(undefined as void);

        return Effect.tryPromise({
            try: () => this.db.transaction(async (tx) => {
                for (const entry of entries) {
                    await tx.insert(inventoryBalance)
                        .values({
                            purityId: entry.purityId,
                            brandId: entry.brandId,
                            origin: entry.origin,
                            productTypeId: entry.productTypeId,
                            totalWeightGb: entry.weightGb,
                            totalWeightGm: entry.weightGm,
                            totalCost: entry.totalCost,
                        })
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
                        .execute();

                    await tx.insert(inventoryMovements).values({
                        id: randomUUID(),
                        purityId: entry.purityId,
                        brandId: entry.brandId,
                        origin: entry.origin,
                        productTypeId: entry.productTypeId,
                        referenceType: entry.referenceType,
                        referenceId: entry.referenceId,
                        weightGbDelta: entry.weightGb,
                        weightGmDelta: entry.weightGm,
                        costDelta: entry.totalCost,
                        notes: null,
                        // A transition-driven movement happens the day the metal moves. The
                        // transaction's own transactionDate may be older — it dates the order,
                        // not the delivery — so the ledger takes today either way.
                        movementDate: todayBusinessDate(),
                        movedAt: new Date(),
                        movedBy: entry.movedBy,
                    }).execute();
                }
            }),
            catch: () => new RepositoryError({ message: "cannot increment balances" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    // The outbound mirror. Each pool is locked, checked and costed at its own live WAC inside the
    // shared transaction, so a shipment that is short on one stamp fails whole — the alternative
    // is gold leaving the books that never left the vault.
    decrementMany(entries: MovementEntry[]) {
        if (entries.length === 0) return Effect.succeed(undefined as void);

        return Effect.tryPromise({
            try: () => this.db.transaction(async (tx) => {
                for (const entry of entries) {
                    const where = and(
                        eq(inventoryBalance.purityId, entry.purityId),
                        eq(inventoryBalance.brandId, entry.brandId),
                        eq(inventoryBalance.origin, entry.origin),
                        eq(inventoryBalance.productTypeId, entry.productTypeId),
                    );

                    const rows = await tx.select().from(inventoryBalance).where(where).for('update').execute();
                    const balance = rows[0];
                    const available = balance?.totalWeightGb ?? 0;
                    if (!balance || available < entry.weightGb) {
                        throw { [INSUFFICIENT]: true, available, requested: entry.weightGb }
                    }

                    // live WAC — safe from divide-by-zero: available >= weightGb > 0 here
                    const rate = balance.totalWeightGb > 0 ? balance.totalCost / balance.totalWeightGb : 0;
                    const costDelta = entry.weightGb * rate;

                    await tx.update(inventoryBalance)
                        .set({
                            totalWeightGb: sql`${inventoryBalance.totalWeightGb} - ${entry.weightGb}`,
                            totalWeightGm: sql`${inventoryBalance.totalWeightGm} - ${entry.weightGm}`,
                            totalCost: sql`${inventoryBalance.totalCost} - ${costDelta}`,
                        })
                        .where(where)
                        .execute();

                    await tx.insert(inventoryMovements).values({
                        id: randomUUID(),
                        purityId: entry.purityId,
                        brandId: entry.brandId,
                        origin: entry.origin,
                        productTypeId: entry.productTypeId,
                        referenceType: entry.referenceType,
                        referenceId: entry.referenceId,
                        weightGbDelta: -entry.weightGb,
                        weightGmDelta: -entry.weightGm,
                        costDelta: -costDelta,
                        notes: null,
                        // as on the way in: the day the gold left, not the day the order is dated
                        movementDate: todayBusinessDate(),
                        movedAt: new Date(),
                        movedBy: entry.movedBy,
                    }).execute();
                }
            }),
            catch: (e) => {
                if (e && typeof e === 'object' && INSUFFICIENT in (e as object)) {
                    const short = e as unknown as { available: number; requested: number };
                    return new InsufficientStockError({ requested: short.requested, available: short.available });
                }
                return new RepositoryError({ message: "cannot decrement balances" });
            },
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

    /**
     * The window is over `movementDate`, the movement's business day — so an adjustment written
     * up late reads on the day it happened, and a from–to range means the days the operator
     * named. Both ends are inclusive, which a `date` column gives for free: the old comparison
     * against the `movedAt` timestamp silently dropped everything after midnight on the `to` day
     * unless the caller remembered to send an end-of-day time.
     */
    listMovements(filter: MovementFilter) {
        const conditions = [
            ...nonDateConditions(filter),
            filter.from ? gte(inventoryMovements.movementDate, filter.from) : undefined,
            filter.to ? lte(inventoryMovements.movementDate, filter.to) : undefined,
        ].filter(Boolean) as ReturnType<typeof eq>[];

        // ascending by (movementDate, movedAt, id) so the caller can run a deterministic forward
        // cumulative — insert order breaks ties inside a day
        return Effect.tryPromise({
            try: () => this.db.select().from(inventoryMovements)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .orderBy(
                    asc(inventoryMovements.movementDate),
                    asc(inventoryMovements.movedAt),
                    asc(inventoryMovements.id),
                )
                .execute(),
            catch: () => new RepositoryError({ message: "cannot list movements" }),
        });
    }

    sumMovementsBefore(filter: MovementFilter) {
        if (!filter.from) return Effect.succeed([]);

        const conditions = [
            ...nonDateConditions(filter),
            // strictly before the window's first day, on the same clock the window uses
            lt(inventoryMovements.movementDate, filter.from),
        ] as ReturnType<typeof eq>[];

        return Effect.tryPromise({
            try: () => this.db.select({
                purityId: inventoryMovements.purityId,
                weightGb: sql<number>`coalesce(sum(${inventoryMovements.weightGbDelta}), 0)::double precision`,
                weightGm: sql<number>`coalesce(sum(${inventoryMovements.weightGmDelta}), 0)::double precision`,
            }).from(inventoryMovements)
                .where(and(...conditions))
                .groupBy(inventoryMovements.purityId)
                .execute(),
            catch: () => new RepositoryError({ message: "cannot sum movements" }),
        });
    }
}

export const makeInventoryRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new InventoryRepository(db);
});
