import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { Database, DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateWholeSellStatus, CreateWholeSellTransaction,
    WholeSellStatus, WholeSellTransactionShape,
    wholeSellStatuses, wholeSellTransactions,
} from "../../../infrastructure/db/schema/wholesale-sell.schema.js";
import { ForWholeSellRepository, TransactionNotFoundError } from "../port/wholesale-sell.port.js";

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

    listTransactions(req: Partial<Pick<WholeSellTransactionShape, 'currentStatus' | 'settlementPeriod'>>) {
        const conditions = [
            req.currentStatus ? eq(wholeSellTransactions.currentStatus, req.currentStatus) : undefined,
            req.settlementPeriod ? eq(wholeSellTransactions.settlementPeriod, req.settlementPeriod) : undefined,
        ].filter(Boolean) as ReturnType<typeof eq>[];

        return Effect.tryPromise({
            try: () => this.db.select().from(wholeSellTransactions)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .execute(),
            catch: () => new RepositoryError({ message: "cannot list wholesale sell transactions" }),
        });
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
                .execute(),
            catch: () => new RepositoryError({ message: `cannot list statuses for transaction: ${transactionId}` }),
        });
    }
}

export const makeWholeSellRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new WholeSellRepositoryImpl(db);
});
