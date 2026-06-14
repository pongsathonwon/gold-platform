import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { Database, DrizzleClient, RepositoryError } from "../../../infrastructure/db/client.js";
import {
    CreateReceivedStatus, CreateReceivedTransaction,
    ReceivedStatus, ReceivedTransactionShape,
    receivedStatuses, receivedTransactions,
} from "../../../infrastructure/db/schema/received.schema.js";
import { ForReceiveRepository, TransactionNotFoundError } from "../port/receive.port.js";

class ReceiveRepositoryImpl implements ForReceiveRepository {
    constructor(private readonly db: Database) {}

    createTransaction(req: CreateReceivedTransaction) {
        return Effect.tryPromise({
            try: () => this.db.insert(receivedTransactions).values(req).returning().execute(),
            catch: () => new RepositoryError({ message: "cannot create received transaction" }),
        }).pipe(Effect.map((res) => res[0]));
    }

    findTransactionById(id: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(receivedTransactions).where(eq(receivedTransactions.id, id)).execute(),
            catch: () => new RepositoryError({ message: `cannot find received transaction: ${id}` }),
        }).pipe(
            Effect.flatMap((res) =>
                res.length === 1
                    ? Effect.succeed(res[0])
                    : Effect.fail(new TransactionNotFoundError({ id }))
            )
        );
    }

    listTransactions(req: Partial<Pick<ReceivedTransactionShape, 'currentStatus' | 'settlementPeriod' | 'branchCode'>>) {
        const conditions = [
            req.currentStatus ? eq(receivedTransactions.currentStatus, req.currentStatus) : undefined,
            req.settlementPeriod ? eq(receivedTransactions.settlementPeriod, req.settlementPeriod) : undefined,
            req.branchCode ? eq(receivedTransactions.branchCode, req.branchCode) : undefined,
        ].filter((c) => c !== undefined);

        return Effect.tryPromise({
            try: () => this.db.select().from(receivedTransactions)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .execute(),
            catch: () => new RepositoryError({ message: "cannot list received transactions" }),
        });
    }

    updateCurrentStatus(id: string, status: ReceivedStatus) {
        return Effect.tryPromise({
            try: () => this.db.update(receivedTransactions)
                .set({ currentStatus: status })
                .where(eq(receivedTransactions.id, id))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot update status for transaction: ${id}` }),
        }).pipe(Effect.map(() => undefined as void));
    }

    createStatus(req: CreateReceivedStatus) {
        return Effect.tryPromise({
            try: () => this.db.insert(receivedStatuses).values(req).execute(),
            catch: () => new RepositoryError({ message: "cannot create received status" }),
        }).pipe(Effect.map(() => undefined as void));
    }

    listStatuses(transactionId: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(receivedStatuses)
                .where(eq(receivedStatuses.transactionId, transactionId))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot list statuses for transaction: ${transactionId}` }),
        });
    }

    findReceivedStatusEntry(transactionId: string) {
        return Effect.tryPromise({
            try: () => this.db.select().from(receivedStatuses)
                .where(and(
                    eq(receivedStatuses.transactionId, transactionId),
                    eq(receivedStatuses.status, 'RECEIVED'),
                ))
                .execute(),
            catch: () => new RepositoryError({ message: `cannot find RECEIVED status entry for transaction: ${transactionId}` }),
        }).pipe(
            Effect.flatMap((res) =>
                res.length >= 1
                    ? Effect.succeed(res[0])
                    : Effect.fail(new TransactionNotFoundError({ id: transactionId }))
            )
        );
    }
}

export const makeReceiveRepository = Effect.gen(function* () {
    const db = yield* DrizzleClient;
    return new ReceiveRepositoryImpl(db);
});
