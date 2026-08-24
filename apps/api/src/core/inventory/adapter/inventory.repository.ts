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

// Any Drizzle handle that can run statements — the real client or a transaction scope. The
// balance helpers below are written against this so one implementation serves both the
// standalone calls and the multi-statement operations that compose them.
type Executor = Parameters<Parameters<Database['transaction']>[0]>[0] | Database

const balanceWhere = (key: BalanceKey) => and(
    eq(inventoryBalance.purityId, key.purityId),
    eq(inventoryBalance.brandId, key.brandId),
    eq(inventoryBalance.origin, key.origin),
    eq(inventoryBalance.productTypeId, key.productTypeId),
)

const isInsufficient = (e: unknown): e is { available: number; requested: number } =>
    !!e && typeof e === 'object' && INSUFFICIENT in (e as object)

/**
 * Locks a pool, checks it covers the weight, and removes it at the pool's own live WAC.
 * Returns the cost taken out.
 *
 * Written against an `Executor` rather than the client so the standalone `decrementBalance` and
 * the composite operations below share one implementation — the lock, the sufficiency check and
 * the rate must not drift between the paths that use them.
 */
async function decrementWithin(tx: Executor, key: BalanceKey, weightGb: number, weightGm: number) {
    const rows = await tx.select().from(inventoryBalance).where(balanceWhere(key)).for('update').execute()

    const balance = rows[0]
    const available = balance?.totalWeightGb ?? 0
    if (!balance || available < weightGb) {
        throw { [INSUFFICIENT]: true, available, requested: weightGb }
    }

    // live WAC — safe from divide-by-zero: available >= weightGb > 0 here
    const rate = balance.totalWeightGb > 0 ? balance.totalCost / balance.totalWeightGb : 0
    const costDelta = weightGb * rate

    // A pool drained to nothing must not keep a fraction of a satang of cost behind: the next
    // increment would average against a rate built from weight that is no longer there. Zero is
    // the honest value for an empty pool, so the residue is cleared rather than carried.
    const emptied = balance.totalWeightGb - weightGb <= 0

    await tx.update(inventoryBalance)
        .set({
            totalWeightGb: sql`${inventoryBalance.totalWeightGb} - ${weightGb}`,
            totalWeightGm: sql`${inventoryBalance.totalWeightGm} - ${weightGm}`,
            totalCost: emptied ? 0 : sql`${inventoryBalance.totalCost} - ${costDelta}`,
        })
        .where(balanceWhere(key))
        .execute()

    return costDelta
}

/** Adds weight and cost to a pool, creating the row when the pool is new. */
async function upsertWithin(tx: Executor, req: UpsertBalance) {
    await tx.insert(inventoryBalance)
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
        .execute()
}

class InventoryRepository implements ForInventoriesRepository {
    constructor(private readonly db: Database) {}

    listBalances() {
        return Effect.tryPromise({
            try: () => this.db.select().from(inventoryBalance).execute(),
            catch: () => new RepositoryError({ message: "cannot list balances" }),
        });
    }

