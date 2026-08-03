import { Effect } from "effect";
import { and, desc, eq } from "drizzle-orm";
import { Database, DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateWholeBuyStatus, CreateWholeBuyTransaction,
    WholeBuyStatus, wholeBuyStatuses, wholeBuyTransactions,
} from "../../../infrastructure/db/schema/wholesale-buy.schema.js";
import {
    CheckedFields, ForWholeBuyRepository, ListFilter,
    TransactionNotFoundError, UpdateTransactionFields,
} from "../port/wholesale-buy.port.js";

class WholeBuyRepositoryImpl implements ForWholeBuyRepository {
    constructor(private readonly db: Database) {}

    createTransaction(req: CreateWholeBuyTransaction) {
        return Effect.tryPromise({
            try: () => this.db.insert(wholeBuyTransactions).values(req).returning().execute(),
            catch: () => new RepositoryError({ message: "cannot create wholesale buy transaction" }),
        }).pipe(Effect.map((res) => res[0]));
    }

    findTransactionById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(wholeBuyTransactions).where(eq(wholeBuyTransactions.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find wholesale buy transaction: ${id}` }),
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
            req.currentStatus ? eq(wholeBuyTransactions.currentStatus, req.currentStatus) : undefined,
            req.settlementPeriod ? eq(wholeBuyTransactions.settlementPeriod, req.settlementPeriod) : undefined,
            req.supplierId ? eq(wholeBuyTransactions.supplierId, req.supplierId) : undefined,
        ].filter(Boolean) as ReturnType<typeof eq>[];

        return Effect.tryPromise({
            try: () => this.db.select().from(wholeBuyTransactions)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .orderBy(desc(wholeBuyTransactions.recordedAt))
                .execute(),
            catch: () => new RepositoryError({ message: "cannot list wholesale buy transactions" }),
        });
    }

    updateTransaction(id: string, fields: UpdateTransactionFields) {
        return Effect.tryPromise({
            try: () => this.db.update(wholeBuyTransactions)
                .set(fields)
                .where(eq(wholeBuyTransactions.id, id))
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

    updateCurrentStatus(id: string, status: WholeBuyStatus) {
        return Effect.tryPromise({
            try: () => this.db.update(wholeBuyTransactions)
                .set({ currentStatus: status })
                .where(eq(wholeBuyTransactions.id, id))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot update status for transaction: ${id}` }),
        }).pipe(Effect.map(() => undefined as void));
    }

    recordCheckedWeights(id: string, fields: CheckedFields) {
        return Effect.tryPromise({
            try: () => this.db.update(wholeBuyTransactions)
                .set(fields)
                .where(eq(wholeBuyTransactions.id, id))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot record checked weights for transaction: ${id}` }),
        }).pipe(Effect.map(() => undefined as void));
    }

    listCreated() {
        return Effect.tryPromise({
            try: () => this.db.select().from(wholeBuyTransactions)
                .where(eq(wholeBuyTransactions.currentStatus, 'CREATED'))
                .execute(),
            catch: () => new RepositoryError({ message: "cannot list unconfirmed wholesale buy transactions" }),
        });
    }

    createStatus(req: CreateWholeBuyStatus) {
        return Effect.tryPromise({
            try: () => this.db.insert(wholeBuyStatuses).values(req).execute(),
            catch: () => new RepositoryError({ message: "cannot create wholesale buy status" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    listStatuses(transactionId: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(wholeBuyStatuses)
                .where(eq(wholeBuyStatuses.transactionId, transactionId))
                .orderBy(wholeBuyStatuses.createdAt)
                .execute(),
            catch: () => new RepositoryError({ message: `cannot list statuses for transaction: ${transactionId}` }),
        });
    }
}

export const makeWholeBuyRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new WholeBuyRepositoryImpl(db);
});
