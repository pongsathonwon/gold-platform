import { Effect } from "effect";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Database, DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateWholeSellStatus, CreateWholeSellTransaction,
    WholeSellStatus, wholeSellStatuses, wholeSellTransactions,
} from "../../../infrastructure/db/schema/wholesale-sell.schema.js";
import {
    ContestedFields, ForWholeSellRepository, ListFilter, SettlementFields,
    TransactionNotFoundError, UpdateTransactionFields,
} from "../port/wholesale-sell.port.js";

class WholeSellRepositoryImpl implements ForWholeSellRepository {
    constructor(private readonly db: Database) {}

    createTransaction(req: CreateWholeSellTransaction) {
        return Effect.tryPromise({
            try: () => this.db.insert(wholeSellTransactions).values(req).returning().execute(),
            catch: () => new RepositoryError({ message: "cannot create wholesale sell transaction" }),
        }).pipe(Effect.map((res) => res[0]));
    }

    findTransactionById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(wholeSellTransactions).where(eq(wholeSellTransactions.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find wholesale sell transaction: ${id}` }),
        }).pipe(
            Effect.flatMap((res) =>
                res.length === 1
                    ? Effect.succeed(res[0])
                    : Effect.fail(new TransactionNotFoundError({ id }))
            )
        );
    }

    listTransactions(req: ListFilter) {
        const conditions = [
            req.currentStatus ? eq(wholeSellTransactions.currentStatus, req.currentStatus) : undefined,
            req.settlementPeriod ? eq(wholeSellTransactions.settlementPeriod, req.settlementPeriod) : undefined,
            req.supplierId ? eq(wholeSellTransactions.supplierId, req.supplierId) : undefined,
            // the window is over the business day the deal was struck, not the insert timestamp —
            // a backdated entry answers for the day it happened. Both ends inclusive: `to` is a
            // day, so excluding it would silently drop the last day the caller asked for.
            req.from ? gte(wholeSellTransactions.transactionDate, req.from) : undefined,
            req.to ? lte(wholeSellTransactions.transactionDate, req.to) : undefined,
        ].filter(Boolean) as ReturnType<typeof eq>[];

        return Effect.tryPromise({
            try: () => this.db.select().from(wholeSellTransactions)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                // newest business day first, insert order breaking ties inside a day — a
                // backdated entry belongs where its date puts it, not at the top
                .orderBy(desc(wholeSellTransactions.transactionDate), desc(wholeSellTransactions.recordedAt))
                .execute(),
            catch: () => new RepositoryError({ message: "cannot list wholesale sell transactions" }),
        });
    }

    updateTransaction(id: string, fields: UpdateTransactionFields) {
        return Effect.tryPromise({
            try: () => this.db.update(wholeSellTransactions)
                .set(fields)
                .where(eq(wholeSellTransactions.id, id))
                .returning()
                .execute(),
            catch: () => new RepositoryError({ message: `cannot update transaction: ${id}` }),
        }).pipe(
            Effect.flatMap((res) =>
                res.length === 1
                    ? Effect.succeed(res[0])
                    : Effect.fail(new TransactionNotFoundError({ id }))
            )
        );
    }

    updateCurrentStatus(id: string, status: WholeSellStatus) {
        return Effect.tryPromise({
            try: () => this.db.update(wholeSellTransactions)
                .set({ currentStatus: status })
                .where(eq(wholeSellTransactions.id, id))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot update status for transaction: ${id}` }),
        }).pipe(Effect.map(() => undefined as void));
    }

    recordContestedWeights(id: string, fields: ContestedFields) {
        return Effect.tryPromise({
            try: () => this.db.update(wholeSellTransactions)
                .set(fields)
                .where(eq(wholeSellTransactions.id, id))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot record contested weight for transaction: ${id}` }),
        }).pipe(Effect.map(() => undefined as void));
    }

    recordSettlement(id: string, fields: SettlementFields) {
        // an empty patch would be an UPDATE with no SET clause, which Drizzle rejects at runtime
        if (Object.keys(fields).length === 0) return Effect.succeed(undefined as void);
        return Effect.tryPromise({
            try: () => this.db.update(wholeSellTransactions)
                .set(fields)
                .where(eq(wholeSellTransactions.id, id))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot record settlement for transaction: ${id}` }),
        }).pipe(Effect.map(() => undefined as void));
    }

    listCreated() {
        return Effect.tryPromise({
            try: () => this.db.select().from(wholeSellTransactions)
                .where(eq(wholeSellTransactions.currentStatus, 'CREATED'))
                .execute(),
            catch: () => new RepositoryError({ message: "cannot list unconfirmed wholesale sell transactions" }),
        });
    }

    createStatus(req: CreateWholeSellStatus) {
        return Effect.tryPromise({
            try: () => this.db.insert(wholeSellStatuses).values(req).execute(),
            catch: () => new RepositoryError({ message: "cannot create wholesale sell status" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    listStatuses(transactionId: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(wholeSellStatuses)
                .where(eq(wholeSellStatuses.transactionId, transactionId))
                .orderBy(wholeSellStatuses.createdAt)
                .execute(),
            catch: () => new RepositoryError({ message: `cannot list statuses for transaction: ${transactionId}` }),
        });
    }
}

export const makeWholeSellRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new WholeSellRepositoryImpl(db);
});