    /**
     * A manual gain, applied whole: the adjustment record, the balance, and the ledger entry.
     *
     * All three in one transaction because they are three descriptions of one event. Written as
     * separate statements they could land apart — a balance that grew with no adjustment saying
     * why, or an audited gain the ledger never recorded — and an inventory system whose balances
     * and ledger disagree cannot be reconciled back to truth by anything except a physical count.
     */
    applyStockGain(req: { adjustment: CreateStockGain; balance: UpsertBalance; movement: CreateMovement }) {
        return Effect.tryPromise({
            try: () => this.db.transaction(async (tx) => {
                await tx.insert(stockGainAdjustments).values(req.adjustment).execute()
                await upsertWithin(tx, req.balance)
                await tx.insert(inventoryMovements).values(req.movement).execute()
            }),
            catch: () => new RepositoryError({ message: "cannot apply stock gain" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    /**
     * A manual loss, applied whole. The decrement runs first inside the transaction so a short
     * pool aborts before anything is written, and the cost it removes — decided by the pool's live
     * WAC under the lock — is what the ledger entry carries.
     */
    applyStockLoss(req: {
        key: BalanceKey
        weightGb: number
        weightGm: number
        adjustment: CreateStockLoss
        // the cost is not known until the locked decrement computes it
        movement: Omit<CreateMovement, 'costDelta'>
    }) {
        return Effect.tryPromise({
            try: () => this.db.transaction(async (tx) => {
                const costDelta = await decrementWithin(tx, req.key, req.weightGb, req.weightGm)
                await tx.insert(stockLossAdjustments).values(req.adjustment).execute()
                await tx.insert(inventoryMovements).values({ ...req.movement, costDelta: -costDelta }).execute()
                return costDelta
            }),
            catch: (e) => isInsufficient(e)
                ? new InsufficientStockError({ requested: e.requested, available: e.available })
                : new RepositoryError({ message: "cannot apply stock loss" }),
        });
    }

    /**
     * A reclassification, applied whole: source pool down, destination pool up, adjustment record,
     * and both halves of the ledger pair.
     *
     * This is the operation that most needs the transaction. Split across five autocommits, a
     * failure after the first leaves gold decremented out of one pool and credited to nothing —
     * weight destroyed on the books with no record explaining where it went.
     */
    applyProductSwitch(req: {
        from: BalanceKey
        to: BalanceKey
        weightGb: number
        weightGm: number
        // the costs are decided by the source pool's live WAC under the lock, and conserved
        adjustment: Omit<CreateProductSwitch, 'fromCostDelta' | 'toCostDelta'>
        fromMovement: Omit<CreateMovement, 'costDelta'>
        toMovement: Omit<CreateMovement, 'costDelta'>
    }) {
        return Effect.tryPromise({
            try: () => this.db.transaction(async (tx) => {
                const costDelta = await decrementWithin(tx, req.from, req.weightGb, req.weightGm)

                // the switch conserves value: what leaves the source pool is exactly what the
                // destination is credited with
                await upsertWithin(tx, {
                    ...req.to,
                    totalWeightGb: req.weightGb,
                    totalWeightGm: req.weightGm,
                    totalCost: costDelta,
                })

                const inserted = await tx.insert(productSwitchAdjustments)
                    .values({ ...req.adjustment, fromCostDelta: costDelta, toCostDelta: costDelta })
                    .returning()
                    .execute()
                const adjustment = inserted[0]

                await tx.insert(inventoryMovements).values([
                    { ...req.fromMovement, referenceId: adjustment.id, costDelta: -costDelta },
                    { ...req.toMovement, referenceId: adjustment.id, costDelta },
                ]).execute()

                return adjustment
            }),
            catch: (e) => isInsufficient(e)
                ? new InsufficientStockError({ requested: e.requested, available: e.available })
                : new RepositoryError({ message: "cannot apply product switch" }),
        });
    }

    // Every pool of a split lands in one transaction. A delivery stamped 8 GB HUA + 4 GB NA is one
    // physical event; booking half of it because the second upsert failed would leave inventory
    // claiming a delivery arrived lighter than it did, with no record of the missing half.
    incrementMany(entries: MovementEntry[]) {
        if (entries.length === 0) return Effect.succeed(undefined as void);

        return Effect.tryPromise({
            try: () => this.db.transaction(async (tx) => {
                for (const entry of entries) {
                    await upsertWithin(tx, {
                        purityId: entry.purityId,
                        brandId: entry.brandId,
                        origin: entry.origin,
                        productTypeId: entry.productTypeId,
                        totalWeightGb: entry.weightGb,
                        totalWeightGm: entry.weightGm,
                        totalCost: entry.totalCost,
                    });

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
                    const costDelta = await decrementWithin(tx, entry, entry.weightGb, entry.weightGm);

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
            catch: (e) => isInsufficient(e)
                ? new InsufficientStockError({ requested: e.requested, available: e.available })
                : new RepositoryError({ message: "cannot decrement balances" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    /**
     * Restores every pool a reference drew from, and books the opposite movements — in one
     * transaction, for the same reason the outbound move was one: a mixed shipment coming home
     * half-restored leaves the balances claiming gold that is physically on the shelf is not.
     */
    applyReversal(req: { restore: UpsertBalance[]; movements: CreateMovement[] }) {
        if (req.restore.length === 0) return Effect.succeed(undefined as void);

        return Effect.tryPromise({
            try: () => this.db.transaction(async (tx) => {
                for (const balance of req.restore) await upsertWithin(tx, balance)
                await tx.insert(inventoryMovements).values(req.movements).execute()
            }),
            catch: () => new RepositoryError({ message: "cannot apply reversal" }),
        }).pipe(Effect.map(() => undefined as void));
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
